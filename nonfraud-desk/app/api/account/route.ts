import { connection } from "next/server"
import { searchAccounts } from "@/lib/cases"
import { accountNeighbourhood, graphEnabled } from "@/lib/graph"
import { getIndex } from "@/lib/index-store"

export async function GET(request: Request) {
  await connection()
  const params = new URL(request.url).searchParams
  const id = params.get("id")?.trim()
  if (id) {
    if (graphEnabled()) {
      const detail = await accountNeighbourhood(id)
      if (!detail) {
        return Response.json({ error: "That account is not in the behaviour map." }, { status: 404 })
      }
      return Response.json(detail)
    }
    const index = await getIndex()
    const account = index.accounts[id]
    if (!account) {
      return Response.json({ error: "That account is not in the behaviour map." }, { status: 404 })
    }
    const group = index.groups[account.g]
    return Response.json({
      id,
      group: account.g,
      groupSummary: group?.summary ?? "",
      peers: account.peers.map(([peerId, score, peerGroup]) => ({
        id: peerId,
        score,
        group: peerGroup,
      })),
    })
  }

  const query = params.get("q") ?? ""
  return Response.json({ accounts: await searchAccounts(query) })
}
