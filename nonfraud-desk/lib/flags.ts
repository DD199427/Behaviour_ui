import fs from "fs"
import path from "path"
import neo4j from "neo4j-driver"
import {
  FRAUD_NOTES,
  MIN_ENTITIES,
  MIN_FLAGS,
  isKnownFraudType,
  type FlagLabel,
  type FlagRecord,
  type FlagStatus,
} from "@/lib/behaviour-copy"
import { graphEnabled, withSession } from "@/lib/graph"

type StoredLabel = {
  description: string
  origin: "generator" | "analyst"
  status: FlagStatus
  created_at: string
}

type FileStore = {
  labels: Record<string, StoredLabel>
  flags: FlagRecord[]
}

export type FlagWriteRow = {
  txnId: string
  accountId: string
  date: string
  label: string
  description: string
  origin: "generator" | "analyst"
  confidence: number
  margin: number
}

export type FlagWriteResult = {
  store: "neo4j" | "file"
  written: number
  labels: FlagLabel[]
}

const STORE_PATH = path.join(process.cwd(), "store", "flags.json")

let schemaReady: Promise<void> | null = null

function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = withSession(async (session) => {
      await session.run(
        "CREATE CONSTRAINT bb_label_name IF NOT EXISTS FOR (b:BehaviourLabel) REQUIRE b.name IS UNIQUE",
      )
      await session.run(
        "CREATE CONSTRAINT bb_txn_id IF NOT EXISTS FOR (t:Transaction) REQUIRE t.txn_id IS UNIQUE",
      )
      await session.run(
        "CREATE INDEX bb_txn_account IF NOT EXISTS FOR (t:Transaction) ON (t.account_id)",
      )
    }).catch((error: unknown) => {
      schemaReady = null
      throw error
    })
  }
  return schemaReady
}

function emptyStore(): FileStore {
  return { labels: {}, flags: [] }
}

function readStore(): FileStore {
  if (!fs.existsSync(STORE_PATH)) return emptyStore()
  const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) as FileStore
  return { labels: parsed.labels ?? {}, flags: parsed.flags ?? [] }
}

