import { connection } from "next/server"
import { getDesk } from "@/lib/cases"

export async function GET() {
  await connection()
  return Response.json(await getDesk())
}
