import type { Feature } from "@/lib/types"

/** Generator fraud types. The notes describe how Sparkov plants each one.
 *  Figures shown next to them are computed from fraud_events.csv, not typed here. */
export const FRAUD_NOTES: Record<string, string> = {
  phishing_fake_site:
    "Card details entered by the cardholder at a fake online shop. Small test charges, then a spree online, often at night and far from home.",
  breached_online_store:
    "Card details entered by the cardholder at a store running a card-skimming script. Test charges, then a spree, but only weeks after the purchase.",
  skimmer_cloned_card:
    "Card details captured by a skimmer at a gas pump. The cloned card is then used in person, in another state, mostly during the day.",
  rogue_employee:
    "The card leaves the cardholder's sight at a restaurant and an employee copies it. Online purchases follow, mostly in the evening.",
  friendly_family:
    "Someone with access to the card at home uses it. Small amounts, in the cardholder's usual categories, near home, over weeks. It looks like normal spending.",
  lost_stolen_card:
    "The card is lost or stolen. A quick burst of in-store purchases near home. The cardholder has no transactions until a replacement card arrives.",
}

export const FRAUD_DISPLAY: Record<string, string> = {
  phishing_fake_site: "Phishing (fake site)",
  breached_online_store: "Breached online store",
  skimmer_cloned_card: "Skimmer (cloned card)",
  rogue_employee: "Rogue employee",
  friendly_family: "Friendly or family",
  lost_stolen_card: "Lost or stolen card",
}

export const ENTERED_BY: Record<string, string> = {
  cardholder: "Cardholder",
  other_user: "Another person",
}

export const KNOWN_FRAUD_TYPES = Object.keys(FRAUD_NOTES)

export const MIN_FLAGS = 5
export const MIN_ENTITIES = 3

export const TRIAGE_CHECK =
  "Scored once against the generator's own labels: the true type was the closest match 66% of the time and in the top three 99.5% of the time. A margin above 0.5 was about 56% precision at 85% recall on known fraud. Phishing and a breached store often trade places, because the delay after compromise is not inside one transaction vector."

const CATEGORY_LABEL: Record<string, string> = {
  entertainment: "entertainment",
  food_dining: "dining",
  gas_transport: "gas stations",
  grocery_net: "online grocery shopping",
  grocery_pos: "in-store grocery shopping",
  health_fitness: "health and fitness",
  home: "home-related purchases",
  kids_pets: "kids and pets",
  misc_net: "other online purchases",
  misc_pos: "other in-store purchases",
  personal_care: "personal care",
  shopping_net: "online shopping",
  shopping_pos: "in-store shopping",
  travel: "travel",
}

const NUMERIC_PHRASE: Record<string, [string, string]> = {
  log_amt_median: ["a higher typical purchase amount", "a lower typical purchase amount"],
  log_amt_p90: ["larger big-ticket purchases", "smaller big-ticket purchases"],
  amt_log_iqr: ["more variation in purchase amounts", "more consistent purchase amounts"],
  log_km_median: ["shopping further from home", "shopping closer to home"],
  log_km_p90: ["some long-distance trips", "mostly local trips"],
  log_distinct_merchants: ["a wider spread of merchants used", "a narrower spread of merchants used"],
  log_history_days: ["a longer transaction history", "a shorter transaction history"],
  log_tx_per_active_day: ["more transactions on active days", "fewer transactions on active days"],
  active_day_share: ["being active more often", "being active less often"],
  weekend_share: ["more weekend activity", "less weekend activity"],
  online_share: ["more online activity", "less online activity"],
  log_cardholders: ["more distinct cards seen here", "fewer distinct cards seen here"],
  log_tx: ["more total transactions", "fewer total transactions"],
  log_tx_per_cardholder: ["cards returning more often", "cards returning less often"],
  beyond_usual_distance_share: [
    "customers often travelling unusually far",
    "customers rarely travelling unusually far",
  ],
  log_recent_trend: [
    "a pickup in activity over the last 90 days",
    "a slowdown in activity over the last 90 days",
  ],
}

export function fraudLabel(id: string): string {
  return FRAUD_DISPLAY[id] ?? id.replaceAll("_", " ")
}

export function enteredByLabel(value: string): string {
  return ENTERED_BY[value] ?? value
}

export function slugBehaviour(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)
}

export function isKnownFraudType(name: string): boolean {
  return name in FRAUD_NOTES
}

function featurePoint(feature: string, higher: boolean): string {
  if (feature === "is_online") return higher ? "mostly an online merchant" : "rarely an online merchant"
  if (feature.startsWith("is_")) {
    const category = CATEGORY_LABEL[feature.slice(3)] ?? feature.slice(3).replaceAll("_", " ")
    return higher ? `mostly categorised as ${category}` : `rarely categorised as ${category}`
  }
  if (feature.startsWith("hour_")) {
    const [, start, end] = feature.split("_")
    return `${higher ? "more" : "less"} active between ${start}:00 and ${end}:00`
  }
  if (feature.startsWith("cat_")) {
    const category = CATEGORY_LABEL[feature.slice(4)] ?? feature.slice(4).replaceAll("_", " ")
    return `${higher ? "more" : "less"} spending on ${category}`
  }
  const phrases = NUMERIC_PHRASE[feature]
  if (phrases) return higher ? phrases[0] : phrases[1]
  const plain = feature.replaceAll("_", " ")
  return higher ? plain : `less ${plain}`
}

export function groupDescription(
  entity: "account" | "merchant",
  size: number,
  features: Pick<Feature, "feature" | "sd">[],
): string {
  const noun = entity === "account" ? "accounts" : "merchants"
  const points = features.slice(0, 2).map((item) => featurePoint(item.feature, item.sd >= 0))
  const body = points.length > 0 ? points.join("; ") : "no single feature stands out strongly"
  return `A group of ${size.toLocaleString("en-US")} ${noun} distinguished mainly by: ${body}.`
}

export function deviationPhrase(sd: number): string {
  const direction = sd >= 0 ? "higher" : "lower"
  const size = Math.abs(sd)
  const word =
    size < 0.5
      ? "about typical"
      : size < 1.5
        ? `somewhat ${direction}`
        : size < 3
          ? `much ${direction}`
          : `far ${direction}`
  return `${word[0].toUpperCase()}${word.slice(1)} (z = ${sd >= 0 ? "+" : ""}${sd.toFixed(1)})`
}

export type LibraryType = {
  id: string
  name: string
  note: string
  enteredBy: string
  events: number
  medianDelayDays: number
  medianDurationDays: number
  medianLoss: number
  totalLoss: number
}

export type LibraryGroup = {
  id: string
  entity: "account" | "merchant"
  size: number
  summary: string
  method: string
  description: string
  suggestedName: string
  features: {
    feature: string
    phrase: string
    group: number
    overall: number
    sd: number
  }[]
}

export type TriageMeta = {
  scanned: number
  skipped: number
  floor: number
  aboveFloor: number
  above: Record<string, number>
  byTypeAtFloor: Record<string, number>
  range: [string, string]
  schema: string
  version: string
  asof: string
  method: string
}

export type TriageRow = {
  txnId: string
  accountId: string
  date: string
  match: string
  score: number
  margin: number
}

export type FlagStatus = "known" | "active" | "candidate"

export type FlagLabel = {
  name: string
  status: FlagStatus
  origin: "generator" | "analyst"
  description: string
  flags: number
  entities: number
  flagsNeeded: number
  entitiesNeeded: number
}

export type FlagRecord = {
  txnId: string
  accountId: string
  date: string
  label: string
  confidence: number
  margin: number
  user: string
  note: string
  ts: string
}
