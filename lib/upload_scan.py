"""Parse and vectorise an auditor-uploaded CSV of transactions believed to show one behaviour —
for cards the system already knows, several different cards at once, or cards it's never seen.

Reuses the exact same feature code as everywhere else in this app (lib.sparkov_features /
lib.sparkov_reader): a known card's uploaded rows are merged with its real history before
computing vectors (same approach as lib.live_scan.new_transactions, for the same reason — accurate
baseline/recent-window features); an unknown card's rows are used as their own, self-contained
history. Matching never auto-flags — this only produces vectors + a review table; the flagging
step in the UI still requires a person to tick and confirm.
"""
from datetime import date, datetime

import numpy as np
import pandas as pd
import streamlit as st

from lib import sparkov_features as F
from lib import sparkov_reader as BBV
from lib.data import DATA_DIR, HAS_RAW_TRANSACTION_FILES, load_schema
from lib.live_scan import customer_lookup, raw_file_for_card

REQUIRED_COLUMNS = ['cc_num', 'trans_num', 'trans_date', 'trans_time', 'category', 'amt',
                    'merchant', 'merch_lat', 'merch_long']
# only needed for a cc_num the system doesn't already know
UNKNOWN_CARD_COLUMNS = ['home_lat', 'home_long']
OPTIONAL_COLUMNS = ['dob', 'city_pop']

CSV_FORMAT_HELP = """
**Required columns** (comma-separated CSV, one row per transaction):

| Column | Meaning |
|---|---|
| `cc_num` | Card number |
| `trans_num` | Unique transaction ID — any string; must be unique within the file |
| `trans_date` | `YYYY-MM-DD` |
| `trans_time` | `HH:MM:SS` |
| `category` | One of: entertainment, food_dining, gas_transport, grocery_net, grocery_pos, health_fitness, home, kids_pets, misc_net, misc_pos, personal_care, shopping_net, shopping_pos, travel |
| `amt` | Dollar amount |
| `merchant` | Merchant name — doesn't need to already exist in the system |
| `merch_lat`, `merch_long` | Merchant location — needed for every distance-based feature |

**Required only for a `cc_num` not already in this system's customer list:**

| Column | Meaning |
|---|---|
| `home_lat`, `home_long` | The cardholder's home location — needed for every distance feature. Rows for an unknown card missing these are rejected, rather than guessing. |

**Optional, for any card:**

| Column | Meaning |
|---|---|
| `dob` | `YYYY-MM-DD` — feeds one feature (age). If missing for an unknown card, a neutral placeholder is used instead and that one feature is a rough estimate, not a guess presented as fact. |
| `city_pop` | Feeds one feature (home city size). Same placeholder behaviour if missing for an unknown card. |

A known card's uploaded rows are merged with its real transaction history already in the system,
for accurate "compared with normal" features — upload just the new rows, not that history too.
"""

_PLACEHOLDER_DOB_DAY = date(1980, 1, 1).toordinal()  # used only if an unknown card gives no dob
_PLACEHOLDER_CITY_POP = 50_000                        # used only if an unknown card gives no city_pop


def example_csv():
    # 4111111111111111 is a fictional example card, not one already in the system, so — like any
    # unknown card — it needs home_lat/home_long; a known cc_num wouldn't need those two columns
    return (
        "cc_num,trans_num,trans_date,trans_time,category,amt,merchant,merch_lat,merch_long,home_lat,home_long\n"
        "4111111111111111,ext-001,2026-03-14,02:11:03,shopping_net,612.40,Acme Online,40.71,-74.00,40.73,-73.93\n"
        "4111111111111111,ext-002,2026-03-14,02:19:55,shopping_net,88.00,Acme Online,40.71,-74.00,40.73,-73.93\n"
    )


