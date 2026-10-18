"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAnalystName } from "@/lib/analyst"
import { KNOWN_FRAUD_TYPES, TRIAGE_CHECK, fraudLabel, type TriageMeta } from "@/lib/behaviour-copy"
import { countLabel, maskId } from "@/lib/format"

type QueueRow = {
  txnId: string
  accountId: string
  date: string
  match: string
  score: number
  margin: number
  flagLabels: string[]
}

type QueuePayload = {
  meta: TriageMeta
  margin: number
  matched: number
  rows: QueueRow[]
  store: "neo4j" | "file"
}

export function TriageView() {
  const [margin, setMargin] = useState(0.5)
  const [payload, setPayload] = useState<QueuePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [mode, setMode] = useState<"closest" | "known" | "new">("closest")
  const [known, setKnown] = useState(KNOWN_FRAUD_TYPES[0])
  const [freshName, setFreshName] = useState("")
  const [description, setDescription] = useState("")
  const [note, setNote] = useState("")
  const [analyst, setAnalyst] = useAnalystName()
  const [pending, setPending] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      fetch(`/api/triage?margin=${margin}&limit=200`, { signal: controller.signal })
        .then(async (response) => {
          const body = await response.json()
          if (!response.ok) throw new Error(body.error || "The queue did not load.")
          setPayload(body as QueuePayload)
          setError(null)
        })
        .catch((loadError: unknown) => {
          if (controller.signal.aborted) return
          setError(loadError instanceof Error ? loadError.message : "The queue did not load.")
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 180)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [margin, refresh])

  const rows = payload?.rows ?? []
  const selected = rows.filter((row) => picked[row.txnId]).map((row) => row.txnId)

  async function confirm() {
    setPending(true)
    setBanner(null)
    setError(null)
    const body =
      mode === "closest"
        ? { user: analyst, note, txnIds: selected, useClosest: true }
        : mode === "known"
          ? { user: analyst, note, txnIds: selected, label: known }
          : { user: analyst, note, txnIds: selected, label: freshName, description }
    try {
      const response = await fetch("/api/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "The flag could not be written.")
      const summary = (result.labels as { name: string; status: string; flags: number; entities: number }[])
        .map(
          (label) =>
            `${fraudLabel(label.name)} is ${label.status} (${countLabel(label.flags, "flag")}, ${countLabel(label.entities, "transaction")})`,
        )
        .join(". ")
      setBanner(`Confirmed ${result.written} charge${result.written === 1 ? "" : "s"}. ${summary}`)
      setPicked({})
      setRefresh((value) => value + 1)
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "The flag could not be written.")
    } finally {
      setPending(false)
    }
  }

  if (!payload && loading) {
    return (
      <div className="grid gap-3 p-4">
        <div className="h-16 animate-pulse rounded-xl bg-muted" />
        <div className="h-80 animate-pulse rounded-xl bg-muted" />
      </div>
    )
  }

  if (!payload && error) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <h2 className="font-heading text-3xl">The queue did not load</h2>
        <p className="mt-3 text-sm text-muted-foreground">{error}</p>
        <Button type="button" className="mt-4" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    )
  }

  const meta = payload?.meta
  const floor = meta?.floor ?? 0.2

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <p className="text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Triage queue</p>
        <h1 className="mt-1 font-heading text-4xl tracking-tight">January charges that resemble a type</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
          {meta ? `${meta.scanned.toLocaleString("en-US")} transactions from ${meta.range[0]} to ${meta.range[1]}. ` : ""}
          Each vector is the charge compared with that card&apos;s own earlier history. The score is cosine similarity
          against the six generator prototypes and a normal-spending prototype. Nothing here is flagged until you
          confirm it.
          {payload?.store === "neo4j"
            ? " A confirmation writes FLAGGED_AS on Neo4j."
            : " Neo4j is off, so a confirmation stays in store/flags.json."}
        </p>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-muted-foreground">{TRIAGE_CHECK}</p>

        <label className="mt-6 block max-w-xl text-sm">
          <span className="flex items-baseline justify-between gap-3">
            <span>Minimum margin over normal spending</span>
            <span className="font-mono tabular-nums">{margin.toFixed(2)}</span>
          </span>
          <input
            type="range"
            min={floor}
            max={1.2}
            step={0.05}
            value={margin}
            onChange={(event) => setMargin(Number(event.target.value))}
            className="mt-2 w-full accent-[#e2b15a]"
          />
        </label>

        <p className="mt-3 text-sm text-muted-foreground">
          {payload
            ? `${payload.matched.toLocaleString("en-US")} unflagged transaction${payload.matched === 1 ? "" : "s"} above this margin. Showing ${rows.length.toLocaleString("en-US")}.`
            : "Loading the queue."}
          {loading ? " Refreshing." : ""}
        </p>
        {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
        {banner ? <p className="mt-2 text-sm text-[#8fbf9f]">{banner}</p> : null}

        {rows.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
            Nothing unflagged sits above this margin.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead className="bg-muted/60 text-xs tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-3 py-2 font-medium">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">Closest type</th>
                  <th className="px-3 py-2 font-medium">Similarity</th>
                  <th className="px-3 py-2 font-medium">Margin</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.txnId} className="border-t border-border">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={Boolean(picked[row.txnId])}
                        onChange={(event) =>
                          setPicked((current) => ({ ...current, [row.txnId]: event.target.checked }))
                        }
                        aria-label={`Select ${row.txnId}`}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{row.date}</td>
                    <td className="px-3 py-2 font-mono text-xs" title={row.accountId}>
                      {maskId(row.accountId)}
                    </td>
                    <td className="px-3 py-2">{fraudLabel(row.match)}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{row.score.toFixed(2)}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{row.margin.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form
          className="mt-6 grid gap-3 rounded-xl border border-border p-4"
          onSubmit={(event) => {
            event.preventDefault()
            void confirm()
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-2xl">Confirm {selected.length}</h2>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPicked(Object.fromEntries(rows.map((row) => [row.txnId, true])))}
                disabled={rows.length === 0}
              >
                Tick these
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPicked({})} disabled={selected.length === 0}>
                Clear
              </Button>
            </div>
          </div>
          <fieldset className="grid gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="mode" checked={mode === "closest"} onChange={() => setMode("closest")} />
              Each ticked row as its closest generator type
            </label>
            <label className="flex flex-wrap items-center gap-2">
              <input type="radio" name="mode" checked={mode === "known"} onChange={() => setMode("known")} />
              All of them as
              <select
                value={known}
                onChange={(event) => {
                  setKnown(event.target.value)
                  setMode("known")
                }}
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
              >
                {KNOWN_FRAUD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {fraudLabel(type)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="mode" checked={mode === "new"} onChange={() => setMode("new")} />
              A new behaviour
            </label>
          </fieldset>
          {mode === "new" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                Name
                <Input value={freshName} onChange={(event) => setFreshName(event.target.value)} placeholder="night_grocery_spree" />
              </label>
              <label className="grid gap-1 text-sm">
                What it looks like
                <Input value={description} onChange={(event) => setDescription(event.target.value)} />
              </label>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              Your name
              <Input value={analyst} onChange={(event) => setAnalyst(event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm">
              Note
              <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional" />
            </label>
          </div>
          <Button type="submit" disabled={pending || selected.length === 0}>
            {pending ? "Writing" : `Confirm ${selected.length} charge${selected.length === 1 ? "" : "s"}`}
          </Button>
        </form>
      </div>
    </div>
  )
}
