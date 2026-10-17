"""Read-only data loaders for the Behaviour UI. Everything here is cached and never writes to
Outputs/ or neo4j_export/ — the only place this app writes to is behaviour-ui/store/ (see store.py)."""
import gzip
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
import streamlit as st

BASE = Path(__file__).resolve().parent.parent.parent      # .../Sparkov (this developer's layout)
APP_DIR = Path(__file__).resolve().parent.parent           # .../behaviour-ui
_LOCAL_DEV_DATA = BASE / "Outputs" / "fraud_poc_v2"         # the full dataset, only present on this dev's Mac
_BUNDLED_DATA = APP_DIR / "data"                            # small dataset shipped in the repo/image

# Where the data folder is: BB_DATA_ROOT env var (e.g. a mounted GCS path) > the full local dev
# dataset if it happens to exist (this dev's Mac) > the small bundled copy bundled with the app
# (what anyone who just clones/deploys this repo gets). See deploy/DEPLOY.md.
if os.environ.get("BB_DATA_ROOT"):
    DATA_DIR = Path(os.environ["BB_DATA_ROOT"])
elif _LOCAL_DEV_DATA.exists():
    DATA_DIR = _LOCAL_DEV_DATA
else:
    DATA_DIR = _BUNDLED_DATA
EXPORT_DIR = DATA_DIR / "neo4j_export" / "s1"
# the bundled deployment doesn't include the 120 raw per-profile transaction files (~8 GB) — only
# live_scan.py (Scan New Transactions) needs those; everything else works fine without them
HAS_RAW_TRANSACTION_FILES = any(DATA_DIR.glob("*_[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9].csv"))


@st.cache_data
def load_schema():
    with open(EXPORT_DIR / "schema.json") as f:
        return json.load(f)


def feature_names(schema, vector_key):
    return [f["name"] for f in schema["vectors"][vector_key]["features"]]


@st.cache_data
def load_account_vectors():
    return pd.read_csv(EXPORT_DIR / "account_vectors.csv", dtype={"account_id": str})


@st.cache_data
def load_merchant_vectors():
    return pd.read_csv(EXPORT_DIR / "merchant_vectors.csv")


@st.cache_data
def load_behaviour_map():
    df = pd.read_csv(EXPORT_DIR / "behaviour_map.csv", dtype={"source_id": str, "target_id": str})
    df["properties"] = df["properties_json"].apply(json.loads)
    df["target_properties"] = df["target_properties_json"].apply(
        lambda s: json.loads(s) if isinstance(s, str) and s else {})
    return df


@st.cache_data
def load_fraud_events():
    df = pd.read_csv(DATA_DIR / "fraud_events.csv", sep="|", dtype={"cc_num": str})
    for col in ("compromise_date", "fraud_start", "fraud_end"):
        df[col] = pd.to_datetime(df[col])
    df["delay_days"] = (df["fraud_start"] - df["compromise_date"]).dt.days
    df["duration_days"] = (df["fraud_end"] - df["fraud_start"]).dt.days + 1
    return df


@st.cache_data
def load_compromised_merchants():
    return pd.read_csv(DATA_DIR / "compromised_merchants.csv", sep="|")


@st.cache_data
def load_transaction_vectors():
    """All exported transaction vectors (currently Jan 2025) as one id frame + a float32 matrix.
    Loaded once per session; used for on-the-fly nearest-neighbour lookups on the Investigate page."""
    rows, vecs = [], []
    for part in sorted((EXPORT_DIR / "transaction_vectors").glob("part-*.csv.gz")):
        with gzip.open(part, "rt", newline="") as f:
            df = pd.read_csv(f, dtype={"txn_id": str, "account_id": str})
        rows.append(df[["txn_id", "account_id", "trans_date", "bb_schema", "bb_version", "bb_asof"]])
        vecs.append(np.array([[float(x) for x in v.split(";")] for v in df["bb_txn_vec"]], dtype=np.float32))
    ids = pd.concat(rows, ignore_index=True)
    matrix = np.vstack(vecs)
    return ids, matrix


def vec_column_to_matrix(series):
    return np.array([[float(x) for x in v.split(";")] for v in series], dtype=np.float32)


def topk_cosine(matrix, row, k, exclude=None):
    """Indices and scores of the k rows of `matrix` most similar to `row` (cosine), excluding `exclude`."""
    norm = np.linalg.norm(matrix, axis=1) * np.linalg.norm(row) + 1e-12
    sims = (matrix @ row) / norm
    if exclude is not None:
        sims = sims.copy()
        sims[exclude] = -np.inf
    k = min(k, (sims > -np.inf).sum())
    order = np.argpartition(-sims, k - 1)[:k]
    order = order[np.argsort(-sims[order])]
    return order, sims[order]


def deviation_table(row_values, feature_defs, top=8):
    """For account/merchant f_* raw columns: rank features by |scaled value| and return a small table."""
    out = []
    for f, v in zip(feature_defs, row_values):
        if v is None or (isinstance(v, float) and np.isnan(v)):
            continue
        out.append({"feature": f["name"], "group": f["group"], "scaled_value": round(float(v), 3),
                    "description": f["description"]})
    out.sort(key=lambda r: -abs(r["scaled_value"]))
    return out[:top]
