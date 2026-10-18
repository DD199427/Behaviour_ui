import { connection } from "next/server"
import { searchMerchants } from "@/lib/cases"

export async function GET(request: Request) {
  await connection()
  const params = new URL(request.url).searchParams
  const query = params.get("q") ?? ""
  const category = params.get("category") ?? ""
  return Response.json({ merchants: await searchMerchants(query, category) })
}
