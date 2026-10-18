import type { Band, ScoreTxn, Scored, Signal, WindowScore } from "@/lib/types"

const CATEGORY: Record<string, { points: number; detail: string }> = {
  shopping_net: {
    points: 18,
    detail:
      "shopping_net is 0.320% fraud in this book, the highest category rate, against a book rate of 0.10%.",
  },
  misc_net: {
    points: 16,
    detail: "misc_net is 0.291% fraud, the second highest category rate.",
  },
  grocery_pos: {
    points: 15,
    detail: "grocery_pos is 0.245% fraud. Checkout grocery is a main fraud rail here.",
  },
  shopping_pos: {
    points: 8,
    detail: "shopping_pos is 0.120% fraud, above the book rate but well under the online rail.",
  },
  gas_transport: {
    points: 5,
    detail: "gas_transport is 0.094% fraud, close to the book rate of 0.10%.",
  },
  travel: { points: 3, detail: "travel is 0.049% fraud." },
  misc_pos: { points: 3, detail: "misc_pos is 0.047% fraud." },
  entertainment: { points: 3, detail: "entertainment is 0.041% fraud." },
  personal_care: { points: 2, detail: "personal_care is 0.040% fraud." },
  grocery_net: { points: 2, detail: "grocery_net is 0.037% fraud." },
  food_dining: { points: 1, detail: "food_dining is 0.029% fraud." },
  kids_pets: { points: 1, detail: "kids_pets is 0.027% fraud." },
  health_fitness: { points: 1, detail: "health_fitness is 0.026% fraud." },
  home: { points: 1, detail: "home is 0.025% fraud, the lowest category rate in the book." },
}

const MERCHANT: Record<string, { points: number; detail: string }> = {
  M01: {
    points: 10,
    detail:
      "M01 is the thin merchant cluster: median log cardholders 2.48 against 8.99 for the book, and the same gap on transaction count.",
  },
  M02: {
    points: 0,
    detail:
      "M02 is everyday home, food, and entertainment, and these merchants are active on a high share of days.",
  },
  M03: {
    points: 1,
    detail: "M03 mixes personal care, travel, and kids and pets, with a rising recent trend.",
  },
  M04: {
    points: 8,
    detail:
      "M04 is online grocery_net and misc_net, and it trades through the night (hour_00_04 mean 0.30 against 0.11).",
  },
  M05: {
    points: 0,
    detail: "M05 is health and fitness, busiest in the evening.",
  },
  M06: {
    points: 10,
    detail:
      "M06 is entirely shopping_net and entirely online, the category with the highest fraud rate.",
  },
  M07: {
    points: 10,
    detail:
      "M07 is grocery checkout concentrated in the small hours (hour_00_04 mean 0.32 against 0.11).",
  },
  M08: {
    points: 2,
    detail: "M08 is in-person shopping, with a high transaction count per cardholder.",
  },
  M09: {
    points: 4,
    detail: "M09 is in-person misc, with a wider amount spread and some overnight activity.",
  },
  M10: {
    points: 2,
    detail:
      "M10 is fuel, and the group itself trades overnight. A night fuel charge is in character for these merchants.",
  },
}

export function bandOf(points: number): Band {
  if (points >= 70) return "block"
  if (points >= 46) return "step_up"
  if (points >= 28) return "watch"
  return "clear"
}

export function epoch(at: string): number {
  return Date.parse(at.endsWith("Z") ? at : `${at}Z`)
}

export function hourOf(at: string): number {
  return Number(at.slice(11, 13))
}

function chargesInSixHours(txns: ScoreTxn[], index: number): number {
  const end = epoch(txns[index].at)
  const start = end - 6 * 60 * 60 * 1000
  let count = 0
  for (let i = 0; i <= index; i += 1) {
    const at = epoch(txns[i].at)
    if (at >= start && at <= end) count += 1
  }
  return count
}

function hourSignal(hour: number, group: string): Signal {
  let base = 0
  let window = "Outside 22:00–05:59, fraud in this book is uncommon."
  if (hour >= 22) {
    base = 16
    window = "22:00–23:59 holds about 60% of fraud rows in this book, packed into two hours."
  } else if (hour <= 3) {
    base = 14
    window = "00:00–03:59 holds about 36% of fraud rows."
  } else if (hour <= 5) {
    base = 5
    window = "04:00–05:59 is the shoulder after the fraud window."
  }

  let multiplier = 1
  let character =
    "Group A03 is not a night-shifted group, so the clock counts at the book rate."
  if (group === "A01") {
    multiplier = 1.35
    character =
      "Group A01 spends less of its book in the small hours (hour_00_04 mean 0.087 against 0.138), so the clock counts harder."
  } else if (group === "A02") {
    multiplier = 0.45
    character =
      "Group A02 already spends more of its book from midnight to 08:00, so the clock alone is a weaker signal."
  } else if (group === "A04") {
    multiplier = 0.4
    character =
      "Group A04 is the early-morning group (hour_00_04 mean 0.192 against 0.138), so a late hour is closer to character."
  }

  return {
    id: "hour",
    label: "Hour",
    detail: `${window} ${character}`,
    points: Math.round(base * multiplier),
  }
}

