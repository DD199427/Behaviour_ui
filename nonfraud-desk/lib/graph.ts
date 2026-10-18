import neo4j, { type Driver, type Integer, type Session } from "neo4j-driver"
import type { BehaviourIndex, GroupRecord, MerchantRecord, PeerRef } from "@/lib/types"

const SPOTLIGHT_ACCOUNT = "060434671693"

let driver: Driver | null = null

export function graphEnabled(): boolean {
  if (process.env.NEO4J_DISABLED === "1") return false
  return Boolean(process.env.NEO4J_URI)
}

export function graphLabel(): string {
  return graphEnabled() ? "neo4j" : "file"
}

function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      process.env.NEO4J_URI || "bolt://127.0.0.1:7687",
      neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || ""),
      { disableLosslessIntegers: true },
    )
  }
  return driver
}

async function read<T>(run: (session: Session) => Promise<T>): Promise<T> {
  const session = getDriver().session()
  try {
    return await run(session)
  } finally {
    await session.close()
  }
}

export function withSession<T>(run: (session: Session) => Promise<T>): Promise<T> {
  return read(run)
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return value
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as Integer).toNumber()
  }
  return Number(value)
}

function roundScore(value: number): number {
  return Math.round(value * 100000) / 100000
}

function groupFromProperties(id: string, raw: string): GroupRecord {
  const parsed = JSON.parse(raw) as {
    entity: "account" | "merchant"
    size: number
    summary: string
    method: string
    top_features?: {
      feature: string
      group_value: number
      overall_value: number
      stat: string
      vs_overall_sd: number
    }[]
  }
  return {
    id,
    entity: parsed.entity,
    size: parsed.size,
    summary: parsed.summary,
    method: parsed.method,
    top: (parsed.top_features ?? []).map((item) => ({
      feature: item.feature,
      group: item.group_value,
      overall: item.overall_value,
      stat: item.stat,
      sd: item.vs_overall_sd,
    })),
  }
}

export async function loadBehaviourIndex(): Promise<BehaviourIndex> {
  return read(async (session) => {
    const groupsResult = await session.run(
      `MATCH (g:BehaviourGroup)
       RETURN g.group_id AS id, g.properties_json AS props, g.schema AS schema, g.version AS version, g.asof AS asof`,
    )
    const groups: Record<string, GroupRecord> = {}
    let schema = "s1"
    let version = "v1"
    let asof = "2026-09-30"
    for (const record of groupsResult.records) {
      const id = String(record.get("id"))
      groups[id] = groupFromProperties(id, String(record.get("props")))
      if (record.get("schema")) schema = String(record.get("schema"))
      if (record.get("version")) version = String(record.get("version"))
      if (record.get("asof")) asof = String(record.get("asof"))
    }

    const accountResult = await session.run(
      `MATCH (a:Account)-[:IN_BEHAVIOUR_GROUP]->(g:BehaviourGroup)
       OPTIONAL MATCH (a)-[r:BEHAVES_LIKE]->(b:Account)-[:IN_BEHAVIOUR_GROUP]->(pg:BehaviourGroup)
       RETURN a.account_id AS id, g.group_id AS group, r.rank AS rank,
              b.account_id AS peer, r.score AS score, pg.group_id AS peerGroup
       ORDER BY id, rank`,
    )
    const accounts: BehaviourIndex["accounts"] = {}
    const roster: Record<string, string[]> = {}
    for (const record of accountResult.records) {
      const id = String(record.get("id"))
      const group = String(record.get("group"))
      if (!accounts[id]) {
        accounts[id] = { g: group, peers: [] }
        ;(roster[group] ??= []).push(id)
      }
      const peer = record.get("peer")
      if (peer) {
        accounts[id].peers.push([
          String(peer),
          roundScore(asNumber(record.get("score"))),
          String(record.get("peerGroup") ?? ""),
        ])
      }
    }
    for (const ids of Object.values(roster)) ids.sort()

    const merchantResult = await session.run(
      `MATCH (m:Merchant)-[:IN_BEHAVIOUR_GROUP]->(g:BehaviourGroup)
       RETURN m.name AS name, m.category AS category, g.group_id AS group
       ORDER BY group, category, name`,
    )
    const merchants: MerchantRecord[] = merchantResult.records.map((record) => ({
      name: String(record.get("name")),
      category: String(record.get("category")),
      group: String(record.get("group")),
    }))

    const linkResult = await session.run(
      `MATCH (:Account)-[ar:BEHAVES_LIKE]->(:Account)
       WITH count(ar) AS accountLinks
       MATCH (:Merchant)-[mr:BEHAVES_LIKE]->(:Merchant)
       RETURN accountLinks, count(mr) AS merchantLinks`,
    )
    const crossResult = await session.run(
      `MATCH (a:Account)-[:IN_BEHAVIOUR_GROUP]->(g1:BehaviourGroup)
       MATCH (a)-[r:BEHAVES_LIKE]->(:Account)-[:IN_BEHAVIOUR_GROUP]->(g2:BehaviourGroup)
       WHERE g1.group_id <> g2.group_id
       RETURN count(r) AS crossLinks,
              sum(CASE WHEN r.rank = 1 THEN 1 ELSE 0 END) AS rank1`,
    )
    const links = linkResult.records[0]
    const cross = crossResult.records[0]

    const spotlightResult = await session.run(
      `MATCH (a:Account {account_id: $id})-[r:BEHAVES_LIKE]->(b:Account)
       WHERE r.rank = 1
       MATCH (a)-[:IN_BEHAVIOUR_GROUP]->(g1:BehaviourGroup)
       MATCH (b)-[:IN_BEHAVIOUR_GROUP]->(g2:BehaviourGroup)
       RETURN a.account_id AS accountId, g1.group_id AS accountGroup,
              b.account_id AS peerId, g2.group_id AS peerGroup, r.score AS score,
              g1.group_id <> g2.group_id AS crossed`,
      { id: SPOTLIGHT_ACCOUNT },
    )
    const spot = spotlightResult.records[0]
    if (!spot || spot.get("crossed") !== true) {
      throw new Error(`Rank-1 neighbour of ${SPOTLIGHT_ACCOUNT} is not in another group.`)
    }

    return {
      asof,
      schema,
      version,
      counts: {
        accounts: Object.keys(accounts).length,
        merchants: merchants.length,
        accountLinks: asNumber(links.get("accountLinks")),
        merchantLinks: asNumber(links.get("merchantLinks")),
        accountGroups: Object.values(groups).filter((group) => group.entity === "account").length,
        merchantGroups: Object.values(groups).filter((group) => group.entity === "merchant").length,
        crossGroupAccountLinks: asNumber(cross.get("crossLinks")),
        rank1CrossGroup: asNumber(cross.get("rank1")),
      },
      spotlight: {
        accountId: String(spot.get("accountId")),
        accountGroup: String(spot.get("accountGroup")),
        peerId: String(spot.get("peerId")),
        peerGroup: String(spot.get("peerGroup")),
        score: roundScore(asNumber(spot.get("score"))),
      },
      groups,
      roster,
      merchants,
      accounts,
    }
  })
}