def parse_upload(file):
    """Returns (accepted, rejected) DataFrames; rejected has a 'reason' column. Validates up
    front (missing required columns) and per row (bad values, duplicate trans_num, an unknown
    card missing its home location)."""
    try:
        raw = pd.read_csv(file, dtype=str, keep_default_na=False)
    except Exception as e:
        return pd.DataFrame(), pd.DataFrame([{"row": "-", "cc_num": "-", "reason": f"Could not read the file: {e}"}])

    missing = [c for c in REQUIRED_COLUMNS if c not in raw.columns]
    if missing:
        return pd.DataFrame(), pd.DataFrame(
            [{"row": "-", "cc_num": "-", "reason": f"Missing required column(s): {', '.join(missing)}"}])

    known_cards = customer_lookup()
    seen_trans_nums, accepted_idx, rejected = set(), [], []
    for i, row in raw.iterrows():
        reasons = []
        cc = row["cc_num"].strip()
        tn = row["trans_num"].strip()
        if not tn:
            reasons.append("trans_num is blank")
        elif tn in seen_trans_nums:
            reasons.append("duplicate trans_num in this file")
        try:
            date.fromisoformat(row["trans_date"].strip())
        except Exception:
            reasons.append("bad trans_date (need YYYY-MM-DD)")
        try:
            datetime.strptime(row["trans_time"].strip(), "%H:%M:%S")
        except Exception:
            reasons.append("bad trans_time (need HH:MM:SS)")
        try:
            float(row["amt"])
        except Exception:
            reasons.append("amt is not a number")
        try:
            float(row["merch_lat"]), float(row["merch_long"])
        except Exception:
            reasons.append("merch_lat/merch_long not numbers")
        if cc not in known_cards:
            hl, hlo = row.get("home_lat", ""), row.get("home_long", "")
            try:
                float(hl); float(hlo)
            except Exception:
                reasons.append("unknown cc_num and no numeric home_lat/home_long given")
        if reasons:
            rejected.append({"row": i, "cc_num": cc, "reason": "; ".join(reasons)})
        else:
            seen_trans_nums.add(tn)
            accepted_idx.append(i)
    accepted = raw.loc[accepted_idx].reset_index(drop=True)
    return accepted, pd.DataFrame(rejected)


_EPOCH_ORDINAL = date(1970, 1, 1).toordinal()  # to turn a date.toordinal() day into a Unix epoch day


def _rows_to_arrays(rows):
    """One card's accepted upload rows -> the array format lib.sparkov_reader.read_file produces,
    minus 'card'/'merchant' (not needed by F.txn_vectors, and meaningless for a single card)."""
    n = len(rows)
    cat = np.array([F.CAT_INDEX.get(c, -1) for c in rows["category"]], dtype=np.int64)
    day = np.array([date.fromisoformat(d).toordinal() for d in rows["trans_date"]], dtype=np.int64)
    tod = np.array([int(t[:2]) * 3600 + int(t[3:5]) * 60 + int(t[6:8]) for t in rows["trans_time"]], dtype=np.int64)
    a = {
        "trans_num": rows["trans_num"].to_numpy(dtype=object),
        # ts must be a real Unix epoch second count, matching the real history's unix_time column —
        # day is a date.toordinal() value (days since year 1), so offset it to days since 1970 first
        "ts": np.array([(d - _EPOCH_ORDINAL) * 86400 + t for d, t in zip(day, tod)], dtype=np.int64),
        "day": day, "tod": tod,
        "cat": cat, "online": np.array([c.endswith("_net") for c in rows["category"]]),
        "amt": rows["amt"].astype(float).to_numpy(),
        "is_fraud": np.zeros(n, dtype=bool),
        "merch_lat": rows["merch_lat"].astype(float).to_numpy(),
        "merch_long": rows["merch_long"].astype(float).to_numpy(),
    }
    a["hour"] = a["tod"] // 3600
    a["band"] = a["hour"] // 4
    a["weekday"] = (a["day"] + 6) % 7
    order = np.argsort(a["ts"], kind="stable")
    return {k: v[order] for k, v in a.items()}, order


