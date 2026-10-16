"""Short narrative descriptions of the 6 fraud types the Sparkov generator produces.
Domain context only — every number shown next to these in the UI is computed fresh from the data,
never hardcoded here. See Outputs/fraud_poc_v2/Sparkov_v2_Data_Profile.md for how these were derived."""

FRAUD_TYPE_NOTES = {
    "phishing_fake_site": "Card details entered by the cardholder at a fake online shop. Small test "
        "charges, then a spree online — often at night, far from home.",
    "breached_online_store": "Card details entered by the cardholder at a store running a "
        "card-skimming script. Test charges then a spree, but only weeks after the purchase.",
    "skimmer_cloned_card": "Card details captured by a skimmer at a gas pump. The cloned card is then "
        "used in person, in another state, mostly during the day.",
    "rogue_employee": "The card leaves the cardholder's sight at a restaurant and an employee copies "
        "it. Online purchases follow, mostly in the evening.",
    "friendly_family": "Someone with access to the card at home uses it. Small amounts, in the "
        "cardholder's usual categories, near home, over weeks — looks like normal spending.",
    "lost_stolen_card": "The card is lost or stolen. A quick burst of in-store purchases near home; "
        "the cardholder has no transactions until a replacement card arrives.",
}

# ---- Turning a discovered group's technical top features into a short, plain-English description ----
# Used by the Behaviour Library (Discovered Groups tab) and by "Propose as new behaviour". No fraud
# labels or generated data go into this — it only rephrases feature names that are already in schema.json.

CATEGORY_LABEL = {
    "entertainment": "entertainment", "food_dining": "dining", "gas_transport": "gas stations",
    "grocery_net": "online grocery shopping", "grocery_pos": "in-store grocery shopping",
    "health_fitness": "health & fitness", "home": "home-related purchases", "kids_pets": "kids & pets",
    "misc_net": "other online purchases", "misc_pos": "other in-store purchases",
    "personal_care": "personal care", "shopping_net": "online shopping", "shopping_pos": "in-store shopping",
    "travel": "travel",
}

# Each entry is (phrase for a higher-than-typical value, phrase for a lower-than-typical value) — kept
# as two full clauses per feature, rather than one noun glued to a "higher/lower" prefix, so every
# combination reads as a grammatically normal sentence (some phrases aren't simple nouns).
NUMERIC_PHRASE = {
    "log_amt_median": ("a higher typical purchase amount", "a lower typical purchase amount"),
    "log_amt_p90": ("larger big-ticket purchases", "smaller big-ticket purchases"),
    "amt_log_iqr": ("more variation in purchase amounts", "more consistent purchase amounts"),
    "log_km_median": ("shopping further from home", "shopping closer to home"),
    "log_km_p90": ("some long-distance trips", "mostly local trips"),
    "log_distinct_merchants": ("a wider spread of merchants used", "a narrower spread of merchants used"),
    "log_history_days": ("a longer transaction history", "a shorter transaction history"),
    "log_tx_per_active_day": ("more transactions on active days", "fewer transactions on active days"),
    "active_day_share": ("being active more often", "being active less often"),
    "weekend_share": ("more weekend activity", "less weekend activity"),
    "online_share": ("more online activity", "less online activity"),
    "log_cardholders": ("more distinct cards seen here", "fewer distinct cards seen here"),
    "log_tx": ("more total transactions", "fewer total transactions"),
    "log_tx_per_cardholder": ("cards returning more often", "cards returning less often"),
    "beyond_usual_distance_share": ("customers often travelling unusually far",
                                    "customers rarely travelling unusually far"),
    "log_recent_trend": ("a pickup in activity over the last 90 days", "a slowdown in activity over the last 90 days"),
}


def _point(feature):
    """One plain-English clause for a top_features entry, e.g. 'a lower typical purchase amount'."""
    name, higher = feature["feature"], feature["vs_overall_sd"] >= 0
    if name == "is_online":
        return "mostly an online merchant" if higher else "rarely an online merchant"
    if name.startswith("is_"):
        cat = CATEGORY_LABEL.get(name[3:], name[3:])
        return f"mostly categorised as {cat}" if higher else f"rarely categorised as {cat}"
    if name.startswith("hour_"):
        _, a, b = name.split("_")
        return f"{'more' if higher else 'less'} active between {a}:00 and {b}:00"
    if name.startswith("cat_"):
        cat = CATEGORY_LABEL.get(name[4:], name[4:])
        return f"{'more' if higher else 'less'} spending on {cat}"
    hi_phrase, lo_phrase = NUMERIC_PHRASE.get(name, (name.replace("_", " "), "less " + name.replace("_", " ")))
    return hi_phrase if higher else lo_phrase


def group_description(entity, size, top_features, max_points=2):
    """A short, plain-English description of a discovered behaviour group, built from the same
    top_features already stored for it — no new computation, just readable phrasing."""
    noun = "accounts" if entity == "account" else "merchants"
    points = [_point(f) for f in top_features[:max_points]]
    body = "; ".join(points) if points else "no single feature stands out strongly"
    return f"A group of {size:,} {noun} distinguished mainly by: {body}."
