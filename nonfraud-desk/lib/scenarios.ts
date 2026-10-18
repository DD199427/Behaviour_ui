import type { Band } from "@/lib/types"

export type ScenarioTxn = {
  day: "2026-10-16" | "2026-10-17"
  hour: number
  minute: number
  category: string
  merchantGroup: string
  merchantNth: number
  amount: number
}

export type Scenario = {
  id: string
  title: string
  scenario: string
  aim: Band
  accountGroup: string
  accountNth: number
  useSpotlight?: boolean
  txns: ScenarioTxn[]
}

function at(
  day: ScenarioTxn["day"],
  hour: number,
  minute: number,
  category: string,
  merchantGroup: string,
  merchantNth: number,
  amount: number,
): ScenarioTxn {
  return { day, hour, minute, category, merchantGroup, merchantNth, amount }
}

export const SCENARIOS: Scenario[] = [
  {
    id: "NF-4410",
    title: "Nine charges before midnight",
    scenario:
      "A daylight card in A01 sends nine charges in under two hours, mostly online and at grocery checkouts. This is the Sparkov fraud shape: a short night burst, with no ordinary spend mixed in.",
    aim: "block",
    accountGroup: "A01",
    accountNth: 12,
    txns: [
      at("2026-10-16", 22, 6, "shopping_net", "M06", 0, 186.4),
      at("2026-10-16", 22, 18, "misc_net", "M01", 0, 240.15),
      at("2026-10-16", 22, 31, "grocery_pos", "M07", 0, 92.08),
      at("2026-10-16", 22, 44, "shopping_net", "M06", 1, 410),
      at("2026-10-16", 22, 57, "misc_net", "M04", 0, 128.55),
      at("2026-10-16", 23, 11, "shopping_pos", "M08", 0, 76.2),
      at("2026-10-16", 23, 24, "grocery_pos", "M07", 1, 305.47),
      at("2026-10-16", 23, 38, "shopping_net", "M06", 2, 860.33),
      at("2026-10-16", 23, 51, "misc_net", "M01", 1, 190.04),
    ],
  },
  {
    id: "NF-4418",
    title: "Late dinner, in character",
    scenario:
      "Group A02 already lives in the late hours. One food charge at 23:18 is what this neighbourhood does.",
    aim: "clear",
    accountGroup: "A02",
    accountNth: 4,
    txns: [at("2026-10-16", 23, 18, "food_dining", "M02", 0, 48)],
  },
  {
    id: "NF-4426",
    title: "A large travel ticket",
    scenario:
      "The largest fraud ticket in the Sparkov book is $1,447.68. This $6,240 travel charge is above that ceiling, in the afternoon, on a high-ticket group.",
    aim: "clear",
    accountGroup: "A03",
    accountNth: 7,
    txns: [at("2026-10-16", 13, 22, "travel", "M03", 0, 6240)],
  },
  {
    id: "NF-4432",
    title: "Two charges at a thin merchant",
    scenario:
      "Two misc_net charges after midnight at merchants in M01, the thin cluster, on a daylight card.",
    aim: "step_up",
    accountGroup: "A01",
    accountNth: 80,
    txns: [
      at("2026-10-17", 1, 14, "misc_net", "M01", 4, 640),
      at("2026-10-17", 1, 41, "misc_net", "M01", 5, 410),
    ],
  },
  {
    id: "NF-4440",
    title: "Early grocery, early-morning card",
    scenario:
      "Group A04 spends the early morning. Two grocery checkouts around 05:00 are close to that habit, and two is not a burst.",
    aim: "watch",
    accountGroup: "A04",
    accountNth: 9,
    txns: [
      at("2026-10-17", 5, 12, "grocery_pos", "M07", 2, 62),
      at("2026-10-17", 5, 27, "grocery_pos", "M07", 3, 44),
    ],
  },
  {
    id: "NF-4448",
    title: "Early grocery, daylight card",
    scenario:
      "The same grocery-checkout rail, six times between 02:00 and 03:36, on an A01 card that barely spends in those hours.",
    aim: "block",
    accountGroup: "A01",
    accountNth: 140,
    txns: [
      at("2026-10-17", 2, 12, "grocery_pos", "M07", 4, 118),
      at("2026-10-17", 2, 28, "grocery_pos", "M07", 5, 86),
      at("2026-10-17", 2, 44, "grocery_pos", "M07", 6, 240),
      at("2026-10-17", 3, 1, "grocery_pos", "M07", 7, 132),
      at("2026-10-17", 3, 18, "grocery_pos", "M07", 8, 96),
      at("2026-10-17", 3, 36, "grocery_pos", "M07", 9, 210),
    ],
  },
  {
    id: "NF-4455",
    title: "One online shop at 21:08",
    scenario:
      "shopping_net is the highest-fraud category, but this is a single charge at 21:08, before the 22:00 window, with no burst.",
    aim: "watch",
    accountGroup: "A03",
    accountNth: 30,
    txns: [at("2026-10-16", 21, 8, "shopping_net", "M06", 4, 220)],
  },
  {
    id: "NF-4462",
    title: "Fuel on the commute",
    scenario:
      "One fuel charge at 08:12. Fuel sits near the book fraud rate, and merchant group M10 is built for the early hours.",
    aim: "clear",
    accountGroup: "A02",
    accountNth: 20,
    txns: [at("2026-10-16", 8, 12, "gas_transport", "M10", 0, 46.2)],
  },
  {
    id: "NF-4470",
    title: "Fuel, off this profile",
    scenario:
      "Group A03 barely buys fuel. Three fuel charges just after 02:00 are off the profile, even though these merchants themselves trade overnight.",
    aim: "step_up",
    accountGroup: "A03",
    accountNth: 55,
    txns: [
      at("2026-10-17", 2, 8, "gas_transport", "M10", 1, 72),
      at("2026-10-17", 2, 24, "gas_transport", "M10", 2, 88),
      at("2026-10-17", 2, 41, "gas_transport", "M10", 3, 81),
    ],
  },
  {
    id: "NF-4478",
    title: "Nearest neighbour is another group",
    scenario:
      "A quiet lunch. The notable fact is identity, not the charge: the nearest behaviour neighbour sits in a different group, which is true for 160 of 8,817 accounts.",
    aim: "clear",
    accountGroup: "A04",
    accountNth: 0,
    useSpotlight: true,
    txns: [at("2026-10-16", 12, 40, "food_dining", "M02", 3, 36)],
  },
  {
    id: "NF-4486",
    title: "An in-person shop at lunch",
    scenario:
      "One shopping_pos charge at 12:40. In-person shopping carries a lower fraud rate than the online rail, and the tape is a single charge.",
    aim: "clear",
    accountGroup: "A01",
    accountNth: 200,
    txns: [at("2026-10-16", 12, 40, "shopping_pos", "M08", 3, 64.5)],
  },
  {
    id: "NF-4494",
    title: "Eight online charges, night-native card",
    scenario:
      "Group A02 is allowed to be awake. Eight misc_net charges through thin merchants in two hours are a different matter.",
    aim: "block",
    accountGroup: "A02",
    accountNth: 33,
    txns: [
      at("2026-10-16", 22, 11, "misc_net", "M01", 8, 96),
      at("2026-10-16", 22, 24, "misc_net", "M01", 9, 140),
      at("2026-10-16", 22, 36, "misc_net", "M01", 10, 88.5),
      at("2026-10-16", 22, 49, "misc_net", "M01", 11, 210),
      at("2026-10-16", 23, 2, "misc_net", "M01", 12, 132),
      at("2026-10-16", 23, 18, "misc_net", "M01", 13, 260),
      at("2026-10-16", 23, 33, "misc_net", "M01", 14, 118),
      at("2026-10-16", 23, 48, "misc_net", "M01", 15, 176),
    ],
  },
]
