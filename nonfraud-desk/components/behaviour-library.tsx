"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAnalystName } from "@/lib/analyst"
import { TRIAGE_CHECK, fraudLabel, type FlagLabel, type FlagRecord, type LibraryGroup, type LibraryType } from "@/lib/behaviour-copy"
import { money } from "@/lib/format"
import { cn } from "cn"

type LibraryPayload = {
  events: number
  source: string
  asof: string
  types: LibraryType[]
  groups: LibraryGroup[]
}

type FlagPayload = {
  store: "neo4j" | "file"
  labels: FlagLabel[]
  flags: FlagRecord[]
}

export function BehaviourLibrary() {
  const [library, setLibrary] = useState<LibraryPayload | null>(null)
  const [flags, setFlags] = useState<FlagPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flagError, setFlagError] = useState<string | null>(null)

  function loadFlags() {
    return fetch("/api/flags")
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || "Confirmed flags could not be read.")
        return body as FlagPayload
      })
      .then(setFlags)
      .catch((loadError: unknown) => {
        setFlagError(loadError instanceof Error ? loadError.message : "Confirmed flags could not be read.")
      })
  }

  useEffect(() => {
    let cancel = false
    fetch("/api/behaviours")
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || "The library did not load.")
        if (!cancel) setLibrary(body as LibraryPayload)
      })
      .catch((loadError: unknown) => {
        if (!cancel) setError(loadError instanceof Error ? loadError.message : "The library did not load.")
      })
    loadFlags()
    return () => {
      cancel = true
    }
  }, [])

  if (error) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <h2 className="font-heading text-3xl">The library did not load</h2>
        <p className="mt-3 text-sm text-muted-foreground">{error}</p>
        <Button type="button" className="mt-4" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    )
  }

  if (!library) {
    return (
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-40 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <p className="text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Behaviour library</p>
        <h1 className="mt-1 font-heading text-4xl tracking-tight">Named behaviours</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          {library.events.toLocaleString("en-US")} generator fraud events, plus the groups clustered from the
          behaviour map as of {library.asof}. A group is not a fraud type. Confirming a January charge on the
          triage queue is what writes <span className="font-mono">FLAGGED_AS</span> into the graph.
        </p>
        <Tabs defaultValue="known" className="mt-6">
          <TabsList>
            <TabsTrigger value="known">Generator types</TabsTrigger>
            <TabsTrigger value="groups">Discovered groups</TabsTrigger>
            <TabsTrigger value="flags">On the graph</TabsTrigger>
          </TabsList>
          <TabsContent value="known" className="mt-4 space-y-4">
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              These six names are how the Sparkov generator plants fraud. They are ground truth for this book,
              not behaviours the desk discovered. {TRIAGE_CHECK}
            </p>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead className="bg-muted/60 text-xs tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th className="px-3 py-2 font-medium">Behaviour</th>
                    <th className="px-3 py-2 font-medium">Entered by</th>
                    <th className="px-3 py-2 font-medium">Events</th>
                    <th className="px-3 py-2 font-medium">Median delay</th>
                    <th className="px-3 py-2 font-medium">Median length</th>
                    <th className="px-3 py-2 font-medium">Loss per event</th>
                    <th className="px-3 py-2 font-medium">Total loss</th>
                  </tr>
                </thead>
                <tbody>
                  {library.types.map((type) => (
                    <tr key={type.id} className="border-t border-border">
                      <td className="px-3 py-2">{type.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{type.enteredBy}</td>
                      <td className="px-3 py-2 font-mono tabular-nums">{type.events.toLocaleString("en-US")}</td>
                      <td className="px-3 py-2 font-mono tabular-nums">{type.medianDelayDays}d</td>
                      <td className="px-3 py-2 font-mono tabular-nums">{type.medianDurationDays}d</td>
                      <td className="px-3 py-2 font-mono tabular-nums">{money(type.medianLoss)}</td>
                      <td className="px-3 py-2 font-mono tabular-nums">{money(type.totalLoss)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {library.types.map((type) => (
                <article key={type.id} className="rounded-xl border border-border p-4">
                  <h2 className="font-heading text-2xl">{type.name}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Entered by {type.enteredBy.toLowerCase()}</p>
                  <p className="mt-2 text-sm leading-6">{type.note}</p>
                </article>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="groups" className="mt-4">
            <GroupList groups={library.groups} onCreated={loadFlags} />
          </TabsContent>
          <TabsContent value="flags" className="mt-4">
            <FlagLedger payload={flags} error={flagError} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function GroupList({ groups, onCreated }: { groups: LibraryGroup[]; onCreated: () => void }) {
  const [analyst, setAnalyst] = useAnalystName()
  const [active, setActive] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function open(group: LibraryGroup) {
    setActive(group.id)
    setName(group.suggestedName)
    setDescription(group.description)
    setMessage(null)
    setError(null)
  }

  async function create(group: LibraryGroup) {
    setPending(true)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch("/api/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: analyst,
          propose: { name, description },
        }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || "Could not create the behaviour.")
      setMessage(
        `${body.label.name} is a candidate. It does not flag the ${group.size.toLocaleString("en-US")} members. Confirm individual January charges on the triage queue.`,
      )
      onCreated()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create the behaviour.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
        Clustered from account and merchant vectors. No fraud labels went into the groups. Proposing one creates
        an empty candidate name. Members stay unflagged until someone confirms them.
      </p>
      {groups.map((group) => (
        <article key={group.id} className="rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-heading text-2xl">
              {group.id}
              <span className="ml-2 font-sans text-sm text-muted-foreground">
                {group.entity} · {group.size.toLocaleString("en-US")}
              </span>
            </h2>
            <Button type="button" variant="outline" size="sm" onClick={() => open(group)}>
              {active === group.id ? "Editing" : "Propose as a behaviour"}
            </Button>
          </div>
          <p className="mt-2 text-sm leading-6">{group.description}</p>
          <p className="mt-1 text-xs text-muted-foreground">{group.summary}</p>
          {group.features.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <thead className="text-xs tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Feature</th>
                    <th className="py-1 pr-3 font-medium">Against the book</th>
                    <th className="py-1 pr-3 font-medium">This group</th>
                    <th className="py-1 font-medium">Typical</th>
                  </tr>
                </thead>
                <tbody>
                  {group.features.map((feature) => (
                    <tr key={feature.feature} className="border-t border-border">
                      <td className="py-1.5 pr-3">{feature.feature}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{feature.phrase}</td>
                      <td className="py-1.5 pr-3 font-mono tabular-nums">{feature.group.toFixed(2)}</td>
                      <td className="py-1.5 font-mono tabular-nums">{feature.overall.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {active === group.id ? (
            <form
              className="mt-4 grid gap-3 rounded-lg bg-muted/40 p-3"
              onSubmit={(event) => {
                event.preventDefault()
                void create(group)
              }}
            >
              <label className="grid gap-1 text-sm">
                Behaviour name
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="grid gap-1 text-sm">
                What it looks like
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  className="rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </label>
              <label className="grid gap-1 text-sm sm:max-w-xs">
                Your name
                <Input value={analyst} onChange={(event) => setAnalyst(event.target.value)} />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={pending}>
                  {pending ? "Creating" : "Create candidate"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setActive(null)}>
                  Cancel
                </Button>
              </div>
              {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </form>
          ) : null}
        </article>
      ))}
    </div>
  )
}

function FlagLedger({ payload, error }: { payload: FlagPayload | null; error: string | null }) {
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!payload) return <div className="h-40 animate-pulse rounded-xl bg-muted" />
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
        {payload.store === "neo4j"
          ? "Each confirmed charge is a Transaction node with a FLAGGED_AS edge to a BehaviourLabel. A custom name stays a candidate until 5 charges from 3 different transactions, then it becomes active. The six generator types are trusted immediately."
          : "Neo4j is off, so these flags are in store/flags.json on this machine. The same 5-charge, 3-transaction rule applies."}
      </p>
      {payload.labels.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
          Nothing has been confirmed yet. The triage queue is where a January charge gets a name.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-muted/60 text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Behaviour</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Flags</th>
                <th className="px-3 py-2 font-medium">Transactions</th>
              </tr>
            </thead>
            <tbody>
              {payload.labels.map((label) => (
                <tr key={label.name} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div>{fraudLabel(label.name)}</div>
                    {label.description ? (
                      <div className="mt-0.5 max-w-xl text-xs text-muted-foreground">{label.description}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={label.status} />
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums">
                    {label.status === "candidate" ? `${label.flags}/${label.flagsNeeded}` : label.flags}
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums">
                    {label.status === "candidate" ? `${label.entities}/${label.entitiesNeeded}` : label.entities}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {payload.flags.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="bg-muted/60 text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Transaction</th>
                <th className="px-3 py-2 font-medium">Behaviour</th>
                <th className="px-3 py-2 font-medium">Margin</th>
                <th className="px-3 py-2 font-medium">By</th>
              </tr>
            </thead>
            <tbody>
              {payload.flags.slice(0, 40).map((flag) => (
                <tr key={`${flag.txnId}-${flag.label}`} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{flag.ts.slice(0, 16).replace("T", " ")}</td>
                  <td className="px-3 py-2 font-mono text-xs" title={flag.txnId}>
                    {flag.txnId.slice(0, 8)}…{flag.date}
                  </td>
                  <td className="px-3 py-2">{fraudLabel(flag.label)}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">{flag.margin.toFixed(2)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{flag.user}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

function StatusBadge({ status }: { status: FlagLabel["status"] }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        status === "known" && "border-[#e2b15a] text-[#e2b15a]",
        status === "active" && "border-[#8fbf9f] text-[#8fbf9f]",
        status === "candidate" && "text-muted-foreground",
      )}
    >
      {status}
    </Badge>
  )
}
