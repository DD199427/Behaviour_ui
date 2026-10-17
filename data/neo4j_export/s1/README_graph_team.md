# Behaviour vectors for Neo4j — export s1 / v1

Behaviour vectors computed from the transaction data, ready to add to your graph as **node properties**. Data as of **2026-09-30**.

The load **adds properties to nodes that already exist**. It creates no nodes and no relationships.

## Files

| File | Contents |
|---|---|
| `account_vectors.csv` | 8817 rows, one per card. `bb_profile_vec` (31 numbers) + the same features unscaled as `f_*` columns |
| `merchant_vectors.csv` | 861 rows, one per merchant (name + category). `bb_merchant_vec` (31) and `bb_merchant_cpp_vec` (3) |
| `transaction_vectors/part-*.csv.gz` | 490407 rows, one per transaction (range: 2025-01-01 to 2025-01-31). `bb_txn_vec` (46) |
| `load.cypher` | Loads the CSVs with `LOAD CSV`, creates lookup and vector indexes, and checks how many nodes matched |
| `load_neo4j.py` | Same, with the official Python driver; reads the files from this folder (no copying needed) |
| `behaviour_map.cypher` | Optional: similarity links and behaviour groups (needs the GDS library) |
| `schema.json` | Every feature's position, name, description and scaling values |
| `manifest.json` | Row counts, vector sizes, settings and checksums for every file |

## Properties added

| Node | Property | Type | Meaning |
|---|---|---|---|
| `:Account` | `bb_profile_vec` | list of 31 floats | The card's **normal behaviour** over all its transactions up to 2026-09-30 |
| `:Merchant` | `bb_merchant_vec` | list of 31 floats | The merchant's **activity profile** |
| `:Merchant` | `bb_merchant_cpp_vec` | list of 3 floats | **Common point of purchase**: how often its cardholders are later defrauded. **Built from fraud labels — see below.** |
| `:Transaction` | `bb_txn_vec` | list of 46 floats | The transaction **compared with the card's own earlier history** |
| all of the above | `bb_*_mask` | list of 0/1 | 1 = that feature couldn't be computed (its vector value is 0) |
| all of the above | `bb_schema`, `bb_version`, `bb_asof` | string, string, date | Which export the values came from |

Nodes are matched on `:Account(account_id)`, `:Merchant(name, category)` and `:Transaction(txn_id)`. IDs are strings. If your graph uses other labels or property names, use the options in `load_neo4j.py` or edit the top of `load.cypher`.

## How to load

**Option A — Python** (simplest; handles the compressed transaction files):
```bash
pip install neo4j
export NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=...
python load_neo4j.py --create-indexes
```
It prints, for each entity, how many rows found a matching node.

**Option B — Cypher:**
1. Copy the CSV files (and `transaction_vectors/`) into the Neo4j `import` folder.
2. Run `cypher-shell -f load.cypher`. In Neo4j Browser, put `:auto` before each `LOAD CSV`.
3. Check the counts at the end of the script: `*_without_vector` should be 0 for nodes that exist in the data.

**Requirements:** Neo4j 5.x. Vector indexes need 5.13 or later. AuraDB Free is limited to about 200k nodes, so it can hold the account and merchant vectors but not millions of transactions.

## Using the vectors

```cypher
// the 10 cards that behave most like a given card
MATCH (a:Account {account_id: '<card number>'})
CALL db.index.vector.queryNodes('bb_account_profile', 10, a.bb_profile_vec) YIELD node, score
RETURN node.account_id, score ORDER BY score DESC;
```
- **As model features:** use the lists directly, or the `f_*` columns in the CSV, which hold one unscaled value per named feature.
- **Similarity and groups:** `behaviour_map.cypher` links each account and merchant to its 10 most similar (`BEHAVES_LIKE`) and assigns a `bb_behaviour_group`.

## ⚠ Before training a model

