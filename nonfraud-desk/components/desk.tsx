"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { CaseFile } from "@/components/case-file"
import { BandPill } from "@/components/band-pill"
import { Button } from "@/components/ui/button"
import { countLabel, money, maskId } from "@/lib/format"
import { groupLabel } from "@/lib/groups"
import { scoreWindow } from "@/lib/score"
import type { Band, Decision, DecisionAction, DeskPayload } from "@/lib/types"
import { cn } from "cn"

const STORAGE_KEY = "nonfraud-decisions-v1"

type Filter = "all" | "open" | Band

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "block", label: "Block" },
  { id: "step_up", label: "Step up" },
  { id: "watch", label: "Watch" },
  { id: "clear", label: "Clear" },
]

export function Desk() {
  const [payload, setPayload] = useState<DeskPayload | null>(null)
  const [gemini, setGemini] = useState(false)
  const [model, setModel] = useState("gemini-3.5-flash-lite")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>("all")
  const [showCase, setShowCase] = useState(false)
  const decisionRaw = useSyncExternalStore(subscribeDecisions, readDecisionRaw, () => "")
  const decisions = useMemo(() => parseDecisions(decisionRaw), [decisionRaw])

  useEffect(() => {
    let cancel = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [deskResponse, metaResponse] = await Promise.all([
          fetch("/api/desk"),
          fetch("/api/meta"),
        ])
        const deskBody = await deskResponse.json()
        if (!deskResponse.ok) {
          throw new Error(deskBody.error || "The behaviour map did not load.")
        }
        const metaBody = metaResponse.ok ? await metaResponse.json() : null
        if (cancel) return
        setPayload(deskBody as DeskPayload)
        if (metaBody?.gemini) setGemini(true)
        if (metaBody?.model) setModel(metaBody.model)
      } catch (loadError) {
        if (!cancel) {
          setError(loadError instanceof Error ? loadError.message : "The desk did not load.")
        }
      } finally {
        if (!cancel) setLoading(false)
      }
    }
    void load()
    return () => {
      cancel = true
    }
  }, [])

  const ranked = useMemo(() => {
    if (!payload) return []
    return payload.cases
      .map((file) => ({
        file,
        score: scoreWindow(file.accountGroup, file.txns).overall,
      }))
      .sort((a, b) => b.score.points - a.score.points || a.file.id.localeCompare(b.file.id))
  }, [payload])

  const visible = ranked.filter(({ file, score }) => {
    if (filter === "all") return true
    if (filter === "open") return !decisions[file.id]
    return score.band === filter
  })

  const selected = ranked.find((item) => item.file.id === pickedId) ?? ranked[0]

  function choose(id: string) {
    setPickedId(id)
    setShowCase(true)
  }

  function decide(action: DecisionAction | null) {
    if (!selected) return
    const next = { ...decisions }
    if (action === null) delete next[selected.file.id]
    else next[selected.file.id] = { action, at: new Date().toISOString() }
    writeDecisions(next)
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return
      }
      if (!ranked.length || event.metaKey || event.ctrlKey || event.altKey) return
      const index = visible.findIndex((item) => item.file.id === selected?.file.id)
      if (event.key === "j" || event.key === "k") {
        event.preventDefault()
        const delta = event.key === "j" ? 1 : -1
        const next = visible[Math.min(visible.length - 1, Math.max(0, index + delta))]
        if (next) choose(next.file.id)
      }
      if (event.key === "1") decide("block")
      if (event.key === "2") decide("step_up")
      if (event.key === "3") decide("clear")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  if (loading) {
    return (
      <div className="grid h-full lg:grid-cols-[22.5rem_minmax(0,1fr)]">
        <div className="space-y-2 border-r border-border p-3">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
        <div className="hidden p-6 lg:block">
          <div className="h-8 w-64 animate-pulse rounded bg-muted" />
          <div className="mt-4 h-40 animate-pulse rounded-xl bg-muted" />
        </div>
      </div>
    )
  }

  if (error || !payload || !selected) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <h2 className="font-heading text-3xl">The desk did not load</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {error || "The behaviour map is missing from this build."}
        </p>
        <Button type="button" className="mt-4" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    )
  }

  const openCount = ranked.filter((item) => !decisions[item.file.id]).length
  const exposure = ranked
    .filter((item) => !decisions[item.file.id] && (item.score.band === "block" || item.score.band === "step_up"))
    .reduce((sum, item) => sum + item.file.txns.reduce((inner, txn) => inner + txn.amount, 0), 0)
  const agreed = ranked.filter((item) => item.score.band === item.file.aim).length

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[22.5rem_minmax(0,1fr)]">
      <aside className={cn("flex h-full min-h-0 flex-col border-r border-border", showCase && "max-lg:hidden")}>
        <div className="space-y-3 border-b border-border p-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Open" value={String(openCount)} />
            <Stat label="Exposed" value={money(exposure).replace(".00", "")} />
            <Stat label="Aimed" value={`${agreed}/${ranked.length}`} />
          </div>
          <div className="flex gap-1 overflow-auto">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs whitespace-nowrap",
                  filter === item.id ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
                )}
                aria-pressed={filter === item.id}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {visible.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Nothing in this filter.</p>
          ) : (
            <ul>
              {visible.map(({ file, score }) => {
                const active = file.id === selected.file.id
                const decision = decisions[file.id]
                return (
                  <li key={file.id}>
                    <button
                      type="button"
                      onClick={() => choose(file.id)}
                      className={cn(
                        "flex w-full gap-3 border-b border-border px-3 py-3 text-left",
                        active ? "bg-muted" : "hover:bg-muted/50",
                      )}
                      aria-current={active ? "true" : undefined}
                    >
                      <span
                        className="mt-1 h-10 w-1 shrink-0 rounded-full"
                        style={{ background: score.band === "block" ? "#e15a38" : score.band === "step_up" ? "#e2b15a" : score.band === "watch" ? "#8eafc4" : "#3f8f72" }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] text-muted-foreground">{file.id}</span>
                          <span className="font-mono text-sm tabular-nums">{score.points}</span>
                        </span>
                        <span className="mt-0.5 block truncate font-heading text-base leading-snug">{file.title}</span>
                        <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="truncate">
                            {maskId(file.accountId)} · {file.accountGroup} · {countLabel(file.txns.length, "charge")}
                          </span>
                          {decision ? <BandPill band={decision.action === "clear" ? "clear" : decision.action} /> : null}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <p className="border-t border-border px-3 py-2 text-[11px] leading-4 text-muted-foreground">
          J and K move. 1 block, 2 step up, 3 release. Aimed {agreed} of {ranked.length} is a check on
          these scripted stories, not a score on the 95 million rows. {groupLabel("A01")} through{" "}
          {groupLabel("A04")} are measured.
        </p>
      </aside>
      <section className={cn("h-full min-h-0", !showCase && "max-lg:hidden")}>
        <CaseFile
          key={selected.file.id}
          file={selected.file}
          counts={payload.counts}
          gemini={gemini}
          model={model}
          decision={decisions[selected.file.id]}
          onDecision={decide}
          onBack={() => setShowCase(false)}
        />
      </section>
    </div>
  )
}

function subscribeDecisions(onChange: () => void) {
  window.addEventListener("nonfraud-decisions", onChange)
  return () => window.removeEventListener("nonfraud-decisions", onChange)
}

function readDecisionRaw() {
  return localStorage.getItem(STORAGE_KEY) ?? ""
}

function parseDecisions(raw: string): Record<string, Decision> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, Decision>
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function writeDecisions(next: Record<string, Decision>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new Event("nonfraud-decisions"))
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted px-2 py-2">
      <div className="font-mono text-sm tabular-nums">{value}</div>
      <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
    </div>
  )
}
