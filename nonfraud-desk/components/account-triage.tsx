"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { useAnalystName } from "@/lib/analyst"
import { fraudLabel } from "@/lib/behaviour-copy"

type Hit = {
  txnId: string
  date: string
  match: string
  score: number
  margin: number
  flagLabels: string[]
}

export function AccountTriage({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<Hit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [analyst] = useAnalystName()
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/triage?account=${accountId}&limit=3`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || "January charges could not be read.")
        setRows(body.rows as Hit[])
        setError(null)
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return
        setError(loadError instanceof Error ? loadError.message : "January charges could not be read.")
      })
    return () => controller.abort()
  }, [accountId, reload])

  async function confirm(row: Hit) {
    setPendingId(row.txnId)
    setError(null)
    try {
      const response = await fetch("/api/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: analyst,
          note: "confirmed from the case file",
          txnIds: [row.txnId],
          label: row.match,
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "The flag could not be written.")
      setReload((value) => value + 1)
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "The flag could not be written.")
    } finally {
      setPendingId(null)
    }
  }

  return (
    <section>
      <h3 className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
        January behaviour
      </h3>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Real charges from the January 2025 export, not tonight&apos;s scripted tape. Margin is cosine similarity
        over normal spending.
      </p>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      {rows === null && !error ? <div className="mt-3 h-16 animate-pulse rounded-lg bg-muted" /> : null}
      {rows && rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No January charge on this card clears the similarity floor.
        </p>
      ) : null}
      {rows && rows.length > 0 ? (
        <ul className="mt-3 space-y-3">
          {rows.map((row) => (
            <li key={row.txnId} className="rounded-lg border border-border px-3 py-2">
              <p className="text-sm">
                {fraudLabel(row.match)}
                <span className="text-muted-foreground"> · {row.date}</span>
              </p>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                similarity {row.score.toFixed(2)} · margin {row.margin.toFixed(2)}
              </p>
              {row.flagLabels.length > 0 ? (
                <p className="mt-1 text-xs text-[#8fbf9f]">
                  Flagged as {row.flagLabels.map((label) => fraudLabel(label)).join(", ")}
                </p>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled={pendingId === row.txnId}
                  onClick={() => void confirm(row)}
                >
                  {pendingId === row.txnId ? "Writing" : `Confirm as ${fraudLabel(row.match)}`}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
