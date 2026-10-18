import fs from "node:fs"
import path from "node:path"
import { connection } from "next/server"
import { MIN_ENTITIES, MIN_FLAGS, isKnownFraudType, slugBehaviour, type FlagLabel } from "@/lib/behaviour-copy"
import { behaviourExamples, flagMap, writeFlags, type FlagWriteRow } from "@/lib/flags"
import { buildFlaggedExport } from "@/lib/neo4j-export"
import { scanBehaviour, scanCsvPath, vectorsAvailable, type ScanRow } from "@/lib/scan"

export const maxDuration = 120

function cleanMargin(value: unknown): number {
  const margin = Number(value)
  if (!Number.isFinite(margin)) return 0.5
  return Math.min(1.2, Math.max(0.2, Math.round(margin * 20) / 20))
}

function cleanExamples(value: unknown): string[] | null {
  if (value == null) return null
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .map((id) => String(id).trim())
        .filter((id) => /^[a-zA-Z0-9]{8,64}$/.test(id)),
    ),
  ].slice(0, 100)
}

function draftLabel(name: string, description: string): FlagLabel {
  return {
    name,
    status: "candidate",
    origin: "analyst",
    description,
    flags: 0,
    entities: 0,
    flagsNeeded: MIN_FLAGS,
    entitiesNeeded: MIN_ENTITIES,
  }
}

export async function GET(request: Request) {
  await connection()
  const label = slugBehaviour(new URL(request.url).searchParams.get("label") ?? "")
  if (!label) {
    return Response.json({
      use: "Scan January charges against a proposed behaviour and build the Neo4j load files.",
      method: "POST",
      path: "/api/scan",
      body: {
        label: "behaviour name",
        description: "What the behaviour is. Required when push creates a new name.",
        examples: ["january transaction id", "another id"],
        margin: 0.5,
        push: false,
      },
      response: {
        rows: "Up to 200 charges above the margin, highest first.",
        csv: "flagged_behaviours.csv for those charges",
        cypher: "load_flagged_behaviours.cypher. MERGE, safe to re-run.",
        pushed: "True only when the request set push and the charges were written to this Neo4j.",
      },
    })
  }
  if (label.length < 3) return Response.json({ error: "Name the behaviour to download its scan." }, { status: 400 })
  const csvPath = scanCsvPath(label)
  if (!fs.existsSync(csvPath)) {
    return Response.json({ error: "Scan this behaviour before downloading the CSV." }, { status: 404 })
  }
  const csv = fs.readFileSync(csvPath, "utf8")
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${label}-scan.csv"`,
    },
  })
}

function saveExport(batch: string, csvName: string, cypherName: string, csv: string, cypher: string) {
  const directory = path.join(process.cwd(), "store", "exports", batch)
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, csvName), csv)
  fs.writeFileSync(path.join(directory, cypherName), cypher)
}

export async function POST(request: Request) {
  await connection()
  const body = (await request.json().catch(() => null)) as {
    label?: unknown
    description?: unknown
    examples?: unknown
    margin?: unknown
    push?: unknown
    user?: unknown
    note?: unknown
  } | null
  if (!body) return Response.json({ error: "Send a JSON body." }, { status: 400 })
  const label = slugBehaviour(String(body.label ?? ""))
  if (label.length < 3) {
    return Response.json({ error: "Name the proposed behaviour." }, { status: 400 })
  }
  if (isKnownFraudType(label)) {
    return Response.json(
      { error: `${label} already has a generator prototype. Use the January queue for that type.` },
      { status: 409 },
    )
  }
  if (!vectorsAvailable()) {
    return Response.json(
      {
        error:
          "The January 2025 transaction vectors are not on this machine. Set BEHAVIOUR_UI to the Behaviour UI export and scan again.",
      },
      { status: 503 },
    )
  }

  const requestedExamples = cleanExamples(body.examples)
  if (requestedExamples && requestedExamples.length === 0) {
    return Response.json({ error: "examples must be January transaction ids." }, { status: 400 })
  }
  const push = body.push === true
  const description = String(body.description ?? "").trim().slice(0, 500)
  const user = String(body.user ?? "").trim().slice(0, 40) || "analyst"
  const note = String(body.note ?? "").trim().slice(0, 240) || `Scan of ${label}`

  try {
    const existing = await behaviourExamples(label)
    if (existing.label && existing.label.origin !== "analyst") {
      return Response.json({ error: "Only a behaviour this desk proposed can be scanned this way." }, { status: 409 })
    }
    const exampleIds = requestedExamples ?? existing.txnIds
    if (exampleIds.length === 0) {
      return Response.json(
        {
          error:
            "Send examples, or confirm at least one January charge under this name first. A behaviour with no charges has no signature.",
        },
        { status: 409 },
      )
    }
    if (push && !existing.label && description.length < 3) {
      return Response.json({ error: "Describe the behaviour before pushing a new name into Neo4j." }, { status: 400 })
    }

    const flagged = await flagMap()
    const exclude = new Set<string>([...flagged.keys(), ...exampleIds])
    const result = await scanBehaviour({
      label,
      examples: exampleIds,
      exclude: [...exclude],
      margin: cleanMargin(body.margin),
    })
    const charges = result.rows.map((row: ScanRow) => ({
      txnId: row.txnId,
      accountId: row.accountId,
      date: row.date,
      score: row.score,
      margin: row.margin,
    }))

    let pushed = false
    let labelRecord = existing.label ?? draftLabel(label, description || `Proposed behaviour ${label}`)
    if (push && charges.length > 0) {
      const rows: FlagWriteRow[] = charges.map((charge) => ({
        txnId: charge.txnId,
        accountId: charge.accountId,
        date: charge.date,
        label,
        description: description || labelRecord.description,
        origin: "analyst",
        confidence: charge.score,
        margin: charge.margin,
      }))
      const written = await writeFlags(rows, user, note)
      labelRecord = written.labels.find((item) => item.name === label) ?? labelRecord
      pushed = true
    }

    const packed = buildFlaggedExport(labelRecord, charges, user, note)
    saveExport(packed.batch, packed.csvName, packed.cypherName, packed.csv, packed.cypher)
    return Response.json({
      label: labelRecord,
      scanned: result.scanned,
      skipped: result.skipped,
      expected: result.expected,
      complete: result.complete,
      examplesRequested: result.examplesRequested,
      examplesFound: result.examplesFound,
      missing: result.missing,
      margin: result.margin,
      matched: result.matched,
      truncated: result.truncated,
      rows: result.rows,
      pushed,
      batch: packed.batch,
      csvName: packed.csvName,
      cypherName: packed.cypherName,
      csv: packed.csv,
      cypher: packed.cypher,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "The behaviour scan failed."
    return Response.json({ error: message }, { status: 503 })
  }
}