def _concat(base, extra, keys):
    merged = {k: np.concatenate([base[k], extra[k]]) for k in keys}
    order = np.argsort(merged["ts"], kind="stable")
    return {k: v[order] for k, v in merged.items()}, order


@st.cache_data
def vectors_for_upload(rows):
    """rows: the accepted DataFrame from parse_upload (st.cache_data hashes DataFrames natively —
    no serialization needed). Returns (ids_df, vectors, per_card_notes) — notes is
    {cc_num: "known, merged with N real transactions" | "unknown card, N rows, self-contained"}."""
    known_cards = customer_lookup()
    feats = load_schema()["vectors"]["transaction"]["features"]
    centers = np.array([x["center"] for x in feats])
    divisors = np.array([x["divisor"] for x in feats])

    all_ids, all_vecs, notes = [], [], {}
    for cc, card_rows in rows.groupby("cc_num"):
        u, u_order = _rows_to_arrays(card_rows)
        info = known_cards.get(cc)
        fname = raw_file_for_card(cc, known_cards) if info else None
        path = DATA_DIR / fname if fname else None

        if info and path and path.exists():
            parsed = BBV.read_file(str(path), "9999-12-31")
            a, card_ids, _mkeys = parsed if parsed else (None, np.array([]), [])
            hit = np.flatnonzero(card_ids == cc) if parsed else np.array([])
            if hit.size:
                k = int(hit[0])
                bounds = np.searchsorted(a["card"], np.arange(card_ids.size + 1))
                history = BBV.card_arrays(a, bounds[k], bounds[k + 1])
                shared_keys = [key for key in u if key in history]
                merged, m_order = _concat(history, u, shared_keys)
                anchors = np.flatnonzero(m_order >= len(history["ts"]))
                home_lat, home_long = info["lat"], info["long"]
                dob_day, city_pop = info["dob_day"], info["city_pop"]
                notes[cc] = f"known card, merged with {len(history['ts']):,} real transactions"
            else:
                merged, anchors = u, np.arange(len(u["ts"]))
                home_lat, home_long = info["lat"], info["long"]
                dob_day, city_pop = info["dob_day"], info["city_pop"]
                notes[cc] = f"known card, {len(u['ts'])} uploaded row(s), no prior transactions found"
        else:
            merged, anchors = u, np.arange(len(u["ts"]))
            if info:  # known card, but this deployment doesn't have its raw file
                home_lat, home_long = info["lat"], info["long"]
                dob_day, city_pop = info["dob_day"], info["city_pop"]
                notes[cc] = (f"known card, but its history isn't in this deployment — "
                            f"{len(u['ts'])} uploaded row(s), self-contained")
            else:
                first = card_rows.iloc[0]
                home_lat, home_long = float(first["home_lat"]), float(first["home_long"])
                dob_day = (date.fromisoformat(first["dob"]).toordinal() if first.get("dob")
                          else _PLACEHOLDER_DOB_DAY)
                city_pop = float(first["city_pop"]) if first.get("city_pop") else _PLACEHOLDER_CITY_POP
                notes[cc] = f"unknown card, {len(u['ts'])} uploaded row(s), self-contained"

        merged["km_home"] = F.haversine_km(home_lat, home_long, merged["merch_lat"], merged["merch_long"])
        raw_vecs, mask = F.txn_vectors(merged, anchors, dob_day, city_pop)
        scaled = np.clip((raw_vecs - centers) / divisors, -10, 10)
        scaled[mask] = 0.0

        all_ids.append(pd.DataFrame({
            "txn_id": merged["trans_num"][anchors], "account_id": cc,
            "trans_date": [date.fromordinal(int(d)).isoformat() for d in merged["day"][anchors]],
        }))
        all_vecs.append(scaled)

    ids = pd.concat(all_ids, ignore_index=True) if all_ids else pd.DataFrame(columns=["txn_id", "account_id", "trans_date"])
    vecs = np.vstack(all_vecs) if all_vecs else np.zeros((0, len(F.TXN_FEATURES)))
    return ids, vecs, notes
