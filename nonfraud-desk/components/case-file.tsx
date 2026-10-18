"use client"

import { useEffect, useMemo, useState } from "react"
import { AccountTriage } from "@/components/account-triage"
import { BandPill, ScoreMeter } from "@/components/band-pill"
import { Neighbourhood } from "@/components/neighbourhood"
import { SignalList } from "@/components/signal-list"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { rulesBrief } from "@/lib/brief"
import { bandLabel, clock, maskId, merchantLabel, money, tapeSpan } from "@/lib/format"
import { groupLabel } from "@/lib/groups"
import { scoreWindow } from "@/lib/score"
import type { BehaviourIndex, BriefSection, CaseFile, Decision, DecisionAction } from "@/lib/types"
import { cn } from "cn"
import { Pause, Play } from "lucide-react"

type Props = {
  file: CaseFile
  counts: BehaviourIndex["counts"]
  gemini: boolean
  model: string
  decision?: Decision
  onDecision: (action: DecisionAction | null) => void
  onBack?: () => void
  briefMode?: "id" | "inline"
}

export function CaseFile({
  file,
  counts,
  gemini,
  model,
  decision,
  onDecision,
  onBack,
  briefMode = "id",
}: Props) {
  const signature = file.txns.map((txn) => `${txn.id}:${txn.at}:${txn.amount}:${txn.merchantName}`).join("|")
  const [cursor, setCursor] = useState(file.txns.length)
  const [focus, setFocus] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [geminiBrief, setGeminiBrief] = useState<{ key: string; sections: BriefSection[]; model: string } | null>(null)
  const [geminiError, setGeminiError] = useState<string | null>(null)
  const [geminiLoading, setGeminiLoading] = useState(false)

  useEffect(() => {
    if (!playing || cursor >= file.txns.length) return
    const timer = window.setTimeout(() => {
      const next = cursor + 1
      setFocus(next - 1)
      setCursor(next)
      if (next >= file.txns.length) setPlaying(false)
    }, 900)
    return () => window.clearTimeout(timer)
  }, [playing, cursor, file.txns.length])

  const revealed = file.txns.slice(0, Math.max(cursor, 1))
  const windowScore = useMemo(
    () => scoreWindow(file.accountGroup, revealed),
    [file.accountGroup, revealed],
  )
  const focusIndex = Math.min(focus ?? windowScore.driverIndex, revealed.length - 1)
  const focusScore = windowScore.perTxn[focusIndex]
  const focusTxn = revealed[focusIndex]
  const briefKey = `${file.id}:${cursor}:${signature}`
  const rules = useMemo(
    () =>
      rulesBrief(
        {
          accountId: file.accountId,
          accountGroup: file.accountGroup,
          groupSummary: file.groupSummary,
          peers: file.peers,
          txns: file.txns,
          rank1CrossCount: counts.rank1CrossGroup,
          accountCount: counts.accounts,
        },
        revealed.length,
      ),
    [file, counts.rank1CrossGroup, counts.accounts, revealed.length],
  )

  useEffect(() => {
    if (!gemini || briefMode === "inline") return
    const controller = new AbortController()
    const key = `${file.id}:${file.txns.length}:${signature}`
    queueMicrotask(() => {
      if (controller.signal.aborted) return
      setGeminiLoading(true)
      setGeminiError(null)
    })
    fetch("/api/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: file.id, revealed: file.txns.length }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          source?: string
          model?: string
          sections?: BriefSection[]
          error?: string
        }
        if (controller.signal.aborted) return
        if (body.source === "gemini" && body.sections) {
          setGeminiBrief({ key, sections: body.sections, model: body.model ?? model })
        } else if (body.error) {
          setGeminiError(body.error)
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        setGeminiError(error instanceof Error ? error.message : "Gemini did not answer.")
      })
      .finally(() => {
        if (!controller.signal.aborted) setGeminiLoading(false)
      })
    return () => controller.abort()
  }, [file.id, file.txns.length, signature, gemini, briefMode, model])

  async function rewrite() {
    setGeminiLoading(true)
    setGeminiError(null)
    try {
      const response = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          briefMode === "inline"
            ? { inline: file, revealed: revealed.length }
            : { caseId: file.id, revealed: revealed.length },
        ),
      })
      const body = (await response.json()) as {
        source?: string
        model?: string
        sections?: BriefSection[]
        error?: string
      }
      if (body.source === "gemini" && body.sections) {
        setGeminiBrief({ key: briefKey, sections: body.sections, model: body.model ?? model })
      } else {
        setGeminiError(body.error || "Gemini is not configured. The desk note is the brief.")
      }
    } catch (error) {
      setGeminiError(error instanceof Error ? error.message : "Gemini did not answer.")
    } finally {
      setGeminiLoading(false)
    }
  }

  const showingGemini = geminiBrief?.key === briefKey
  const sections = showingGemini ? geminiBrief.sections : rules
  const total = revealed.reduce((sum, txn) => sum + txn.amount, 0)
  const ahead = file.txns.length - revealed.length

  function play() {
    if (playing) {
      setPlaying(false)
      return
    }
    if (cursor >= file.txns.length) {
      setCursor(1)
      setFocus(0)
    }
    setPlaying(true)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border px-4 py-4 sm:px-6">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="mb-2 text-sm text-muted-foreground lg:hidden"
          >
            Back to the queue
          </button>
        ) : null}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted-foreground">{file.id}</p>
            <h2 className="mt-1 font-heading text-3xl leading-tight tracking-tight">{file.title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{file.scenario}</p>
            <p className="mt-3 text-sm">
              <span className="font-mono">{maskId(file.accountId)}</span>
              <span className="text-muted-foreground"> · {file.accountGroup} · {groupLabel(file.accountGroup)}</span>
            </p>
          </div>
          <div className="w-full max-w-[16rem]">
            <div className="flex items-end justify-between gap-3">
              <p className="font-heading text-5xl leading-none tabular-nums">{windowScore.overall.points}</p>
              <BandPill band={windowScore.overall.band} />
            </div>
            <ScoreMeter points={windowScore.overall.points} />
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Case score is the hottest charge so far. {bandLabel(windowScore.overall.band)} at{" "}
              {windowScore.overall.points} points.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <DecisionButton
            label="Block card"
            active={decision?.action === "block"}
            onClick={() => onDecision(decision?.action === "block" ? null : "block")}
            className="bg-[#e15a38] text-white hover:bg-[#c44b2e]"
          />
          <DecisionButton
            label="Step up"
            active={decision?.action === "step_up"}
            onClick={() => onDecision(decision?.action === "step_up" ? null : "step_up")}
            className="bg-[#e2b15a] text-[#2a2112] hover:bg-[#c9963d]"
          />
          <DecisionButton
            label="Release"
            active={decision?.action === "clear"}
            onClick={() => onDecision(decision?.action === "clear" ? null : "clear")}
            className="bg-[#3f8f72] text-white hover:bg-[#32785e]"
          />
          {decision ? (
            <span className="self-center text-xs text-muted-foreground">
              Decided {clock(decision.at)}
            </span>
          ) : (
            <span className="self-center text-xs text-muted-foreground">No analyst decision yet</span>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-6">
            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                  Tape · {tapeSpan(revealed.map((txn) => txn.at))} · {money(total)}
                </h3>
                {file.txns.length > 1 ? (
                  <Button type="button" variant="outline" size="sm" onClick={play}>
                    {playing ? <Pause /> : <Play />}
                    {playing ? "Pause" : cursor >= file.txns.length ? "Play the burst" : "Resume"}
                  </Button>
                ) : null}
              </div>
              <ol className="space-y-1">
                {revealed.map((txn, index) => {
                  const scored = windowScore.perTxn[index]
                  const active = index === focusIndex
                  const driver = index === windowScore.driverIndex
                  return (
                    <li key={txn.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setPlaying(false)
                          setFocus(index)
                        }}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left",
                          active ? "bg-muted" : "hover:bg-muted/50",
                        )}
                      >
                        <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">
                          {clock(txn.at).split(", ")[1]}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm">
                            {merchantLabel(txn.merchantName)}
                            <span className="text-muted-foreground"> · {txn.category}</span>
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {txn.merchantGroup} · {groupLabel(txn.merchantGroup)}
                            {driver ? " · driving charge" : ""}
                          </span>
                        </span>
                        <span className="text-right">
                          <span className="block font-mono text-sm tabular-nums">{money(txn.amount)}</span>
                          <span className="mt-1 block">
                            <BandPill band={scored.band} />
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ol>
              {ahead > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">{ahead} charges still ahead on the tape.</p>
              ) : null}
              <p className="sr-only" aria-live="polite">
                Case score {windowScore.overall.points}, {bandLabel(windowScore.overall.band)}. Showing {revealed.length} of {file.txns.length} charges.
              </p>
            </section>

            <article className="paper rounded-xl p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] tracking-[0.16em] uppercase paper-muted">Case note</p>
                <p className="text-xs paper-muted">
                  {showingGemini ? `Gemini · ${geminiBrief?.model}` : "Desk rules"}
                  {geminiLoading ? " · writing" : ""}
                </p>
              </div>
              {sections.map((section) => (
                <section key={section.heading} className="mt-4">
                  <h3 className="font-heading text-xl">{section.heading}</h3>
                  <p className="mt-1 text-[15px] leading-6">{section.body}</p>
                </section>
              ))}
              <div className="mt-5 flex flex-wrap items-center gap-3">
                {gemini ? (
                  <Button type="button" variant="outline" size="sm" onClick={rewrite} disabled={geminiLoading}>
                    {geminiLoading ? "Writing the note" : "Rewrite with Gemini"}
                  </Button>
                ) : (
                  <p className="text-xs paper-muted">
                    Set GEMINI_API_KEY and Gemini will rewrite this note. The desk rules stand in until then.
                  </p>
                )}
              </div>
              {geminiError ? <p className="mt-2 text-xs paper-muted">{geminiError}</p> : null}
            </article>
          </div>

          <aside className="space-y-5">
            <section>
              <h3 className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                This charge
              </h3>
              {focusTxn && focusScore ? (
                <>
                  <p className="mt-2 text-sm leading-6">
                    {money(focusTxn.amount)} at {merchantLabel(focusTxn.merchantName)}, {clock(focusTxn.at)}.
                    {focusIndex === windowScore.driverIndex
                      ? " This is the driving charge."
                      : " The case score still follows the hotter charge."}
                  </p>
                  <Separator className="my-3" />
                  <SignalList signals={focusScore.signals} total={focusScore.points} />
                </>
              ) : null}
            </section>
            <section>
              <h3 className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                Neighbourhood
              </h3>
              <Neighbourhood
                accountId={file.accountId}
                accountGroup={file.accountGroup}
                peers={file.peers}
                merchantName={focusTxn?.merchantName}
                merchantGroup={focusTxn?.merchantGroup}
              />
            </section>
            <AccountTriage key={file.accountId} accountId={file.accountId} />
          </aside>
        </div>
      </div>
    </div>
  )
}

function DecisionButton({
  label,
  active,
  onClick,
  className,
}: {
  label: string
  active: boolean
  onClick: () => void
  className: string
}) {
  return (
    <Button
      type="button"
      size="lg"
      variant={active ? "default" : "outline"}
      className={cn(active && className)}
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
    </Button>
  )
}