1. **`bb_merchant_cpp_vec` is built from fraud labels.** For each merchant, it counts how many cardholders had a fraud transaction within 120 days after shopping there. If you use it, your training and test split must be **ordered by time**, and the vector must be computed only from data before the test period (re-export with `--asof <end of training period>`). Otherwise it leaks the answer. All other vectors use **no fraud labels**.
2. **Account and merchant vectors are snapshots as of 2026-09-30.** They describe behaviour over the whole history, including after any transaction you might be predicting. For a time-correct model, either:
   - re-export with `--asof` set to your training cut-off, or
   - rely on `bb_txn_vec`, which only uses each card's earlier transactions.
3. **No cut-offs come from how the data was generated.**
   - Time of day uses six equal 4-hour bands.
   - "Small charge" means below 10% of the card's own median.
   - "Far" means beyond the card's own 95th-percentile distance.

   The exact settings are in `schema.json` → `settings`.
4. **Scaling.** `robust` features are scaled as (value − median) / IQR. All values are clipped to [−10, 10], and masked values are set to 0. Shares, flags and differences are left unscaled. The scaling values are in `schema.json`. Exports made with `--reuse-schema` use the same scaling, so their vectors stay comparable.
5. **The data is synthetic** (Sparkov generator). The generator has a known flaw: it ties a card's spending category to the date, so cards shop in one category for weeks at a time. This mostly affects the 72-hour "recent mix" features (`recent_cat_*`, `cat_mix_l1_vs_baseline`). A corrected dataset can be generated later. If that happens, account and merchant IDs stay the same, but **transaction IDs change**.

## Updates

| Change | What happens |
|---|---|
| New export, same schema (`s1`) | Same property names; loading again overwrites the values. Check `bb_version` / `bb_asof`. |
| New schema (e.g. `s2`, features added) | New property names (e.g. `bb_txn_vec_s2`) and new vector indexes, because the vector size changes. The old ones stay until you switch. |

## Feature reference

### `bb_profile_vec` — account (31)
| # | Feature | Description |
|---|---|---|
| 0 | `log_tx_per_active_day` | log1p(transactions per day with any activity) |
| 1 | `active_day_share` | days with activity / days from first transaction to as-of date |
| 2 | `weekend_share` | share of transactions on Saturday or Sunday |
| 3 | `hour_00_04` | share of transactions between 00:00 and 04:00 |
| 4 | `hour_04_08` | share of transactions between 04:00 and 08:00 |
| 5 | `hour_08_12` | share of transactions between 08:00 and 12:00 |
| 6 | `hour_12_16` | share of transactions between 12:00 and 16:00 |
| 7 | `hour_16_20` | share of transactions between 16:00 and 20:00 |
| 8 | `hour_20_24` | share of transactions between 20:00 and 24:00 |
| 9 | `cat_entertainment` | share of transactions in category entertainment |
| 10 | `cat_food_dining` | share of transactions in category food_dining |
| 11 | `cat_gas_transport` | share of transactions in category gas_transport |
| 12 | `cat_grocery_net` | share of transactions in category grocery_net |
| 13 | `cat_grocery_pos` | share of transactions in category grocery_pos |
| 14 | `cat_health_fitness` | share of transactions in category health_fitness |
| 15 | `cat_home` | share of transactions in category home |
| 16 | `cat_kids_pets` | share of transactions in category kids_pets |
| 17 | `cat_misc_net` | share of transactions in category misc_net |
| 18 | `cat_misc_pos` | share of transactions in category misc_pos |
| 19 | `cat_personal_care` | share of transactions in category personal_care |
| 20 | `cat_shopping_net` | share of transactions in category shopping_net |
| 21 | `cat_shopping_pos` | share of transactions in category shopping_pos |
| 22 | `cat_travel` | share of transactions in category travel |
| 23 | `online_share` | share of transactions in online (*_net) categories |
| 24 | `log_amt_median` | log1p(median amount) |
| 25 | `log_amt_p90` | log1p(90th percentile amount) |
| 26 | `amt_log_iqr` | log1p(p75 amount) - log1p(p25 amount) |
| 27 | `log_km_median` | log1p(median km from home to merchant) |
| 28 | `log_km_p90` | log1p(90th percentile km from home to merchant) |
| 29 | `log_distinct_merchants` | log1p(number of distinct merchants) |
| 30 | `log_history_days` | log1p(days from first transaction to as-of date) |

