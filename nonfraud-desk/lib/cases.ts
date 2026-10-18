import { graphEnabled, searchAccountNodes, searchMerchantNodes } from "@/lib/graph"
import { getIndex } from "@/lib/index-store"
import { SCENARIOS, type Scenario, type ScenarioTxn } from "@/lib/scenarios"
import { scoreWindow } from "@/lib/score"
import type { BehaviourIndex, CaseFile, DeskPayload, MerchantRecord, Txn } from "@/lib/types"

let cached: DeskPayload | null = null

export async function getDesk(): Promise<DeskPayload> {
  if (!cached) cached = buildDesk(await getIndex())
  return cached
}

export async function getCase(id: string): Promise<CaseFile | undefined> {
  return (await getDesk()).cases.find((item) => item.id === id)
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

function stamp(txn: ScenarioTxn): string {
  return `${txn.day}T${pad(txn.hour)}:${pad(txn.minute)}:00`
}

function merchantsFor(index: BehaviourIndex, category: string, group: string): MerchantRecord[] {
  return index.merchants.filter((merchant) => merchant.category === category && merchant.group === group)
}

function pickMerchant(index: BehaviourIndex, txn: ScenarioTxn, caseId: string): MerchantRecord {
  const found = merchantsFor(index, txn.category, txn.merchantGroup)
  if (found.length === 0) {
    throw new Error(`No merchant for ${txn.category} in ${txn.merchantGroup} (${caseId})`)
  }
  return found[txn.merchantNth % found.length]
}

function pickAccount(index: BehaviourIndex, scenario: Scenario, used: Set<string>): string {
  if (scenario.useSpotlight) {
    const id = index.spotlight.accountId
    if (used.has(id)) throw new Error(`Spotlight account already used (${scenario.id})`)
    used.add(id)
    return id
  }
  const roster = index.roster[scenario.accountGroup]
  if (!roster?.length) throw new Error(`Empty roster ${scenario.accountGroup}`)
  let cursor = scenario.accountNth
  while (used.has(roster[cursor % roster.length])) cursor += 1
  const id = roster[cursor % roster.length]
  used.add(id)
  return id
}

export function buildDesk(index: BehaviourIndex): DeskPayload {
  const used = new Set<string>()
  const cases = SCENARIOS.map((scenario) => materialize(index, scenario, used))
  for (const file of cases) {
    const scored = scoreWindow(file.accountGroup, file.txns)
    if (scored.overall.band !== file.aim) {
      const parts = scored.overall.signals.map((signal) => `${signal.points} ${signal.id}`).join(", ")
      throw new Error(
        `${file.id} aimed ${file.aim} and landed ${scored.overall.band} (${scored.overall.points}: ${parts})`,
      )
    }
  }
  return {
    asof: index.asof,
    schema: index.schema,
    version: index.version,
    counts: index.counts,
    cases,
  }
}

function materialize(index: BehaviourIndex, scenario: Scenario, used: Set<string>): CaseFile {
  const accountId = pickAccount(index, scenario, used)
  const account = index.accounts[accountId]
  if (!account) throw new Error(`Missing account ${accountId}`)
  const group = index.groups[account.g]
  const txns: Txn[] = scenario.txns.map((txn, ordinal) => {
    const merchant = pickMerchant(index, txn, scenario.id)
    return {
      id: `${scenario.id}-${ordinal + 1}`,
      at: stamp(txn),
      amount: txn.amount,
      category: txn.category,
      merchantGroup: merchant.group,
      merchantName: merchant.name,
    }
  })
  return {
    id: scenario.id,
    title: scenario.title,
    scenario: scenario.scenario,
    aim: scenario.aim,
    accountId,
    accountGroup: account.g,
    groupSummary: group?.summary ?? "",
    peers: account.peers.map(([id, score, groupId]) => ({ id, score, group: groupId })),
    txns,
  }
}

export async function searchAccounts(query: string, limit = 8) {
  if (graphEnabled()) return searchAccountNodes(query, limit)
  const index = await getIndex()
  const needle = query.replace(/\s/g, "")
  if (needle.length < 3) return []
  const hits: { id: string; group: string }[] = []
  for (const [id, account] of Object.entries(index.accounts)) {
    if (id.includes(needle)) {
      hits.push({ id, group: account.g })
      if (hits.length >= limit) break
    }
  }
  return hits
}

export async function searchMerchants(query: string, category: string, limit = 12) {
  if (graphEnabled()) return searchMerchantNodes(query, category, limit)
  const index = await getIndex()
  const needle = query.trim().toLowerCase().replace(/^fraud_/, "")
  const hits = []
  for (const merchant of index.merchants) {
    if (category && merchant.category !== category) continue
    const label = merchant.name.replace(/^fraud_/, "").toLowerCase()
    if (!needle || label.includes(needle) || merchant.name.toLowerCase().includes(needle)) {
      hits.push(merchant)
      if (hits.length >= limit) break
    }
  }
  return hits
}
