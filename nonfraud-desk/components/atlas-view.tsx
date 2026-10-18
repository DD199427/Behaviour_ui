"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { featureLabel, GROUP_COLOR, groupLabel } from "@/lib/groups"
import { maskId, merchantLabel } from "@/lib/format"
import type { BehaviourIndex, Feature, GroupRecord } from "@/lib/types"
import { Button } from "@/components/ui/button"

type AtlasPayload = {
  asof: string
  counts: BehaviourIndex["counts"]
  groups: GroupRecord[]
  merchantSamples: Record<string, { name: string; category: string }[]>
  accountSamples: Record<string, string[]>
}

export function AtlasView() {
  const [payload, setPayload] = useState<AtlasPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    fetch("/api/atlas")
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || "The atlas did not load.")
        if (!cancel) setPayload(body as AtlasPayload)
      })
      .catch((loadError: unknown) => {
        if (!cancel) setError(loadError instanceof Error ? loadError.message : "The atlas did not load.")
      })
    return () => {
      cancel = true
    }
  }, [])

  if (error) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <h2 className="font-heading text-3xl">The atlas did not load</h2>
        <p className="mt-3 text-sm text-muted-foreground">{error}</p>
        <Button type="button" className="mt-4" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    )
  }

  if (!payload) {
    return (
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-48 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    )
  }

  const accounts = payload.groups.filter((group) => group.entity === "account")
  const merchants = payload.groups.filter((group) => group.entity === "merchant")

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <p className="text-[11px] tracking-[0.16em] text-muted-foreground uppercase">Behaviour atlas</p>
        <h1 className="mt-1 font-heading text-4xl tracking-tight">Fourteen groups, one book</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Measured 30 Sep 2026. {payload.counts.accounts.toLocaleString("en-US")} accounts in four groups,
          silhouette 0.3862. {payload.counts.merchants.toLocaleString("en-US")} merchants in ten groups,
          silhouette 0.708. Bars show how far each feature sits from the book, in standard deviations.
        </p>
        <Tabs defaultValue="accounts" className="mt-6">
          <TabsList>
            <TabsTrigger value="accounts">Accounts</TabsTrigger>
            <TabsTrigger value="merchants">Merchants</TabsTrigger>
          </TabsList>
          <TabsContent value="accounts" className="mt-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {accounts.map((group) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  samples={
                    <p className="font-mono text-xs text-muted-foreground">
                      {(payload.accountSamples[group.id] ?? []).map(maskId).join("  ·  ")}
                    </p>
                  }
                />
              ))}
            </div>
          </TabsContent>
          <TabsContent value="merchants" className="mt-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {merchants.map((group) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  samples={
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {(payload.merchantSamples[group.id] ?? []).map((merchant) => (
                        <li key={`${merchant.name}-${merchant.category}`}>
                          {merchantLabel(merchant.name)}
                          <span className="font-mono"> · {merchant.category}</span>
                        </li>
                      ))}
                    </ul>
                  }
                />
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function GroupCard({ group, samples }: { group: GroupRecord; samples: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge variant="outline" style={{ borderColor: GROUP_COLOR[group.id] ?? undefined }}>
            {group.id}
          </Badge>
          <CardTitle>{groupLabel(group.id)}</CardTitle>
        </div>
        <CardDescription>
          {group.size.toLocaleString("en-US")} {group.entity === "account" ? "accounts" : "merchants"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-6">{group.summary}</p>
        <div className="space-y-3">
          {group.top.map((feature) => (
            <FeatureBar key={feature.feature} feature={feature} />
          ))}
        </div>
        {samples}
        <p className="text-[11px] leading-4 text-muted-foreground">{group.method}</p>
      </CardContent>
    </Card>
  )
}

function FeatureBar({ feature }: { feature: Feature }) {
  const magnitude = Math.min(1, Math.abs(feature.sd) / 3)
  const negative = feature.sd < 0
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span>{featureLabel(feature.feature)}</span>
        <span className="font-mono text-muted-foreground">
          {feature.sd > 0 ? "+" : ""}
          {feature.sd.toFixed(2)} sd
        </span>
      </div>
      <div className="relative mt-1 h-1.5 rounded-full bg-muted">
        <span className="absolute top-0 left-1/2 h-full w-px bg-foreground/30" />
        <span
          className="absolute top-0 h-full rounded-full"
          style={{
            width: `${magnitude * 50}%`,
            left: negative ? `${50 - magnitude * 50}%` : "50%",
            background: negative ? "#7eb6d6" : "#e07a5f",
          }}
        />
      </div>
      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
        {feature.stat} {feature.group.toFixed(3)} vs {feature.overall.toFixed(3)}
      </p>
    </div>
  )
}