### `bb_merchant_vec` — merchant (31)
| # | Feature | Description |
|---|---|---|
| 0 | `is_entertainment` | merchant category is entertainment |
| 1 | `is_food_dining` | merchant category is food_dining |
| 2 | `is_gas_transport` | merchant category is gas_transport |
| 3 | `is_grocery_net` | merchant category is grocery_net |
| 4 | `is_grocery_pos` | merchant category is grocery_pos |
| 5 | `is_health_fitness` | merchant category is health_fitness |
| 6 | `is_home` | merchant category is home |
| 7 | `is_kids_pets` | merchant category is kids_pets |
| 8 | `is_misc_net` | merchant category is misc_net |
| 9 | `is_misc_pos` | merchant category is misc_pos |
| 10 | `is_personal_care` | merchant category is personal_care |
| 11 | `is_shopping_net` | merchant category is shopping_net |
| 12 | `is_shopping_pos` | merchant category is shopping_pos |
| 13 | `is_travel` | merchant category is travel |
| 14 | `is_online` | merchant category is online (*_net) |
| 15 | `log_cardholders` | log1p(distinct cards with a transaction here) |
| 16 | `log_tx` | log1p(transactions here) |
| 17 | `log_tx_per_cardholder` | log1p(transactions per distinct card) |
| 18 | `hour_00_04` | share of transactions here between 00:00 and 04:00 |
| 19 | `hour_04_08` | share of transactions here between 04:00 and 08:00 |
| 20 | `hour_08_12` | share of transactions here between 08:00 and 12:00 |
| 21 | `hour_12_16` | share of transactions here between 12:00 and 16:00 |
| 22 | `hour_16_20` | share of transactions here between 16:00 and 20:00 |
| 23 | `hour_20_24` | share of transactions here between 20:00 and 24:00 |
| 24 | `weekend_share` | share of transactions on Saturday or Sunday |
| 25 | `log_amt_median` | log1p(median amount) |
| 26 | `amt_log_iqr` | log1p(p75 amount) - log1p(p25 amount) |
| 27 | `log_km_median` | log1p(median km from the cardholder home) |
| 28 | `beyond_usual_distance_share` | share of transactions farther from home than the cardholder's own 95th-percentile distance |
| 29 | `active_day_share` | days with transactions / days from first transaction to as-of date |
| 30 | `log_recent_trend` | log1p(daily rate in the last 90 days / lifetime daily rate) |

### `bb_merchant_cpp_vec` — merchant, built from fraud labels (3)
| # | Feature | Description |
|---|---|---|
| 0 | `victim_visitor_share` | share of distinct cards with a regular purchase here that had a fraud transaction within the cpp window after it |
| 1 | `log_victim_visitors` | log1p(number of such cards) |
| 2 | `log_median_days_to_fraud` | log1p(median days from the visit here to the first later fraud) |

### `bb_txn_vec` — transaction (46)
Windows: the last 72 h (including this transaction) and a baseline from 180 to 7 days before it. Features that compare with the baseline are masked when the card has fewer than 10 baseline transactions.

