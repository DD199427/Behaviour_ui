"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAnalystName } from "@/lib/analyst"
import { fraudLabel, type FlagLabel } from "@/lib/behaviour-copy"
import { countLabel, maskId } from "@/lib/format"

type FlagPayload = {
  store: "neo4j" | "file"
  labels: FlagLabel[]
}

type ScanRow = {
  txnId: string
  accountId: string
  date: string
  score: number
  margin: number
}

type ScanPayload = {
  label: FlagLabel
  scanned: number
  complete: boolean
  examplesFound: number
  missing: string[]
  margin: number
  matched: number
  truncated: boolean
  rows: ScanRow[]
}

type ExportPayload = {
  store: "neo4j" | "file"
  written: number
  batch: string
  csvName: string
  cypherName: string
  csv: string
  cypher: string
  label: FlagLabel
}

function download(filename: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function ScanView() {
  const [labels, setLabels] = useState<FlagLabel[] | null>(null)
  const [store, setStore] = useState<"neo4j" | "file" | null>(null)
  const [label, setLabel] = useState("")
  const [margin, setMargin] = useState(0.5)
  const [scan, setScan] = useState<ScanPayload | null>(null)
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [packed, setPacked] = useState<ExportPayload | null>(null)
  const [analyst, setAnalyst] = useAnalystName()
  const [note, setNote] = useState("")

  useEffect(() => {
    let cancel = false
    fetch("/api/flags")
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || "Proposed behaviours could not be read.")
        return body as FlagPayload
      })
      .then((body) => {
        if (cancel) return
        const proposed = body.labels.filter((item) => item.origin === "analyst")
        setLabels(proposed)
        setStore(body.store)
        setLabel((current) => current || proposed[0]?.name || "")
        setError(null)
      })
      .catch((loadError: unknown) => {
        if (cancel) return
        setError(loadError instanceof Error ? loadError.message : "Proposed behaviours could not be read.")
      })
      .finally(() => {
        if (!cancel) setLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [])

  const selected = scan?.rows.filter((row) => picked[row.txnId]).map((row) => row.txnId) ?? []
  const current = labels?.find((item) => item.name === label)

  async function runScan() {
    setScanning(true)
    setError(null)
    setPacked(null)
    setPicked({})
    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, margin }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "The scan failed.")
      setScan(body as ScanPayload)
    } catch (scanError) {
      setScan(null)
      setError(scanError instanceof Error ? scanError.message : "The scan failed.")
    } finally {
      setScanning(false)
    }
  }

  async function push() {
    setPushing(true)
    setError(null)
    try {
      const response = await fetch("/api/scan/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, txnIds: selected, user: analyst, note }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "The Neo4j files could not be written.")
      const result = body as ExportPayload
      setPacked(result)
      setLabels((currentLabels) =>
        currentLabels?.map((item) => (item.name === result.label.name ? result.label : item)) ?? currentLabels,
      )
      download(result.csvName, result.csv, "text/csv")
      download(result.cypherName, result.cypher, "text/plain")
    } catch (pushError) {
      setError(pushError instanceof Error ? pushError.message : "The Neo4j files could not be written.")
    } finally {
      setPushing(false)
    }
  }

  if (loading && !labels) {
    return (
      <div className="grid gap-3 p-4">
        <div className="h-16 animate-pulse rounded-xl bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    )
  }

  if (!labels && error) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <h2 className="font-heading text-3xl">The scan did not load</h2>
        <p className="mt-3 text-sm text-muted-foreground">{error}</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <p className="text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Proposed behaviour</p>
        <h1 className="mt-1 font-heading text-4xl tracking-tight">Scan for more of the same</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
          A behaviour this desk proposed gets its signature from the January charges already confirmed under that
          name. The signature is the average of those charge vectors. Every other January 2025 charge is scored by
          how far it sits from normal spending toward that signature. Nothing is flagged until you tick it. The CSV
          and Cypher are only the charges you confirm, so another Neo4j can load the same edges.
        </p>

        {!labels || labels.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
            No proposed behaviour yet. Name one in the library, confirm at least one January charge under it on
            Triage, then come back to scan.
          </p>
        ) : (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span>Behaviour</span>
                <select
                  value={label}
                  onChange={(event) => {
                    setLabel(event.target.value)
                    setScan(null)
                    setPacked(null)
                    setPicked({})
                  }}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
                >
                  {labels.map((item) => (
                    <option key={item.name} value={item.name}>
                      {fraudLabel(item.name)} · {item.status} · {countLabel(item.flags, "flag")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="flex items-baseline justify-between gap-3">
                  <span>Minimum margin over normal spending</span>
                  <span className="font-mono tabular-nums">{margin.toFixed(2)}</span>
                </span>
                <input
                  type="range"
                  min={0.2}
                  max={1.2}
                  step={0.05}
                  value={margin}
                  onChange={(event) => setMargin(Number(event.target.value))}
                  className="mt-3 w-full accent-[#e2b15a]"
                />
              </label>
            </div>
            {current ? (
              <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
                {current.description || "No description."} Status {current.status}.{" "}
                {countLabel(current.flags, "confirmed charge")}. A candidate stays a candidate until 5 charges on 3
                different transactions.
              </p>
            ) : null}
            <Button type="button" className="mt-4" disabled={!label || scanning} onClick={() => void runScan()}>
              {scanning ? "Scanning January…" : "Scan January charges"}
            </Button>
          </>
        )}

        {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}

        {scan ? (
          <>
            <p className="mt-4 text-sm text-muted-foreground">
              Signature from {countLabel(scan.examplesFound, "example charge")}. Scanned{" "}
              {scan.scanned.toLocaleString("en-US")} January transactions
              {scan.complete ? "" : " (the vector export was short of the full 490,407)"}.{" "}
              {scan.matched.toLocaleString("en-US")} unflagged above this margin. Showing {scan.rows.length.toLocaleString("en-US")}.
              {scan.missing.length > 0
                ? ` ${scan.missing.length} example charge${scan.missing.length === 1 ? "" : "s"} had no January vector and were left out of the signature.`
                : ""}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              <a className="underline" href={`/api/scan?label=${encodeURIComponent(label)}`}>
                Download the scan CSV
              </a>
              . That file is the review list. It is not the Neo4j load.
            </p>
            {scan.rows.length === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                Nothing unflagged sits above this margin.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead className="bg-muted/60 text-xs tracking-wide text-muted-foreground uppercase">
                    <tr>
                      <th className="px-3 py-2 font-medium">
                        <span className="sr-only">Select</span>
                      </th>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Account</th>
                      <th className="px-3 py-2 font-medium">Similarity</th>
                      <th className="px-3 py-2 font-medium">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scan.rows.map((row) => (
                      <tr key={row.txnId} className="border-t border-border">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={Boolean(picked[row.txnId])}
                            onChange={(event) =>
                              setPicked((currentPicked) => ({ ...currentPicked, [row.txnId]: event.target.checked }))
                            }
                            aria-label={`Select ${row.txnId}`}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{row.date}</td>
                        <td className="px-3 py-2 font-mono text-xs" title={row.accountId}>
                          {maskId(row.accountId)}
                        </td>
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
                void push()
              }}
            >
              <p className="text-sm">
                {countLabel(selected.length, "charge")} selected. Writing the files also records those charges on{" "}
                {store === "neo4j" ? "this Neo4j" : "this machine"}.
              </p>
              <label className="block text-sm">
                <span>Your name</span>
                <Input className="mt-1" value={analyst} onChange={(event) => setAnalyst(event.target.value)} />
              </label>
              <label className="block text-sm">
                <span>Note</span>
                <Input
                  className="mt-1"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={`Confirmed from the ${fraudLabel(label)} scan`}
                />
              </label>
              <Button type="submit" disabled={selected.length === 0 || pushing}>
                {pushing ? "Writing files…" : "Write CSV and Cypher"}
              </Button>
            </form>
          </>
        ) : null}

        {packed ? (
          <div className="mt-4 rounded-xl border border-border p-4 text-sm leading-6">
            <p>
              Wrote {countLabel(packed.written, "charge")} as {fraudLabel(packed.label.name)} ({packed.label.status}).
              Batch {packed.batch}.
            </p>
            <p className="mt-2 text-muted-foreground">
              Copy {packed.csvName} into the Neo4j import directory and run {packed.cypherName}. The script uses
              MERGE, so running it again does not duplicate edges.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => download(packed.csvName, packed.csv, "text/csv")}>
                Download {packed.csvName}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => download(packed.cypherName, packed.cypher, "text/plain")}
              >
                Download {packed.cypherName}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
