import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { slugBehaviour } from "@/lib/behaviour-copy"

export type ScanRow = {
  txnId: string
  accountId: string
  date: string
  score: number
  margin: number
}

export type ScanResult = {
  scanned: number
  skipped: number
  expected: number
  complete: boolean
  examplesRequested: number
  examplesFound: number
  missing: string[]
  margin: number
  matched: number
  truncated: boolean
  rows: ScanRow[]
  csvPath: string
}

type ScanRequest = {
  label: string
  examples: string[]
  exclude: string[]
  margin: number
}

function vectorDir(): string {
  const source = process.env.BEHAVIOUR_UI || "/tmp/Behaviour_ui"
  return path.join(source, "data", "neo4j_export", "s1", "transaction_vectors")
}

export function vectorsAvailable(): boolean {
  const dir = vectorDir()
  if (!fs.existsSync(dir)) return false
  return fs.readdirSync(dir).some((name) => name.startsWith("part-") && name.endsWith(".csv.gz"))
}

export function scanCsvPath(label: string): string {
  return path.join(process.cwd(), "store", "scans", `${slugBehaviour(label)}.csv`)
}

export async function scanBehaviour(request: ScanRequest): Promise<ScanResult> {
  if (!vectorsAvailable()) {
    throw new Error(
      "The January 2025 transaction vectors are not on this machine. Set BEHAVIOUR_UI to the Behaviour UI export and scan again.",
    )
  }
  const csvPath = scanCsvPath(request.label)
  fs.mkdirSync(path.dirname(csvPath), { recursive: true })
  const payload = {
    examples: request.examples,
    exclude: request.exclude,
    margin: request.margin,
    limit: 200,
    cap: 5000,
    source: process.env.BEHAVIOUR_UI || "/tmp/Behaviour_ui",
    prototypes: path.join(process.cwd(), "data", "fraud-type-prototypes.json"),
    csv: csvPath,
  }
  const script = path.join(process.cwd(), "scripts", "scan_behaviour.py")
  const stdout = await runPython(script, JSON.stringify(payload))
  const parsed = JSON.parse(stdout) as Omit<ScanResult, "csvPath">
  return { ...parsed, csvPath }
}

function runPython(script: string, stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [script], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error("The behaviour scan took too long and was stopped."))
    }, 120_000)
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk))
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve(Buffer.concat(out).toString("utf8"))
        return
      }
      const message = Buffer.concat(err).toString("utf8").trim() || Buffer.concat(out).toString("utf8").trim()
      reject(new Error(message || "The behaviour scan failed."))
    })
    child.stdin.end(stdin)
  })
}
