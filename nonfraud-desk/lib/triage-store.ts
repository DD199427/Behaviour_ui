import fs from "fs"
import path from "path"
import type { TriageMeta, TriageRow } from "@/lib/behaviour-copy"

type TriageIndex = {
  meta: TriageMeta
  rows: TriageRow[]
  byAccount: Map<string, TriageRow[]>
  byTxn: Map<string, TriageRow>
}

let pending: Promise<TriageIndex> | null = null

function readIndex(): TriageIndex {
  const dir = path.join(process.cwd(), "data")
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "triage-meta.json"), "utf8")) as TriageMeta
  const text = fs.readFileSync(path.join(dir, "triage.csv"), "utf8")
  const lines = text.split("\n")
  const rows: TriageRow[] = []
  const byAccount = new Map<string, TriageRow[]>()
  const byTxn = new Map<string, TriageRow>()
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line) continue
    const [txnId, accountId, date, match, score, margin] = line.split(",")
    const row: TriageRow = {
      txnId,
      accountId,
      date,
      match,
      score: Number(score),
      margin: Number(margin),
    }
    rows.push(row)
    byTxn.set(txnId, row)
    const bucket = byAccount.get(accountId)
    if (bucket) bucket.push(row)
    else byAccount.set(accountId, [row])
  }
  for (const bucket of byAccount.values()) {
    bucket.sort((a, b) => b.margin - a.margin)
  }
  return { meta, rows, byAccount, byTxn }
}

export function getTriageIndex(): Promise<TriageIndex> {
  if (!pending) {
    pending = Promise.resolve()
      .then(readIndex)
      .catch((error: unknown) => {
        pending = null
        throw error
      })
  }
  return pending
}

export function readFraudLibrary(): {
  events: number
  source: string
  types: {
    id: string
    enteredBy: string
    events: number
    medianDelayDays: number
    medianDurationDays: number
    medianLoss: number
    totalLoss: number
  }[]
} {
  const file = path.join(process.cwd(), "data", "fraud-library.json")
  return JSON.parse(fs.readFileSync(file, "utf8"))
}
