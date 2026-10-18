import { connection } from "next/server"
import { getCase, getDesk } from "@/lib/cases"
import { rulesBrief } from "@/lib/brief"
import { geminiConfigured, writeGeminiBrief } from "@/lib/gemini"
import type { CaseFile } from "@/lib/types"

type BriefBody = {
  caseId?: string
  revealed?: number
  inline?: CaseFile
}

export async function POST(request: Request) {
  await connection()
  let body: BriefBody
  try {
    body = (await request.json()) as BriefBody
  } catch {
    return Response.json({ error: "Send a JSON body." }, { status: 400 })
  }

  const file = body.inline ? sanitizeInline(body.inline) : await getCase(body.caseId ?? "")
  if (!file) {
    return Response.json({ error: "That case is not on the desk." }, { status: 404 })
  }

  const counts = (await getDesk()).counts
  const revealed = clamp(body.revealed ?? file.txns.length, 1, file.txns.length)
  const fallback = rulesBrief(
    {
      accountId: file.accountId,
      accountGroup: file.accountGroup,
      groupSummary: file.groupSummary,
      peers: file.peers,
      txns: file.txns,
      rank1CrossCount: counts.rank1CrossGroup,
      accountCount: counts.accounts,
    },
    revealed,
  )

  if (!geminiConfigured()) {
    return Response.json({ configured: false, source: "rules", sections: fallback })
  }

  try {
    const written = await writeGeminiBrief(
      file,
      revealed,
      counts.rank1CrossGroup,
      counts.accounts,
    )
    return Response.json({
      configured: true,
      source: "gemini",
      model: written.model,
      sections: written.sections,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini did not answer."
    return Response.json({
      configured: true,
      source: "rules",
      error: message.slice(0, 500),
      sections: fallback,
    })
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return max
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function sanitizeInline(file: CaseFile): CaseFile | null {
  if (!file || typeof file.accountId !== "string" || typeof file.accountGroup !== "string") {
    return null
  }
  if (!Array.isArray(file.txns) || file.txns.length === 0 || file.txns.length > 24) return null
  if (!Array.isArray(file.peers)) return null
  const txns = file.txns.filter(
    (txn) =>
      txn &&
      typeof txn.at === "string" &&
      typeof txn.category === "string" &&
      typeof txn.merchantName === "string" &&
      typeof txn.merchantGroup === "string" &&
      typeof txn.amount === "number",
  )
  if (txns.length !== file.txns.length) return null
  return {
    id: "LIVE",
    title: file.title || "Ad hoc tape",
    scenario: file.scenario || "Typed on the desk.",
    aim: "clear",
    accountId: file.accountId,
    accountGroup: file.accountGroup,
    groupSummary: typeof file.groupSummary === "string" ? file.groupSummary : "",
    peers: file.peers.slice(0, 10).map((peer) => ({
      id: String(peer.id),
      score: Number(peer.score) || 0,
      group: String(peer.group),
    })),
    txns: txns.map((txn, index) => ({
      id: txn.id || `live-${index + 1}`,
      at: txn.at,
      amount: txn.amount,
      category: txn.category,
      merchantName: txn.merchantName,
      merchantGroup: txn.merchantGroup,
    })),
  }
}
