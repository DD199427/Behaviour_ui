import { bandLabel } from "@/lib/format"
import type { Band } from "@/lib/types"
import { cn } from "cn"

export const BAND_HEX: Record<Band, string> = {
  block: "#e15a38",
  step_up: "#e2b15a",
  watch: "#8eafc4",
  clear: "#3f8f72",
}

const TEXT: Record<Band, string> = {
  block: "text-white",
  step_up: "text-[#2a2112]",
  watch: "text-[#142028]",
  clear: "text-white",
}

export function BandPill({ band, className }: { band: Band; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide",
        TEXT[band],
        className,
      )}
      style={{ background: BAND_HEX[band] }}
    >
      {bandLabel(band)}
    </span>
  )
}

export function ScoreMeter({ points }: { points: number }) {
  const width = Math.max(0, Math.min(100, points))
  return (
    <div className="relative mt-2 h-1.5 rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary"
        style={{ width: `${width}%` }}
      />
      {[28, 46, 70].map((tick) => (
        <span
          key={tick}
          className="absolute top-[-3px] h-3 w-px bg-foreground/40"
          style={{ left: `${tick}%` }}
        />
      ))}
    </div>
  )
}
