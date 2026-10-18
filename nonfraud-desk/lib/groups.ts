export const GROUP_LABEL: Record<string, string> = {
  A01: "Daylight, smaller tickets",
  A02: "Late night, longer trips",
  A03: "High ticket, little fuel",
  A04: "Early morning",
  M01: "Thin merchants",
  M02: "Home, food, entertainment",
  M03: "Care, travel, kids",
  M04: "Online, night",
  M05: "Health and fitness",
  M06: "Shopping online",
  M07: "Grocery checkout, night",
  M08: "Shopping in person",
  M09: "Misc in person",
  M10: "Fuel, overnight",
}

export const GROUP_COLOR: Record<string, string> = {
  A01: "#e2b15a",
  A02: "#7eb6d6",
  A03: "#e07a5f",
  A04: "#8fbf9f",
}

export const FEATURE_LABEL: Record<string, string> = {
  log_amt_median: "Median log amount",
  log_amt_p90: "90th percentile log amount",
  amt_log_iqr: "Amount spread, log IQR",
  cat_personal_care: "Share, personal care",
  cat_gas_transport: "Share, fuel",
  cat_travel: "Share, travel",
  hour_00_04: "Share of activity, 00:00–04:00",
  hour_04_08: "Share of activity, 04:00–08:00",
  hour_08_12: "Share of activity, 08:00–12:00",
  hour_16_20: "Share of activity, 16:00–20:00",
  hour_20_24: "Share of activity, 20:00–24:00",
  log_km_p90: "90th percentile log distance",
  log_km_median: "Median log distance",
  log_cardholders: "Log cardholders",
  log_tx: "Log transactions",
  log_tx_per_cardholder: "Log transactions per cardholder",
  active_day_share: "Share of days active",
  is_home: "Home",
  is_entertainment: "Entertainment",
  is_food_dining: "Food and dining",
  log_recent_trend: "Recent volume trend",
  is_kids_pets: "Kids and pets",
  is_personal_care: "Personal care",
  is_travel: "Travel",
  is_grocery_net: "Grocery online",
  is_online: "Online",
  is_health_fitness: "Health and fitness",
  is_shopping_net: "Shopping online",
  is_grocery_pos: "Grocery checkout",
  is_shopping_pos: "Shopping in person",
  is_misc_pos: "Misc in person",
  is_gas_transport: "Fuel",
}

export function groupLabel(id: string): string {
  return GROUP_LABEL[id] ?? id
}

export function featureLabel(feature: string): string {
  return FEATURE_LABEL[feature] ?? feature
}

export const CATEGORIES = [
  "shopping_net",
  "misc_net",
  "grocery_pos",
  "shopping_pos",
  "gas_transport",
  "travel",
  "misc_pos",
  "entertainment",
  "personal_care",
  "grocery_net",
  "food_dining",
  "kids_pets",
  "health_fitness",
  "home",
] as const
