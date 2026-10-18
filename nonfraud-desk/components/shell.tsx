"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { BOOK } from "@/lib/book"
import type { DeskMeta } from "@/lib/types"
import { cn } from "cn"

const LINKS = [
  { href: "/", label: "Desk" },
  { href: "/atlas", label: "Atlas" },
  { href: "/triage", label: "Triage", short: "Queue" },
  { href: "/behaviours", label: "Library", short: "Types" },
  { href: "/scan", label: "Scan", short: "Scan" },
  { href: "/console", label: "Try a charge", short: "Score" },
]

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [meta, setMeta] = useState<DeskMeta | null>(null)

  useEffect(() => {
    let cancel = false
    fetch("/api/meta")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: DeskMeta | null) => {
        if (!cancel && body) setMeta(body)
      })
      .catch(() => undefined)
    return () => {
      cancel = true
    }
  }, [])

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 sm:px-4">
        <Link href="/" className="font-heading text-xl tracking-tight">
          Non_Fraud
        </Link>
        <span className="hidden text-sm text-muted-foreground md:inline">Behaviour desk</span>
        <nav className="flex w-full flex-wrap items-center gap-1 sm:ml-auto sm:w-auto sm:justify-end">
          {LINKS.map((link) => {
            const active = pathname === link.href
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-sm",
                  active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                <span className="sm:hidden">{link.short ?? link.label}</span>
                <span className="hidden sm:inline">{link.label}</span>
              </Link>
            )
          })}
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
            Sources
          </Button>
        </nav>
      </header>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl">Where this comes from</DialogTitle>
            <DialogDescription>
              Two layers. One is measured. One is a scripted tape built from the published profile.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-4 overflow-auto pr-1 text-sm leading-6">
            <section>
              <h3 className="font-medium">Behaviour map</h3>
              <p className="mt-1 text-muted-foreground">
                Schema s1, version v1, as of 30 Sep 2026.{" "}
                {meta
                  ? `${meta.counts.accounts.toLocaleString("en-US")} accounts, ${meta.counts.merchants.toLocaleString("en-US")} merchants, ${meta.counts.accountLinks.toLocaleString("en-US")} account links, ${meta.counts.merchantLinks.toLocaleString("en-US")} merchant links.`
                  : "8,817 accounts and 861 merchants."}{" "}
                Account groups are k-means, k = 4, silhouette 0.3862. Merchant groups are k-means, k = 10,
                silhouette 0.708. Each account and merchant keeps its ten nearest neighbours.
                {meta?.store === "neo4j"
                  ? " Those neighbours are a Cypher read on Neo4j: Account-[:BEHAVES_LIKE]->Account, and membership is IN_BEHAVIOUR_GROUP."
                  : ""}
                {meta
                  ? ` ${meta.counts.rank1CrossGroup.toLocaleString("en-US")} accounts have a rank-1 neighbour in another group.`
                  : ""}
              </p>
            </section>
            <section>
              <h3 className="font-medium">Sparkov book</h3>
              <p className="mt-1 text-muted-foreground">
                {BOOK.rows} transaction rows, {BOOK.fraudRows} fraud ({BOOK.fraudRate}). {BOOK.night}{" "}
                {BOOK.burst} {BOOK.categories} The highest fraud amount is ${BOOK.fraudCeiling.toLocaleString("en-US")}.
                The highest genuine amount is ${BOOK.genuineCeiling.toLocaleString("en-US")}.
              </p>
            </section>
            <section>
              <h3 className="font-medium">Tonight&apos;s tape</h3>
              <p className="mt-1 text-muted-foreground">
                The twelve cases are scripted from that profile and attached to real accounts and real
                merchants in the map. They are not rows pulled from the 95 million. The desk score is a
                fixed weighting of category, hour, burst, amount band, merchant group, and profile clash.
                Block at 70, step up at 46, watch at 28.
              </p>
            </section>
            <section>
              <h3 className="font-medium">January behaviour match</h3>
              <p className="mt-1 text-muted-foreground">
                The triage queue scores 490,407 real transactions from January 2025. The vector is the charge
                against that card&apos;s own earlier history.                 Similarity is the cosine of the charge vector against six prototypes the Sparkov generator
                defines, plus a normal-spending prototype. Those six names are planted labels, not types the
                desk discovered. A row stays a recommendation until someone confirms it. The confirmation is
                a FLAGGED_AS edge from the transaction to a behaviour.                 A custom name stays a candidate until
                5 charges on 3 different transactions. Scan averages the charges already confirmed under a proposed
                name, finds other January charges with the same shape, and writes flagged_behaviours.csv plus
                load_flagged_behaviours.cypher for the ones a person ticks.
              </p>
            </section>
            <section>
              <h3 className="font-medium">The fraud_ prefix</h3>
              <p className="mt-1 text-muted-foreground">
                Every merchant name in the generator starts with fraud_. That is not a fraud label. The
                desk shows the name with the prefix removed.
              </p>
            </section>
            <section>
              <h3 className="font-medium">Gemini</h3>
              <p className="mt-1 text-muted-foreground">
                {meta?.gemini
                  ? `Case notes can be rewritten by ${meta.model}. The model only sees the evidence packet for the open case.`
                  : "No Gemini key is set. Case notes are written by the desk rules. Set GEMINI_API_KEY to rewrite them with Gemini."}
              </p>
            </section>
          </div>
        </DialogContent>
      </Dialog>
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
    </div>
  )
}
