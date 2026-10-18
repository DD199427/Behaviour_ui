import fs from "fs"
import path from "path"
import { graphEnabled, loadBehaviourIndex } from "@/lib/graph"
import type { BehaviourIndex } from "@/lib/types"

let pending: Promise<BehaviourIndex> | null = null

export function getIndex(): Promise<BehaviourIndex> {
  if (!pending) {
    pending = readIndex().catch((error: unknown) => {
      pending = null
      throw error
    })
  }
  return pending
}

async function readIndex(): Promise<BehaviourIndex> {
  if (graphEnabled()) return loadBehaviourIndex()
  const file = path.join(process.cwd(), "data", "behaviour-index.json")
  const raw = fs.readFileSync(file, "utf8")
  return JSON.parse(raw) as BehaviourIndex
}
