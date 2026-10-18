export type Band = "block" | "step_up" | "watch" | "clear"

export type Feature = {
  feature: string
  group: number
  overall: number
  stat: string
  sd: number
}

export type GroupRecord = {
  id: string
  entity: "account" | "merchant"
  size: number
  summary: string
  method: string
  top: Feature[]
}

export type MerchantRecord = {
  name: string
  category: string
  group: string
}

export type BehaviourIndex = {
  asof: string
  schema: string
  version: string
  counts: {
    accounts: number
    merchants: number
    accountLinks: number
    merchantLinks: number
    accountGroups: number
    merchantGroups: number
    crossGroupAccountLinks: number
    rank1CrossGroup: number
  }
  spotlight: {
    accountId: string
    accountGroup: string
    peerId: string
    peerGroup: string
    score: number
  }
  groups: Record<string, GroupRecord>
  roster: Record<string, string[]>
  merchants: MerchantRecord[]
  accounts: Record<string, { g: string; peers: [string, number, string][] }>
}

export type Signal = {
  id: string
  label: string
  detail: string
  points: number
}

export type Scored = {
  points: number
  band: Band
  signals: Signal[]
}

export type ScoreTxn = {
  at: string
  amount: number
  category: string
  merchantGroup: string
}

export type WindowScore = {
  overall: Scored
  perTxn: Scored[]
  driverIndex: number
}

export type Txn = ScoreTxn & {
  id: string
  merchantName: string
}

export type PeerRef = {
  id: string
  score: number
  group: string
}

export type CaseFile = {
  id: string
  title: string
  scenario: string
  aim: Band
  accountId: string
  accountGroup: string
  groupSummary: string
  peers: PeerRef[]
  txns: Txn[]
}

export type DeskPayload = {
  asof: string
  schema: string
  version: string
  counts: BehaviourIndex["counts"]
  cases: CaseFile[]
}

export type BriefSection = {
  heading: string
  body: string
}

export type DecisionAction = "block" | "step_up" | "clear"

export type Decision = {
  action: DecisionAction
  at: string
}

export type DeskMeta = {
  ok: boolean
  gemini: boolean
  model: string
  asof: string
  store: "neo4j" | "file"
  counts: BehaviourIndex["counts"]
}
