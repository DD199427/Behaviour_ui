import { BOOK } from "@/lib/book"
import { bandLabel, clock, maskId, merchantLabel, money } from "@/lib/format"
import { groupLabel } from "@/lib/groups"
import { scoreWindow } from "@/lib/score"
import type { BriefSection, CaseFile, PeerRef, Txn, WindowScore } from "@/lib/types"

export const BRIEF_HEADINGS = [
  "What happened",
  "Why it departs",
  "The neighbours",
  "What to do",
] as const

type BriefInput = {
  accountId: string
  accountGroup: string
  groupSummary: string
  peers: PeerRef[]
  txns: Txn[]
  rank1CrossCount: number
  accountCount: number
}

export function rulesBrief(input: BriefInput, revealed?: number): BriefSection[] {
  const txns = input.txns.slice(0, revealed ?? input.txns.length)
  const scored = scoreWindow(input.accountGroup, txns)
  return sectionsFor(input, txns, scored)
}

function sectionsFor(input: BriefInput, txns: Txn[], scored: WindowScore): BriefSection[] {
  const driver = txns[scored.driverIndex]
  const hot = scored.overall
  const strongest = [...hot.signals]
    .filter((signal) => signal.points !== 0)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, 3)
  const same = input.peers.filter((peer) => peer.group === input.accountGroup).length
  const nearest = input.peers[0]
  const total = txns.reduce((sum, txn) => sum + txn.amount, 0)
  const first = txns[0]
  const last = txns[txns.length - 1]
  const label = groupLabel(input.accountGroup)
  const charge =
    txns.length === 1 ? "is 1 charge" : `are ${txns.length} charges`

  const happened = driver
    ? `${maskId(input.accountId)} is in ${input.accountGroup} (${label}). On this tape there ${charge} from ${clock(first.at)} to ${clock(last.at)}, totalling ${money(total)}. The charge that sets the case score is ${money(driver.amount)} at ${merchantLabel(driver.merchantName)} (${driver.category}, merchant group ${driver.merchantGroup}) at ${clock(driver.at)}. That charge scores ${hot.points} points, which is ${bandLabel(hot.band)}.`
    : "There are no charges on the tape yet."

  const departs = driver
    ? [
        ...strongest.map((signal) => signal.detail),
        `The group, measured on 30 Sep 2026, reads: ${input.groupSummary}`,
      ].join(" ")
    : "Nothing to compare yet."

  let neighbours = "This account has no behaviour neighbours in the map."
  if (nearest) {
    const cross =
      nearest.group !== input.accountGroup
        ? `A rank-1 neighbour in another group is uncommon: ${input.rank1CrossCount.toLocaleString("en-US")} of ${input.accountCount.toLocaleString("en-US")} accounts.`
        : "The neighbourhood matches the group, so the question is the tape, not who this account usually behaves like."
    neighbours = `${same} of ${input.peers.length} nearest accounts are also in ${input.accountGroup}. The nearest is ${maskId(nearest.id)} in ${nearest.group}, similarity ${nearest.score.toFixed(4)} on the behaviour vector. ${cross}`
  }

  return [
    { heading: "What happened", body: happened },
    { heading: "Why it departs", body: departs },
    { heading: "The neighbours", body: neighbours },
    { heading: "What to do", body: driver ? actionCopy(hot.band, driver) : "Wait for a charge." },
  ]
}

function actionCopy(band: string, driver: Txn): string {
  const where = `${money(driver.amount)} at ${merchantLabel(driver.merchantName)}`
  if (band === "block") {
    return `Decline the driving charge and lock the card. The burst and the category are doing the work here, not the size of the ticket. Customer line: "We declined a charge of ${where} and locked the card. Call the number on the back of the card if it was you."`
  }
  if (band === "step_up") {
    return `Do not lock the card yet. Step up the driving charge and hold the account for the next few hours. Customer line: "Was this you: ${where}? Reply YES to release it. Reply NO and we will lock the card."`
  }
  if (band === "watch") {
    return "Leave this charge with the customer. Put the account on the watch list until morning. No customer message unless the next charge pushes the case to step-up."
  }
  return "Release it. A challenge on this tape would teach the customer to ignore the real ones."
}

export function evidencePacket(file: CaseFile, revealed: number, rank1CrossCount: number, accountCount: number) {
  const txns = file.txns.slice(0, revealed)
  const scored = scoreWindow(file.accountGroup, txns)
  const driver = txns[scored.driverIndex]
  return {
    product: "Non_Fraud behaviour desk",
    mapAsOf: "2026-09-30",
    mapSchema: "s1/v1",
    account: {
      id: file.accountId,
      masked: maskId(file.accountId),
      group: file.accountGroup,
      groupLabel: groupLabel(file.accountGroup),
      groupSummary: file.groupSummary,
    },
    peers: file.peers.map((peer) => ({
      masked: maskId(peer.id),
      group: peer.group,
      score: peer.score,
    })),
    rank1CrossGroupAccounts: rank1CrossCount,
    accountsInMap: accountCount,
    book: BOOK,
    merchantPrefix:
      "Every merchant name in this book is stored with a fraud_ prefix from the Sparkov generator. The prefix is not a fraud label.",
    tape: txns.map((txn) => ({
      at: txn.at,
      amount: txn.amount,
      category: txn.category,
      merchant: merchantLabel(txn.merchantName),
      merchantGroup: txn.merchantGroup,
    })),
    score: {
      points: scored.overall.points,
      band: scored.overall.band,
      thresholds: { block: 70, stepUp: 46, watch: 28 },
      drivingCharge: driver
        ? {
            at: driver.at,
            amount: driver.amount,
            category: driver.category,
            merchant: merchantLabel(driver.merchantName),
            merchantGroup: driver.merchantGroup,
          }
        : null,
      signals: scored.overall.signals.map((signal) => ({
        label: signal.label,
        points: signal.points,
        detail: signal.detail,
      })),
    },
    draft: sectionsFor(
      {
        accountId: file.accountId,
        accountGroup: file.accountGroup,
        groupSummary: file.groupSummary,
        peers: file.peers,
        txns: file.txns,
        rank1CrossCount,
        accountCount,
      },
      txns,
      scored,
    ),
  }
}

export function parseBrief(text: string): BriefSection[] | null {
  const headings = [...BRIEF_HEADINGS]
  const indexes = headings
    .map((heading) => ({ heading, at: text.indexOf(heading) }))
    .filter((item) => item.at >= 0)
    .sort((a, b) => a.at - b.at)
  if (indexes.length < 4) return null
  return indexes.map((item, index) => {
    const start = item.at + item.heading.length
    const end = indexes[index + 1]?.at ?? text.length
    return {
      heading: item.heading,
      body: text.slice(start, end).replace(/^[\s:–-]+/, "").trim(),
    }
  })
}