function burstSignal(count: number): Signal {
  if (count >= 8) {
    return {
      id: "burst",
      label: "Burst",
      detail: `${count} charges in six hours. Sparkov fraud events are about ten charges over about a day, with no genuine charges mixed in.`,
      points: 30,
    }
  }
  if (count >= 6) {
    return {
      id: "burst",
      label: "Burst",
      detail: `${count} charges in six hours. That is the shape of a fraud burst in this book.`,
      points: 24,
    }
  }
  if (count >= 4) {
    return {
      id: "burst",
      label: "Burst",
      detail: `${count} charges in six hours. Busier than a normal evening, short of a full burst.`,
      points: 16,
    }
  }
  if (count >= 3) {
    return {
      id: "burst",
      label: "Burst",
      detail: `${count} charges in six hours.`,
      points: 10,
    }
  }
  if (count >= 2) {
    return {
      id: "burst",
      label: "Burst",
      detail: `${count} charges in six hours.`,
      points: 5,
    }
  }
  return {
    id: "burst",
    label: "Burst",
    detail: "A single charge in the last six hours. Fraud in this book rarely arrives as one charge.",
    points: 0,
  }
}

function amountSignal(amount: number): Signal {
  if (amount >= 1500) {
    return {
      id: "amount",
      label: "Amount",
      detail: `$${amount.toFixed(2)} sits above the highest fraud ticket in this book ($1,447.68). The largest genuine ticket is $45,688.89, so a large amount is not a fraud signal here.`,
      points: -12,
    }
  }
  if (amount >= 80 && amount <= 1448) {
    return {
      id: "amount",
      label: "Amount",
      detail: `$${amount.toFixed(2)} sits in the band where fraud tickets in this book actually land, under $1,448.`,
      points: 4,
    }
  }
  return {
    id: "amount",
    label: "Amount",
    detail: `$${amount.toFixed(2)} is outside the usual fraud band and under the ceiling. Amount is not pushing this charge.`,
    points: 0,
  }
}

function clashSignal(group: string, category: string): Signal | null {
  if (group === "A03" && category === "gas_transport") {
    return {
      id: "clash",
      label: "Profile clash",
      detail:
        "Fuel is the widest gap in group A03 (cat_gas_transport mean 0.033 against 0.088, −1.44 sd). A fuel charge is off this account's profile.",
      points: 12,
    }
  }
  if (
    group === "A01" &&
    (category === "shopping_net" || category === "misc_net" || category === "grocery_pos")
  ) {
    return {
      id: "clash",
      label: "Profile clash",
      detail:
        "Group A01 is smaller tickets in daylight (log amount median 3.61 against 3.89). A high-fraud-rate category is a departure from that profile.",
      points: 4,
    }
  }
  return null
}

function onlineNightSignal(category: string, hour: number): Signal | null {
  const online = category.endsWith("_net")
  const night = hour >= 22 || hour <= 3
  if (!online || !night) return null
  return {
    id: "online_night",
    label: "Online at night",
    detail:
      "A card-not-present category during the fraud hours stacks on the category rate. That is where this book hides fraud.",
    points: 5,
  }
}

export function scorePrefix(group: string, txns: ScoreTxn[]): Scored {
  if (txns.length === 0) {
    return { points: 0, band: "clear", signals: [] }
  }
  const index = txns.length - 1
  const last = txns[index]
  const hour = hourOf(last.at)
  const category = CATEGORY[last.category] ?? {
    points: 2,
    detail: `${last.category} has no rate in the published profile, so it takes a small default weight.`,
  }
  const merchant = MERCHANT[last.merchantGroup] ?? {
    points: 0,
    detail: "This merchant group is not in the map.",
  }
  const signals: Signal[] = [
    { id: "category", label: "Category", detail: category.detail, points: category.points },
    hourSignal(hour, group),
    burstSignal(chargesInSixHours(txns, index)),
    amountSignal(last.amount),
    {
      id: "merchant",
      label: "Merchant group",
      detail: merchant.detail,
      points: merchant.points,
    },
  ]
  const clash = clashSignal(group, last.category)
  if (clash) signals.push(clash)
  const online = onlineNightSignal(last.category, hour)
  if (online) signals.push(online)
  const points = signals.reduce((sum, signal) => sum + signal.points, 0)
  return { points, band: bandOf(points), signals }
}

export function scoreWindow(group: string, txns: ScoreTxn[]): WindowScore {
  const perTxn = txns.map((_, index) => scorePrefix(group, txns.slice(0, index + 1)))
  let driverIndex = 0
  perTxn.forEach((scored, index) => {
    if (scored.points > perTxn[driverIndex].points) driverIndex = index
  })
  const overall = perTxn[driverIndex] ?? { points: 0, band: "clear" as Band, signals: [] }
  return { overall, perTxn, driverIndex }
}
