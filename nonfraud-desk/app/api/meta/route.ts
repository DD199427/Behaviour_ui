import { connection } from "next/server"
import { geminiConfigured, geminiModel } from "@/lib/gemini"
import { graphLabel } from "@/lib/graph"
import { getIndex } from "@/lib/index-store"

export async function GET() {
  await connection()
  const index = await getIndex()
  return Response.json({
    ok: true,
    gemini: geminiConfigured(),
    model: geminiModel(),
    asof: index.asof,
    store: graphLabel(),
    counts: index.counts,
  })
}
