import fs from "node:fs"
import path from "node:path"
import { connection } from "next/server"
import { isKnownFraudType, slugBehaviour } from "@/lib/behaviour-copy"
import { behaviourExamples, writeFlags, type FlagWriteRow } from "@/lib/flags"
import { buildFlaggedExport } from "@/lib/neo4j-export"
import { scanCsvPath } from "@/lib/scan"

type ExportBody = {
  label?: unknown
  txnIds?: unknown
  user?: unknown
  note?: unknown
}

function cleanUser(value: unknown): string {
  const user = String(value ?? "").trim().slice(0, 40)
  return user || "analyst"
}

function readScan(label: string): Map<string, { accountId: string; date: string; score: number; margin: number }> {
  const csvPath = scanCsvPath(label)
  if (!fs.existsSync(csvPath)) return new Map()
  const lines = fs.readFileSync(csvPath, "utf8").trim().split("\n")
  const found = new Map<string, { accountId: string; date: string; score: number; margin: number }>()
  for (const line of lines.slice(1)) {
    const [txnId, accountId, date, score, margin] = line.split(",")
    if (!txnId) continue
    found.set(txnId, { accountId, date, score: Number(score), margin: Number(margin) })
  }
  return found
}

export async function POST(request: Request) {
  await connection()
  const body = (await request.json().catch(() => null)) as ExportBody | null
  if (!body) return Response.json({ error: "Send a JSON body." }, { status: 400 })
  const label = slugBehaviour(String(body.label ?? ""))
  if (label.length < 3) return Response.json({ error: "Pick a proposed behaviour." }, { status: 400 })
  if (isKnownFraudType(label)) {
    return Response.json({ error: `${label} is a generator type. Confirm it from the January queue.` }, { status: 409 })
  }
  const txnIds = Array.isArray(body.txnIds) ? [...new Set(body.txnIds.map((id) => String(id)))] : []
  if (txnIds.length === 0) return Response.json({ error: "Tick at least one charge to push." }, { status: 400 })
  if (txnIds.length > 200) {
    return Response.json({ error: "Push at most 200 charges in one CSV." }, { status: 400 })
  }

  const scan = readScan(label)
  const missing = txnIds.filter((id) => !scan.has(id))
  if (missing.length > 0) {
    return Response.json(
      { error: "Those charges are not in the latest scan for this behaviour. Scan again, then push." },
      { status: 400 },
    )
  }

  const examples = await behaviourExamples(label)
  if (!examples.label || examples.label.origin !== "analyst") {
    return Response.json({ error: `${label} is not a proposed behaviour.` }, { status: 404 })
  }

  const user = cleanUser(body.user)
  const note = String(body.note ?? "").trim().slice(0, 240) || `Confirmed from the ${label} scan`
  const rows: FlagWriteRow[] = txnIds.map((txnId) => {
    const hit = scan.get(txnId)!
    return {
      txnId,
      accountId: hit.accountId,
      date: hit.date,
      label,
      description: examples.label!.description,
      origin: "analyst",
      confidence: hit.score,
      margin: hit.margin,
    }
  })

  try {
    const written = await writeFlags(rows, user, note)
    const updated = written.labels.find((item) => item.name === label) ?? examples.label
    const packed = buildFlaggedExport(
      updated,
      rows.map((row) => ({
        txnId: row.txnId,
        accountId: row.accountId,
        date: row.date,
        score: row.confidence,
        margin: row.margin,
      })),
      user,
      note,
    )
    const directory = path.join(process.cwd(), "store", "exports", packed.batch)
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, packed.csvName), packed.csv)
    fs.writeFileSync(path.join(directory, packed.cypherName), packed.cypher)
    return Response.json({
      store: written.store,
      written: written.written,
      label: updated,
      batch: packed.batch,
      csvName: packed.csvName,
      cypherName: packed.cypherName,
      csv: packed.csv,
      cypher: packed.cypher,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "The Neo4j export could not be written."
    return Response.json({ error: message }, { status: 503 })
  }
}
