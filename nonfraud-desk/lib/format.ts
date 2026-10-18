const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

export function money(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

export function maskId(id: string): string {
  if (id.length <= 8) return id
  return `${id.slice(0, 4)}···${id.slice(-4)}`
}

export function merchantLabel(name: string): string {
  return name.replace(/^fraud_/, "")
}

export function clock(at: string): string {
  const [date, time = "00:00"] = at.split("T")
  const [, month, day] = date.split("-")
  const label = MONTHS[Number(month) - 1] ?? month
  return `${Number(day)} ${label}, ${time.slice(0, 5)}`
}

export function tapeSpan(times: string[]): string {
  if (times.length === 0) return ""
  if (times.length === 1) return clock(times[0])
  const start = clock(times[0])
  const end = clock(times[times.length - 1])
  const startDay = start.slice(0, start.indexOf(","))
  const endDay = end.slice(0, end.indexOf(","))
  if (startDay === endDay) {
    return `${start} – ${end.slice(end.indexOf(",") + 2)}`
  }
  return `${start} – ${end}`
}

export function bandLabel(band: string): string {
  if (band === "step_up") return "Step up"
  if (band === "block") return "Block"
  if (band === "watch") return "Watch"
  return "Clear"
}

export function countLabel(count: number, noun: string): string {
  return `${count.toLocaleString("en-US")} ${noun}${count === 1 ? "" : "s"}`
}
