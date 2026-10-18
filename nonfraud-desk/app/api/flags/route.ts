import { connection } from "next/server"
import {
  FRAUD_NOTES,
  isKnownFraudType,
  slugBehaviour,
} from "@/lib/behaviour-copy"
import { listFlags, proposeLabel, writeFlags, type FlagWriteRow } from "@/lib/flags"
import { getTriageIndex } from "@/lib/triage-store"

type ProposeBody = { name?: unknown; description?: unknown }

type FlagBody = {
  user?: unknown
  note?: unknown
  txnIds?: unknown
  label?: unknown
  description?: unknown
  useClosest?: unknown
  propose?: ProposeBody
}

function cleanUser(value: unknown): string {
  const user = String(value ?? "").trim().slice(0, 40)
  return user || "analyst"
}

export async function GET() {
  await connection()
  try {
    return Response.json(await listFlags())
  } catch (error) {
    console.error(error)
    return Response.json({ error: "Confirmed flags could not be read." }, { status: 503 })
  }
}

export async function POST(request: Request) {
  await connection()
  const body = (await request.json().catch(() => null)) as FlagBody | null
  if (!body) return Response.json({ error: "Send a JSON body." }, { status: 400 })
  const user = cleanUser(body.user)
  const note = String(body.note ?? "").trim().slice(0, 240)

  if (body.propose) {
    const name = slugBehaviour(String(body.propose.name ?? ""))
    const description = String(body.propose.description ?? "").trim().slice(0, 500)
    if (name.length < 3) {
      return Response.json({ error: "Give the behaviour a name of at least 3 letters." }, { status: 400 })
    }
    if (isKnownFraudType(name)) {
      return Response.json(
        { error: `${name} is one of the six generator types. Pick a different name.` },
        { status: 409 },
      )
    }
    if (!description) {
      return Response.json({ error: "Describe the behaviour before creating it." }, { status: 400 })
    }
    try {
      const label = await proposeLabel(name, description, user)
      return Response.json({ label })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create the behaviour."
      return Response.json({ error: message }, { status: 409 })
    }
  }

  const txnIds = Array.isArray(body.txnIds) ? [...new Set(body.txnIds.map((id) => String(id)))] : []
  if (txnIds.length === 0) return Response.json({ error: "Pick at least one transaction." }, { status: 400 })
  if (txnIds.length > 200) {
    return Response.json({ error: "Confirm at most 200 transactions at a time." }, { status: 400 })
  }

  const index = await getTriageIndex()
  const missing = txnIds.filter((id) => !index.byTxn.has(id))
  if (missing.length > 0) {
    return Response.json({ error: "One of those transactions is not in the January queue." }, { status: 400 })
  }

  const useClosest = body.useClosest === true
  let explicit = ""
  let explicitDescription = ""
  if (!useClosest) {
    const raw = String(body.label ?? "").trim()
    explicit = isKnownFraudType(raw) ? raw : slugBehaviour(raw)
    if (explicit.length < 3 || explicit === "normal") {
      return Response.json({ error: "Pick a behaviour, or confirm each row as its closest type." }, { status: 400 })
    }
    explicitDescription = isKnownFraudType(explicit)
      ? FRAUD_NOTES[explicit]
      : String(body.description ?? "").trim().slice(0, 500)
    if (!isKnownFraudType(explicit) && explicitDescription.length < 3) {
      return Response.json({ error: "Describe the new behaviour before confirming charges under it." }, { status: 400 })
    }
  }

  const rows: FlagWriteRow[] = txnIds.map((txnId) => {
    const source = index.byTxn.get(txnId)!
    const label = useClosest ? source.match : explicit
    return {
      txnId,
      accountId: source.accountId,
      date: source.date,
      label,
      description: useClosest ? (FRAUD_NOTES[label] ?? "") : explicitDescription || FRAUD_NOTES[label] || "",
      origin: isKnownFraudType(label) ? "generator" : "analyst",
      confidence: source.score,
      margin: source.margin,
    }
  })

  try {
    const result = await writeFlags(rows, user, note)
    return Response.json(result)
  } catch {
    return Response.json({ error: "The flag could not be written." }, { status: 503 })
  }
}
