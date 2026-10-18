import { connection } from "next/server"
import { graphEnabled } from "@/lib/graph"
import { flagMap } from "@/lib/flags"
import { getTriageIndex } from "@/lib/triage-store"

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

export async function GET(request: Request) {
  await connection()
  const url = new URL(request.url)
  const account = (url.searchParams.get("account") ?? "").replace(/\s/g, "")
  const index = await getTriageIndex()
  const rawLimit = Number(url.searchParams.get("limit") ?? (account ? 3 : 200))
  const limit = Number.isFinite(rawLimit) ? clamp(Math.floor(rawLimit), 1, 200) : account ? 3 : 200
  const rawMargin = url.searchParams.get("margin")
  const requested = rawMargin == null || rawMargin === "" ? (account ? index.meta.floor : 0.5) : Number(rawMargin)
  if (!Number.isFinite(requested)) {
    return Response.json({ error: "Margin must be a number." }, { status: 400 })
  }
  const margin = clamp(requested, index.meta.floor, 1.5)
  const pool = account ? (index.byAccount.get(account) ?? []) : index.rows
  const above = pool.filter((row) => row.margin + 1e-9 >= margin)

  let flags: Map<string, string[]>
  try {
    flags = await flagMap()
  } catch {
    return Response.json({ error: "Confirmed flags could not be read." }, { status: 503 })
  }

  const visible = account ? above : above.filter((row) => !flags.has(row.txnId))
  const rows = visible.slice(0, limit).map((row) => ({
    ...row,
    flagLabels: flags.get(row.txnId) ?? [],
  }))

  return Response.json({
    meta: index.meta,
    margin,
    matched: visible.length,
    rows,
    store: graphEnabled() ? "neo4j" : "file",
  })
}
