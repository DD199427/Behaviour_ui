# Behaviour UI

A small Streamlit app to show the fraud behaviours already known and discovered in the data,
let a user flag cards / merchants / transactions with an existing or brand-new behaviour, and
export those flags as a Neo4j-ready relationship CSV for the graph team.

It is **read-only** against `Outputs/fraud_poc_v2/` and `neo4j-behaviour-export/`'s output — the
only thing it writes to is its own `store/` folder (and, when you export, two new files inside
the existing `neo4j_export/s1/` folder).

## Setup

```bash
cd "Sparkov"
.venv/bin/pip install -r behaviour-ui/requirements.txt
```

## Run

```bash
cd behaviour-ui
"../.venv/bin/streamlit" run app.py
```

Needs `Outputs/fraud_poc_v2/neo4j_export/s1/` to already exist — build it first with
`neo4j-behaviour-export/build_behaviour_vectors.py` and `build_behaviour_map.py`.

## Pages

| Page | What it does |
|---|---|
| **Behaviour Library** | The 6 known fraud types (from `fraud_events.csv`), the unsupervised groups found in the vectors (from `behaviour_map.csv`), and any custom behaviours your team has named |
| **Investigate & Flag** | Look up an account, merchant or transaction: what's unusual about it, its discovered group, its most similar neighbours, and a form to flag it with an existing label or a new one |
| **Review & Export** | Every flag made so far, and a button to push the ones not yet sent to Neo4j |

## Where flags live

`store/flags.csv` (one row per flag, append-only) and `store/labels.json` (one entry per custom
behaviour, with a `status` of `candidate` until it has at least 5 flags from at least 3 distinct
entities, then `active`). Both are plain files local to this app — back them up like any other
data you care about; they are gitignored, same as the rest of this repo's data.

## Exporting to Neo4j

"Export pending flags" on the Review & Export page writes, into the **same**
`neo4j_export/s1/` folder the graph team already has:

- `flagged_behaviours.csv` — one row per flag: `(:Account|Merchant|Transaction)-[:FLAGGED_AS]->(:BehaviourLabel)`
- `load_flagged_behaviours.cypher` — loads it; `MERGE`s everything, so re-running is safe

Same column shape and loading pattern as `behaviour_map.csv` / `load_behaviour_map.cypher` from
`neo4j-behaviour-export`, so send the whole `neo4j_export/s1/` folder (or just the two new files
if they've already loaded the rest).

Node labels and ID properties (`Account.account_id`, `Merchant.name`+`category`,
`Transaction.txn_id`) are set at the top of `lib/export.py` — keep them matching whatever the
graph team used when they loaded the vectors.

## Limits of this first version

- **Transaction lookup only covers whatever date range was exported** (currently January 2025).
  Account and merchant lookups cover the full history.
- **"What stands out" ranks features by the size of their already-scaled vector value.** For
  `robust`-scaled features this is a real deviation from the population; for shares and flags
  (`scaling: none`) it just shows the raw value. Good enough to spot the obvious outliers, not a
  substitute for the full root-cause scoring in the original plan.
- **No login, no multi-user locking.** Fine for one team working together; `store/flags.csv` is a
  single shared file.
