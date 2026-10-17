"""On-demand vector computation for one card's transactions that fall OUTSIDE the frozen batch
export (e.g. anything after January 2025) — no full export rebuild needed.

Reuses the exact same feature code the batch export used (lib/sparkov_reader.py and
lib/sparkov_features.py — vendored copies of neo4j-behaviour-export's build_behaviour_vectors.py
and features.py, so this app has no dependency on anything outside itself), so these vectors mean
exactly the same thing as the ones in transaction_vectors/*.csv.gz — not a re-implementation that
could silently drift from it. Only the SCALING stats are reused as-is from the existing
schema.json (frozen at export time); a card whose behaviour has drifted a lot since then may score
a little differently than if the whole export were rebuilt fresh.

For a large new batch (e.g. a whole new month, for everyone) it is faster and more thorough to
re-run the original build_behaviour_vectors.py (in neo4j-behaviour-export/, if you have that
project) with --txn-from/--txn-to — this module is for a quick, single-card check without that.
"""
from datetime import date

import numpy as np
import pandas as pd
import streamlit as st

from lib import sparkov_reader as BBV
from lib import sparkov_features as F
from lib.data import DATA_DIR, load_schema

FAR_FUTURE = "9999-12-31"  # "no upper bound" for BBV.read_file's inclusive date filter


@st.cache_data
def customer_lookup():
    """cc_num -> {profile, row_index, lat, long, dob_day, city_pop} — everything needed to find a
    card's raw file (same block-of-1000 naming the generator and build_behaviour_vectors.py use)
    and to compute its transaction vectors."""
    lookup = {}
    with open(DATA_DIR / "customers.csv", "r") as f:
        header = f.readline().rstrip("\n").split("|")
        ix = {h: i for i, h in enumerate(header)}
        for i, line in enumerate(f):
            row = line.rstrip("\n").split("|")
            lookup[row[ix["cc_num"]]] = {
                "profile": row[ix["profile"]].replace(".json", ""), "row_index": i,
                "lat": float(row[ix["lat"]]), "long": float(row[ix["long"]]),
                "dob_day": date.fromisoformat(row[ix["dob"]]).toordinal(),
                "city_pop": float(row[ix["city_pop"]]),
            }
    return lookup


def raw_file_for_card(cc_num, lookup):
    if cc_num not in lookup:
        return None
    info = lookup[cc_num]
    n = len(lookup)
    zero_pad = len(str(n - 1))
    lo = (info["row_index"] // 1000) * 1000
    hi = min(n - 1, lo + 999)
    return f"{info['profile']}_{str(lo).zfill(zero_pad)}-{str(hi).zfill(zero_pad)}.csv"


@st.cache_data
def new_transactions(cc_num, min_date):
    """Scaled vectors for cc_num's transactions on or after min_date (YYYY-MM-DD), computed fresh
    from the raw data. Returns (ids_df, vectors, error) — ids_df empty (error None) if the card
    has none in range; ids_df None with error set to a human-readable reason otherwise (account
    not found at all, vs. found but its raw transaction file isn't included in this deployment —
    those are different problems and worth telling apart)."""
    empty = pd.DataFrame(columns=["txn_id", "account_id", "trans_date"]), np.zeros((0, len(F.TXN_FEATURES)))
    lookup = customer_lookup()
    if cc_num not in lookup:
        return None, None, "No account with that ID in customers.csv."
    info = lookup[cc_num]
    fname = raw_file_for_card(cc_num, lookup)
    path = DATA_DIR / fname
    if not path.exists():
        return None, None, (
            f"The account exists, but its raw transaction file ({fname}) isn't included in this "
            "deployment — only the small bundled dataset is, not the full ~8 GB raw data. See "
            "deploy/DEPLOY.md for how to add it.")

    parsed = BBV.read_file(str(path), FAR_FUTURE)
    if parsed is None:
        return *empty, None
    a, card_ids, _mkeys = parsed
    hit = np.flatnonzero(card_ids == cc_num)
    if hit.size == 0:
        return *empty, None
    k = int(hit[0])
    bounds = np.searchsorted(a["card"], np.arange(card_ids.size + 1))
    c = BBV.card_arrays(a, bounds[k], bounds[k + 1])
    c["km_home"] = F.haversine_km(info["lat"], info["long"], c["merch_lat"], c["merch_long"])

    cutoff = date.fromisoformat(min_date).toordinal()
    anchors = np.flatnonzero(c["day"] >= cutoff)
    if anchors.size == 0:
        return *empty, None

    raw_vecs, mask = F.txn_vectors(c, anchors, info["dob_day"], info["city_pop"])

    feats = load_schema()["vectors"]["transaction"]["features"]
    centers = np.array([x["center"] for x in feats])
    divisors = np.array([x["divisor"] for x in feats])
    scaled = np.clip((raw_vecs - centers) / divisors, -10, 10)
    scaled[mask] = 0.0

    ids = pd.DataFrame({
        "txn_id": c["trans_num"][anchors], "account_id": cc_num,
        "trans_date": [date.fromordinal(int(d)).isoformat() for d in c["day"][anchors]],
    })
    return ids, scaled, None
