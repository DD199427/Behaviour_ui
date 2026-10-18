import { connection } from "next/server"
import { getIndex } from "@/lib/index-store"

export async function GET() {
  await connection()
  const index = await getIndex()
  const groups = Object.values(index.groups).sort((a, b) => a.id.localeCompare(b.id))
  const merchantSamples: Record<string, { name: string; category: string }[]> = {}
  const accountSamples: Record<string, string[]> = {}
  for (const group of groups) {
    if (group.entity === "merchant") {
      merchantSamples[group.id] = index.merchants
        .filter((merchant) => merchant.group === group.id)
        .slice(0, 4)
        .map((merchant) => ({ name: merchant.name, category: merchant.category }))
    } else {
      accountSamples[group.id] = (index.roster[group.id] ?? []).slice(0, 3)
    }
  }
  return Response.json({
    asof: index.asof,
    schema: index.schema,
    version: index.version,
    counts: index.counts,
    groups,
    merchantSamples,
    accountSamples,
  })
}