| # | Feature | Description |
|---|---|---|
| 0 | `log_amt` | log1p(amount) |
| 1 | `amt_z_vs_baseline` | z-score of log amount vs the baseline window |
| 2 | `tod_sin` | time of day, sine |
| 3 | `tod_cos` | time of day, cosine |
| 4 | `is_online` | online (*_net) category |
| 5 | `category_new_vs_baseline` | category not seen in the baseline window |
| 6 | `hour_rarity` | 1 - baseline share of the same 4-hour band |
| 7 | `log_km_home` | log1p(km from home to merchant) |
| 8 | `log_km_baseline_centroid` | log1p(km from the centre of baseline merchant locations) |
| 9 | `log_n_1h` | log1p(transactions in the last hour, incl. this one) |
| 10 | `log_n_24h` | log1p(transactions in the last 24 h, incl. this one) |
| 11 | `log_n_72h` | log1p(transactions in the last 72 h, incl. this one) |
| 12 | `log_velocity_ratio_24h` | log1p(24 h count / baseline daily rate) |
| 13 | `log_min_gap_min_recent` | log1p(smallest gap in minutes between transactions in the last 72 h) |
| 14 | `log_median_gap_min_recent` | log1p(median gap in minutes between transactions in the last 72 h) |
| 15 | `log_spend_ratio_24h` | log1p(24 h spend / baseline daily spend) |
| 16 | `log_n_small_6h_before` | log1p(charges in the 6 h before this one below 10% of the card's baseline median amount) |
| 17 | `recent_cat_entertainment` | share of transactions in the last 72 h in category entertainment |
| 18 | `recent_cat_food_dining` | share of transactions in the last 72 h in category food_dining |
| 19 | `recent_cat_gas_transport` | share of transactions in the last 72 h in category gas_transport |
| 20 | `recent_cat_grocery_net` | share of transactions in the last 72 h in category grocery_net |
| 21 | `recent_cat_grocery_pos` | share of transactions in the last 72 h in category grocery_pos |
| 22 | `recent_cat_health_fitness` | share of transactions in the last 72 h in category health_fitness |
| 23 | `recent_cat_home` | share of transactions in the last 72 h in category home |
| 24 | `recent_cat_kids_pets` | share of transactions in the last 72 h in category kids_pets |
| 25 | `recent_cat_misc_net` | share of transactions in the last 72 h in category misc_net |
| 26 | `recent_cat_misc_pos` | share of transactions in the last 72 h in category misc_pos |
| 27 | `recent_cat_personal_care` | share of transactions in the last 72 h in category personal_care |
| 28 | `recent_cat_shopping_net` | share of transactions in the last 72 h in category shopping_net |
| 29 | `recent_cat_shopping_pos` | share of transactions in the last 72 h in category shopping_pos |
| 30 | `recent_cat_travel` | share of transactions in the last 72 h in category travel |
| 31 | `recent_online_share` | online share in the last 72 h |
| 32 | `log_km_median_recent` | log1p(median km from home, last 72 h) |
| 33 | `log_km_max_recent` | log1p(max km from home, last 72 h) |
| 34 | `log_km_spread_recent` | log1p(std of km from the centre of last-72 h merchant locations) |
| 35 | `beyond_usual_distance_share_recent` | share of last-72 h transactions farther from home than the card's baseline 95th-percentile distance |
| 36 | `log_speed_kmh_prev` | log1p(km/h implied by the distance from the previous transaction) |
| 37 | `cat_mix_l1_vs_baseline` | L1 distance between last-72 h and baseline category mix |
| 38 | `hour_mix_l1_vs_baseline` | L1 distance between last-72 h and baseline mix of 4-hour bands |
| 39 | `recent_share_new_categories` | share of last-72 h transactions in categories absent from the baseline |
| 40 | `log_ratio_amt_median_vs_baseline` | log1p(median amount last 72 h) - log1p(median amount baseline) |
| 41 | `online_share_delta` | online share last 72 h - baseline online share |
| 42 | `log_ratio_km_median_vs_baseline` | log1p(median km last 72 h) - log1p(median km baseline) |
| 43 | `log_hours_since_prev` | log1p(hours since the previous transaction) |
| 44 | `age_years` | cardholder age at the transaction |
| 45 | `log_city_pop` | log1p(home city population) |
