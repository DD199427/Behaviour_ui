import type { Signal } from "@/lib/types"

export function SignalList({ signals, total }: { signals: Signal[]; total: number }) {
  return (
    <ol className="space-y-3">
      {signals.map((signal) => (
        <li key={signal.id} className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-3">
          <span
            className={
              signal.points < 0
                ? "font-mono text-sm text-[#8eafc4]"
                : signal.points === 0
                  ? "font-mono text-sm text-muted-foreground"
                  : "font-mono text-sm text-foreground"
            }
          >
            {signal.points > 0 ? `+${signal.points}` : signal.points}
          </span>
          <span>
            <span className="block text-sm font-medium">{signal.label}</span>
            <span className="mt-0.5 block text-sm leading-5 text-muted-foreground">
              {signal.detail}
            </span>
          </span>
        </li>
      ))}
      <li className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-3 border-t border-border pt-3">
        <span className="font-mono text-sm">{total}</span>
        <span className="text-sm">
          Total. Block at 70, step up at 46, watch at 28. The weights are fixed.
          They are not a trained probability.
        </span>
      </li>
    </ol>
  )
}