function writeStore(store: FileStore) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true })
  const temporary = `${STORE_PATH}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(store, null, 2))
  fs.renameSync(temporary, STORE_PATH)
}

function progress(flags: number, entities: number, origin: "generator" | "analyst"): FlagStatus {
  if (origin === "generator") return "known"
  if (flags >= MIN_FLAGS && entities >= MIN_ENTITIES) return "active"
  return "candidate"
}

function toLabel(
  name: string,
  meta: { description?: string; origin?: string; status?: string },
  flags: number,
  entities: number,
): FlagLabel {
  const origin =
    meta.origin === "analyst" ? "analyst" : meta.origin === "generator" || isKnownFraudType(name) ? "generator" : "analyst"
  return {
    name,
    status: progress(flags, entities, origin),
    origin,
    description: meta.description || FRAUD_NOTES[name] || "",
    flags,
    entities,
    flagsNeeded: MIN_FLAGS,
    entitiesNeeded: MIN_ENTITIES,
  }
}

export async function listFlags(): Promise<{ store: "neo4j" | "file"; labels: FlagLabel[]; flags: FlagRecord[] }> {
  if (!graphEnabled()) return listFileFlags()
  await ensureSchema()
  return withSession(async (session) => {
    const labelsResult = await session.run(
      `MATCH (b:BehaviourLabel)
       OPTIONAL MATCH (t:Transaction)-[:FLAGGED_AS]->(b)
       RETURN b.name AS name, b.status AS status, b.origin AS origin, b.description AS description,
              count(t) AS flags, count(DISTINCT t.txn_id) AS entities
       ORDER BY flags DESC, name`,
    )
    const labels = labelsResult.records.map((record) =>
      toLabel(
        String(record.get("name")),
        {
          status: String(record.get("status") ?? ""),
          origin: String(record.get("origin") ?? ""),
          description: String(record.get("description") ?? ""),
        },
        Number(record.get("flags")),
        Number(record.get("entities")),
      ),
    )
    const flagsResult = await session.run(
      `MATCH (t:Transaction)-[r:FLAGGED_AS]->(b:BehaviourLabel)
       RETURN t.txn_id AS txnId, t.account_id AS accountId, t.trans_date AS date,
              b.name AS label, r.confidence AS confidence, r.margin AS margin,
              r.user AS user, r.note AS note, r.ts AS ts
       ORDER BY r.ts DESC
       LIMIT 300`,
    )
    const flags = flagsResult.records.map((record) => ({
      txnId: String(record.get("txnId")),
      accountId: String(record.get("accountId") ?? ""),
      date: String(record.get("date") ?? ""),
      label: String(record.get("label")),
      confidence: Number(record.get("confidence") ?? 0),
      margin: Number(record.get("margin") ?? 0),
      user: String(record.get("user") ?? ""),
      note: String(record.get("note") ?? ""),
      ts: String(record.get("ts") ?? ""),
    }))
    return { store: "neo4j" as const, labels, flags }
  })
}

function listFileFlags(): { store: "file"; labels: FlagLabel[]; flags: FlagRecord[] } {
  const store = readStore()
  const labels = Object.entries(store.labels).map(([name, meta]) => {
    const rows = store.flags.filter((flag) => flag.label === name)
    const entities = new Set(rows.map((flag) => flag.txnId)).size
    const status = progress(rows.length, entities, meta.origin)
    return toLabel(name, { ...meta, status }, rows.length, entities)
  })
  labels.sort((a, b) => b.flags - a.flags || a.name.localeCompare(b.name))
  return { store: "file", labels, flags: [...store.flags].reverse().slice(0, 300) }
}

function remember(map: Map<string, string[]>, txnId: string, label: string) {
  const current = map.get(txnId)
  if (current) {
    if (!current.includes(label)) current.push(label)
  } else {
    map.set(txnId, [label])
  }
}

export async function flagMap(): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (!graphEnabled()) {
    for (const flag of readStore().flags) remember(map, flag.txnId, flag.label)
    return map
  }
  await ensureSchema()
  await withSession(async (session) => {
    const result = await session.run(
      `MATCH (t:Transaction)-[:FLAGGED_AS]->(b:BehaviourLabel)
       RETURN t.txn_id AS txnId, b.name AS label`,
    )
    for (const record of result.records) remember(map, String(record.get("txnId")), String(record.get("label")))
  })
  return map
}

export async function proposeLabel(name: string, description: string, user: string): Promise<FlagLabel> {
  if (isKnownFraudType(name)) {
    throw new Error(`${name} is one of the six generator types. Pick a different name.`)
  }
  if (graphEnabled()) {
    await ensureSchema()
    return withSession(async (session) => {
      const existing = await session.run(
        "MATCH (b:BehaviourLabel {name: $name}) RETURN b.name AS name",
        { name },
      )
      if (existing.records.length > 0) {
        throw new Error(`${name} already exists.`)
      }
      const ts = new Date().toISOString()
      await session.run(
        `CREATE (b:BehaviourLabel {name: $name, description: $description, origin: 'analyst', status: 'candidate', created_at: $ts, created_by: $user})`,
        { name, description, ts, user },
      )
      return toLabel(name, { description, origin: "analyst", status: "candidate" }, 0, 0)
    })
  }
  const store = readStore()
  if (store.labels[name]) throw new Error(`${name} already exists.`)
  store.labels[name] = {
    description,
    origin: "analyst",
    status: "candidate",
    created_at: new Date().toISOString(),
  }
  writeStore(store)
  return toLabel(name, store.labels[name], 0, 0)
}

export async function writeFlags(
  rows: FlagWriteRow[],
  user: string,
  note: string,
): Promise<FlagWriteResult> {
  if (rows.length === 0) return { store: graphEnabled() ? "neo4j" : "file", written: 0, labels: [] }
  if (graphEnabled()) return writeGraphFlags(rows, user, note)
  return writeFileFlags(rows, user, note)
}

async function writeGraphFlags(rows: FlagWriteRow[], user: string, note: string): Promise<FlagWriteResult> {
  await ensureSchema()
  const ts = new Date().toISOString()
  const payload = rows.map((row) => ({
    ...row,
    status: row.origin === "generator" ? "known" : "candidate",
    user,
    note,
    ts,
  }))
  return withSession(async (session) => {
    await session.run(
      `UNWIND $rows AS row
       MERGE (b:BehaviourLabel {name: row.label})
       ON CREATE SET b.description = row.description, b.origin = row.origin,
                     b.status = row.status, b.created_at = row.ts, b.created_by = row.user
       MERGE (t:Transaction {txn_id: row.txnId})
       SET t.account_id = row.accountId, t.trans_date = row.date
       MERGE (t)-[r:FLAGGED_AS]->(b)
       SET r.confidence = row.confidence, r.margin = row.margin, r.user = row.user,
           r.note = row.note, r.ts = row.ts, r.source = 'analyst-confirm'`,
      { rows: payload },
    )
    await session.run(
      `UNWIND $rows AS row
       MATCH (t:Transaction {txn_id: row.txnId})
       MATCH (a:Account {account_id: row.accountId})
       MERGE (t)-[:ON_ACCOUNT]->(a)`,
      { rows: payload },
    )
    const names = [...new Set(rows.map((row) => row.label))]
    const statusResult = await session.run(
      `UNWIND $names AS name
       MATCH (b:BehaviourLabel {name: name})
       OPTIONAL MATCH (t:Transaction)-[:FLAGGED_AS]->(b)
       WITH b, count(t) AS flags, count(DISTINCT t.txn_id) AS entities
       SET b.flag_count = flags, b.entity_count = entities,
           b.status = CASE
             WHEN b.origin = 'generator' THEN 'known'
             WHEN flags >= $minFlags AND entities >= $minEntities THEN 'active'
             ELSE 'candidate'
           END
       RETURN b.name AS name, b.status AS status, b.origin AS origin, b.description AS description,
              flags, entities`,
      { names, minFlags: neo4j.int(MIN_FLAGS), minEntities: neo4j.int(MIN_ENTITIES) },
    )
    const labels = statusResult.records.map((record) =>
      toLabel(
        String(record.get("name")),
        {
          status: String(record.get("status")),
          origin: String(record.get("origin")),
          description: String(record.get("description") ?? ""),
        },
        Number(record.get("flags")),
        Number(record.get("entities")),
      ),
    )
    return { store: "neo4j" as const, written: rows.length, labels }
  })
}

export async function behaviourExamples(name: string): Promise<{ label: FlagLabel | null; txnIds: string[] }> {
  if (!graphEnabled()) {
    const store = readStore()
    const meta = store.labels[name]
    if (!meta) return { label: null, txnIds: [] }
    const rows = store.flags.filter((flag) => flag.label === name)
    const txnIds = [...new Set(rows.map((flag) => flag.txnId))]
    return {
      label: toLabel(name, meta, rows.length, txnIds.length),
      txnIds,
    }
  }
  await ensureSchema()
  return withSession(async (session) => {
    const result = await session.run(
      `MATCH (b:BehaviourLabel {name: $name})
       OPTIONAL MATCH (t:Transaction)-[:FLAGGED_AS]->(b)
       RETURN b.name AS name, b.status AS status, b.origin AS origin, b.description AS description,
              collect(DISTINCT t.txn_id) AS txnIds`,
      { name },
    )
    if (result.records.length === 0) return { label: null, txnIds: [] }
    const record = result.records[0]
    const txnIds = (record.get("txnIds") as Array<string | null>).filter((id): id is string => Boolean(id))
    return {
      label: toLabel(
        String(record.get("name")),
        {
          status: String(record.get("status") ?? ""),
          origin: String(record.get("origin") ?? ""),
          description: String(record.get("description") ?? ""),
        },
        txnIds.length,
        txnIds.length,
      ),
      txnIds,
    }
  })
}

function writeFileFlags(rows: FlagWriteRow[], user: string, note: string): FlagWriteResult {
  const store = readStore()
  const ts = new Date().toISOString()
  for (const row of rows) {
    if (!store.labels[row.label]) {
      store.labels[row.label] = {
        description: row.description,
        origin: row.origin,
        status: row.origin === "generator" ? "known" : "candidate",
        created_at: ts,
      }
    }
    const existing = store.flags.find((flag) => flag.txnId === row.txnId && flag.label === row.label)
    if (existing) {
      existing.confidence = row.confidence
      existing.margin = row.margin
      existing.user = user
      existing.note = note
      existing.ts = ts
    } else {
      store.flags.push({
        txnId: row.txnId,
        accountId: row.accountId,
        date: row.date,
        label: row.label,
        confidence: row.confidence,
        margin: row.margin,
        user,
        note,
        ts,
      })
    }
  }
  const names = [...new Set(rows.map((row) => row.label))]
  const labels = names.map((name) => {
    const meta = store.labels[name]
    const matched = store.flags.filter((flag) => flag.label === name)
    const entities = new Set(matched.map((flag) => flag.txnId)).size
    meta.status = progress(matched.length, entities, meta.origin)
    return toLabel(name, meta, matched.length, entities)
  })
  writeStore(store)
  return { store: "file", written: rows.length, labels }
}
