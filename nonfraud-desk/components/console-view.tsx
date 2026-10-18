"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { CaseFile } from "@/components/case-file"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { merchantLabel, maskId } from "@/lib/format"
import { groupLabel } from "@/lib/groups"
import type { BehaviourIndex, CaseFile as CaseFileData, Decision, DecisionAction, PeerRef } from "@/lib/types"

type Draft = {
  key: string
  at: string
  amount: string
  merchantName: string
  category: string
  merchantGroup: string
  query: string
}

type AccountHit = { id: string; group: string }
type MerchantHit = { name: string; category: string; group: string }
type Detail = {
  id: string
  group: string
  groupSummary: string
  peers: PeerRef[]
}

const PRESET_IDS = ["NF-4410", "NF-4426", "NF-4418"]

function blankDraft(key: string): Draft {
  return {
    key,
    at: "2026-10-16T22:06",
    amount: "",
    merchantName: "",
    category: "",
    merchantGroup: "",
    query: "",
  }
}

export function ConsoleView() {
  const [accountQuery, setAccountQuery] = useState("")
  const [accountHits, setAccountHits] = useState<AccountHit[]>([])
  const [detail, setDetail] = useState<Detail | null>(null)
  const draftSeq = useRef(1)
  const [drafts, setDrafts] = useState<Draft[]>([blankDraft("draft-1")])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [merchantHits, setMerchantHits] = useState<MerchantHit[]>([])
  const [cases, setCases] = useState<CaseFileData[]>([])
  const [counts, setCounts] = useState<BehaviourIndex["counts"] | null>(null)
  const [gemini, setGemini] = useState(false)
  const [model, setModel] = useState("gemini-3.5-flash-lite")
  const [decision, setDecision] = useState<Decision | undefined>(undefined)
  const [accountError, setAccountError] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    Promise.all([fetch("/api/desk"), fetch("/api/meta")])
      .then(async ([deskResponse, metaResponse]) => {
        const desk = await deskResponse.json()
        const meta = metaResponse.ok ? await metaResponse.json() : null
        if (cancel) return
        if (deskResponse.ok) {
          setCases(desk.cases as CaseFileData[])
          setCounts(desk.counts)
        }
        if (meta?.gemini) setGemini(true)
        if (meta?.model) setModel(meta.model)
      })
      .catch(() => undefined)
    return () => {
      cancel = true
    }
  }, [])

  useEffect(() => {
    const query = accountQuery.trim()
    if ((detail && query === detail.id) || query.length < 3) return
    const timer = window.setTimeout(() => {
      fetch(`/api/account?q=${encodeURIComponent(query)}`)
        .then((response) => response.json())
        .then((body: { accounts?: AccountHit[] }) => setAccountHits(body.accounts ?? []))
        .catch(() => setAccountHits([]))
    }, 160)
    return () => window.clearTimeout(timer)
  }, [accountQuery, detail])

  useEffect(() => {
    const draft = drafts.find((item) => item.key === activeKey)
    const query = draft?.query.trim() ?? ""
    if (!draft || query.length < 2 || draft.merchantName) return
    const timer = window.setTimeout(() => {
      fetch(`/api/merchants?q=${encodeURIComponent(query)}`)
        .then((response) => response.json())
        .then((body: { merchants?: MerchantHit[] }) => setMerchantHits(body.merchants ?? []))
        .catch(() => setMerchantHits([]))
    }, 160)
    return () => window.clearTimeout(timer)
  }, [drafts, activeKey])

  async function selectAccount(id: string) {
    setAccountError(null)
    const response = await fetch(`/api/account?id=${encodeURIComponent(id)}`)
    const body = await response.json()
    if (!response.ok) {
      setAccountError(body.error || "That account is not in the map.")
      return
    }
    setDetail(body as Detail)
    setAccountHits([])
    setAccountQuery(id)
    setDecision(undefined)
  }

  function loadPreset(file: CaseFileData) {
    setDetail({
      id: file.accountId,
      group: file.accountGroup,
      groupSummary: file.groupSummary,
      peers: file.peers,
    })
    setAccountQuery(file.accountId)
    setDrafts(
      file.txns.map((txn) => ({
        key: txn.id,
        at: txn.at.slice(0, 16),
        amount: String(txn.amount),
        merchantName: txn.merchantName,
        category: txn.category,
        merchantGroup: txn.merchantGroup,
        query: merchantLabel(txn.merchantName),
      })),
    )
    setDecision(undefined)
    setAccountError(null)
  }

  function updateDraft(key: string, patch: Partial<Draft>) {
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)))
    setDecision(undefined)
  }

  const liveFile = useMemo(() => {
    if (!detail || drafts.length === 0) return null
    const txns = []
    for (const draft of drafts) {
      const amount = Number(draft.amount)
      if (!draft.merchantName || !draft.merchantGroup || !Number.isFinite(amount) || amount <= 0) return null
      const at = draft.at.length === 16 ? `${draft.at}:00` : draft.at
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(at)) return null
      txns.push({
        id: draft.key,
        at,
        amount,
        category: draft.category,
        merchantName: draft.merchantName,
        merchantGroup: draft.merchantGroup,
      })
    }
    txns.sort((a, b) => a.at.localeCompare(b.at))
    return {
      id: "LIVE",
      title: "Typed on the desk",
      scenario:
        "This tape was entered here and scored against the behaviour map. It is not one of the twelve scripted cases.",
      aim: "clear" as const,
      accountId: detail.id,
      accountGroup: detail.group,
      groupSummary: detail.groupSummary,
      peers: detail.peers,
      txns,
    }
  }, [detail, drafts])

  function decide(action: DecisionAction | null) {
    setDecision(action ? { action, at: new Date().toISOString() } : undefined)
  }

  const presets = PRESET_IDS.map((id) => cases.find((file) => file.id === id)).filter(
    (file): file is CaseFileData => Boolean(file),
  )

  return (
    <div className="lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[24rem_minmax(0,1fr)] lg:overflow-hidden">
      <form
        className="space-y-5 border-b border-border p-4 lg:overflow-auto lg:border-r lg:border-b-0"
        onSubmit={(event) => event.preventDefault()}
      >
        <div>
          <h1 className="font-heading text-3xl tracking-tight">Try a charge</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Pick a real account and a real merchant. The score uses the same weights as the night desk.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.map((file) => (
            <Button key={file.id} type="button" variant="outline" size="sm" onClick={() => loadPreset(file)}>
              {file.id}
            </Button>
          ))}
        </div>
        <div className="space-y-2">
          <Label htmlFor="account">Account</Label>
          <Input
            id="account"
            value={accountQuery}
            placeholder="Last digits, at least 3"
            onChange={(event) => {
              setAccountQuery(event.target.value)
              setDetail(null)
            }}
            autoComplete="off"
          />
          {accountQuery.trim().length >= 3 && (!detail || accountQuery.trim() !== detail.id) && accountHits.length > 0 ? (
            <ul className="overflow-hidden rounded-lg border border-border">
              {accountHits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => void selectAccount(hit.id)}
                  >
                    <span className="font-mono">{maskId(hit.id)}</span>
                    <span className="text-muted-foreground">{hit.group}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {accountError ? <p className="text-sm text-muted-foreground">{accountError}</p> : null}
          {detail ? (
            <p className="text-sm leading-6 text-muted-foreground">
              {maskId(detail.id)} · {detail.group} · {groupLabel(detail.group)}. {detail.groupSummary}
            </p>
          ) : null}
        </div>
        <div className="space-y-4">
          {drafts.map((draft, index) => (
            <fieldset key={draft.key} className="space-y-2 rounded-xl border border-border p-3">
              <legend className="px-1 text-xs text-muted-foreground">Charge {index + 1}</legend>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor={`${draft.key}-at`}>Time</Label>
                  <Input
                    id={`${draft.key}-at`}
                    type="datetime-local"
                    value={draft.at}
                    onChange={(event) => updateDraft(draft.key, { at: event.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${draft.key}-amt`}>Amount</Label>
                  <Input
                    id={`${draft.key}-amt`}
                    inputMode="decimal"
                    value={draft.amount}
                    placeholder="186.40"
                    onChange={(event) => updateDraft(draft.key, { amount: event.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${draft.key}-merch`}>Merchant</Label>
                <Input
                  id={`${draft.key}-merch`}
                  value={draft.query}
                  placeholder="Search the map"
                  autoComplete="off"
                  onFocus={() => setActiveKey(draft.key)}
                  onChange={(event) => {
                    setActiveKey(draft.key)
                    updateDraft(draft.key, {
                      query: event.target.value,
                      merchantName: "",
                      merchantGroup: "",
                      category: "",
                    })
                  }}
                />
                {activeKey === draft.key && !draft.merchantName && draft.query.trim().length >= 2 && merchantHits.length > 0 ? (
                  <ul className="max-h-48 overflow-auto rounded-lg border border-border">
                    {merchantHits.map((hit) => (
                      <li key={`${hit.name}-${hit.category}`}>
                        <button
                          type="button"
                          className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-muted"
                          onClick={() => {
                            updateDraft(draft.key, {
                              query: merchantLabel(hit.name),
                              merchantName: hit.name,
                              category: hit.category,
                              merchantGroup: hit.group,
                            })
                            setMerchantHits([])
                          }}
                        >
                          <span>{merchantLabel(hit.name)}</span>
                          <span className="text-xs text-muted-foreground">
                            {hit.category} · {hit.group}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {draft.merchantName ? (
                  <p className="text-xs text-muted-foreground">
                    {draft.category} · {draft.merchantGroup} · {groupLabel(draft.merchantGroup)}
                  </p>
                ) : null}
              </div>
              {drafts.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDrafts((current) => current.filter((item) => item.key !== draft.key))}
                >
                  Remove charge
                </Button>
              ) : null}
            </fieldset>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              draftSeq.current += 1
              const key = `draft-${draftSeq.current}`
              setDrafts((current) => [...current, blankDraft(key)])
            }}
            disabled={drafts.length >= 12}
          >
            Add a charge
          </Button>
        </div>
      </form>
      <div className="min-h-[70vh] lg:h-full lg:min-h-0">
        {liveFile && counts ? (
          <CaseFile
            key={liveFile.txns.map((txn) => `${txn.id}:${txn.at}:${txn.amount}:${txn.merchantName}`).join("|")}
            file={liveFile}
            counts={counts}
            gemini={gemini}
            model={model}
            decision={decision}
            onDecision={decide}
            briefMode="inline"
          />
        ) : (
          <div className="p-6">
            <h2 className="font-heading text-2xl">Waiting on a complete tape</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              Choose an account, then give each charge a time, an amount, and a merchant from the map.
              Load NF-4410 to start from the night burst and edit it.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