export async function accountNeighbourhood(id: string): Promise<{
  id: string
  group: string
  groupSummary: string
  peers: PeerRef[]
} | null> {
  return read(async (session) => {
    const result = await session.run(
      `MATCH (a:Account {account_id: $id})-[:IN_BEHAVIOUR_GROUP]->(g:BehaviourGroup)
       OPTIONAL MATCH (a)-[r:BEHAVES_LIKE]->(b:Account)-[:IN_BEHAVIOUR_GROUP]->(pg:BehaviourGroup)
       RETURN g.group_id AS group, g.properties_json AS props,
              b.account_id AS peer, r.score AS score, r.rank AS rank, pg.group_id AS peerGroup
       ORDER BY rank`,
      { id },
    )
    if (result.records.length === 0) return null
    const first = result.records[0]
    const parsed = groupFromProperties(String(first.get("group")), String(first.get("props")))
    const peers: PeerRef[] = []
    for (const record of result.records) {
      const peer = record.get("peer")
      if (!peer) continue
      peers.push({
        id: String(peer),
        score: roundScore(asNumber(record.get("score"))),
        group: String(record.get("peerGroup") ?? ""),
      })
    }
    return { id, group: parsed.id, groupSummary: parsed.summary, peers }
  })
}

export async function searchAccountNodes(query: string, limit = 8): Promise<{ id: string; group: string }[]> {
  const needle = query.replace(/\s/g, "")
  if (needle.length < 3) return []
  return read(async (session) => {
    const result = await session.run(
      `MATCH (a:Account)-[:IN_BEHAVIOUR_GROUP]->(g:BehaviourGroup)
       WHERE a.account_id CONTAINS $needle
       RETURN a.account_id AS id, g.group_id AS group
       ORDER BY a.account_id
       LIMIT $limit`,
      { needle, limit: neo4j.int(limit) },
    )
    return result.records.map((record) => ({
      id: String(record.get("id")),
      group: String(record.get("group")),
    }))
  })
}

export async function searchMerchantNodes(
  query: string,
  category: string,
  limit = 12,
): Promise<MerchantRecord[]> {
  const needle = query.trim().toLowerCase().replace(/^fraud_/, "")
  return read(async (session) => {
    const result = await session.run(
      `MATCH (m:Merchant)-[:IN_BEHAVIOUR_GROUP]->(g:BehaviourGroup)
       WHERE ($category = '' OR m.category = $category)
         AND ($needle = '' OR toLower(replace(m.name, 'fraud_', '')) CONTAINS $needle)
       RETURN m.name AS name, m.category AS category, g.group_id AS group
       ORDER BY group, category, name
       LIMIT $limit`,
      { needle, category, limit: neo4j.int(limit) },
    )
    return result.records.map((record) => ({
      name: String(record.get("name")),
      category: String(record.get("category")),
      group: String(record.get("group")),
    }))
  })
}
