import { maskId, merchantLabel } from "@/lib/format"
import { GROUP_COLOR, groupLabel } from "@/lib/groups"
import type { PeerRef } from "@/lib/types"

export function Neighbourhood({
  accountId,
  accountGroup,
  peers,
  merchantName,
  merchantGroup,
}: {
  accountId: string
  accountGroup: string
  peers: PeerRef[]
  merchantName?: string
  merchantGroup?: string
}) {
  const width = 420
  const height = 300
  const cx = 210
  const cy = 142
  const rx = 148
  const ry = 104
  const nodes = peers.map((peer, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(peers.length, 1)) * Math.PI * 2
    return {
      peer,
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    }
  })
  const centerColor = GROUP_COLOR[accountGroup] ?? "#e7e2d8"

  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img">
        <title>
          {`Behaviour neighbours of ${maskId(accountId)}, group ${accountGroup}`}
        </title>
        {nodes.map(({ peer, x, y }) => {
          const cross = peer.group !== accountGroup
          return (
            <line
              key={`${peer.id}-edge`}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke={cross ? "#e07a45" : "currentColor"}
              strokeOpacity={cross ? 0.9 : 0.28}
              strokeWidth={cross ? 1.6 : 1}
            />
          )
        })}
        {nodes.map(({ peer, x, y }) => (
          <g key={peer.id}>
            <circle
              cx={x}
              cy={y}
              r={peer.group === accountGroup ? 7 : 8}
              fill={GROUP_COLOR[peer.group] ?? "#c4b4a0"}
              stroke={peer.group === accountGroup ? "transparent" : "#e07a45"}
              strokeWidth={1.5}
            />
            <text
              x={x}
              y={y + 18}
              textAnchor="middle"
              fill="currentColor"
              fontSize="9"
              opacity="0.75"
            >
              {maskId(peer.id)}
            </text>
          </g>
        ))}
        <circle cx={cx} cy={cy} r="16" fill={centerColor} />
        <text
          x={cx}
          y={cy + 32}
          textAnchor="middle"
          fill="currentColor"
          fontSize="11"
        >
          {maskId(accountId)} · {accountGroup}
        </text>
      </svg>
      <figcaption className="mt-1 space-y-1 text-xs leading-5 text-muted-foreground">
        <p>
          Ten nearest accounts by behaviour vector, as of 30 Sep 2026.{" "}
          {groupLabel(accountGroup)}. Edges in copper cross into another group.
        </p>
        {merchantName && merchantGroup ? (
          <p>
            Latest merchant {merchantLabel(merchantName)}, group {merchantGroup} ·{" "}
            {groupLabel(merchantGroup)}.
          </p>
        ) : null}
      </figcaption>
    </figure>
  )
}
