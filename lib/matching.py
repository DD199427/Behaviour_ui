"""Compare a transaction's vector against known fraud types, a 'normal' baseline, and any custom
behaviour — the actual "does this look like something we know" mechanism.

This never creates a flag by itself. It only ranks and recommends; a human still has to look at
the result and confirm it on Investigate & Flag.

Scores are cosine similarity on the already-scaled vectors — a ranking signal, not a calibrated
probability. Validated once against this dataset's hidden ground truth (not available at run time):
the true fraud type is the #1 match 66% of the time and in the top 3 99.5% of the time; phishing_fake_site
and breached_online_store are often confused with each other at the single-transaction level, because
their immediate spending behaviour genuinely looks alike (what tells them apart — the delay from
compromise — isn't something one transaction's vector can know). Show a ranked list, not just #1.

The default MARGIN_THRESHOLD (0.5) was chosen from that same one-time validation: margin > 0.5 gave
56% precision at 85% recall on known fraud transactions; the very top of the ranking (top ~500 by
margin, out of ~490k transactions) was 100% precision. There is no live ground truth to recalibrate
this against as new data arrives — it's a starting point, not a self-tuning threshold.
"""
import json

import numpy as np
import streamlit as st

from lib.data import EXPORT_DIR

MARGIN_THRESHOLD = 0.5


@st.cache_data
def known_references():
    """{name: unit-normalised vector} for the 6 fraud types + 'normal', from the one-time batch build."""
    path = EXPORT_DIR / "fraud_type_prototypes.json"
    if not path.exists():
        return {}
    with open(path) as f:
        proto = json.load(f)["prototypes"]
    return {name: _unit(np.array(p["vector"])) for name, p in proto.items()}


def custom_references(flags, ids, matrix):
    """{behaviour name: unit-normalised vector}, built live from each behaviour's transaction-level
    flags — no batch step needed, since there are only ever a handful of these."""
    refs = {}
    if flags.empty:
        return refs
    txn_flags = flags[flags["entity_type"] == "transaction"]
    id_index = {tid: i for i, tid in enumerate(ids)}
    for label, rows in txn_flags.groupby("label"):
        vecs = [matrix[id_index[tid]] for tid in rows["entity_id"] if tid in id_index]
        if vecs:
            refs[label] = _unit(np.mean(vecs, axis=0))
    return refs


def _unit(v):
    return v / (np.linalg.norm(v) + 1e-12)


def rank_matches(vec, references):
    """references: {name: unit vector}. Returns [(name, score)], best first."""
    if not references:
        return []
    v = _unit(np.asarray(vec, dtype=float))
    scored = [(name, float(v @ ref)) for name, ref in references.items()]
    return sorted(scored, key=lambda r: -r[1])


def summarise(ranked):
    """One ranked list -> (headline, margin over 'normal'). headline is plain English, e.g.
    'Looks like normal spending' or 'Possible match: phishing_fake_site'."""
    if not ranked:
        return "No reference behaviours available yet.", None
    top_name, top_score = ranked[0]
    normal_score = next((s for n, s in ranked if n == "normal"), None)
    margin = (top_score - normal_score) if normal_score is not None else None
    if top_name == "normal":
        return "Looks like normal spending.", margin
    return f"Possible match: **{top_name}** (similarity {top_score:.2f})", margin


def batch_rank(matrix, references):
    """Vectorised version of rank_matches for every row of `matrix` at once.
    Returns (names, scores_matrix) where scores_matrix is n_rows x n_references, columns in `names` order."""
    names = list(references)
    if not names:
        return names, np.zeros((matrix.shape[0], 0))
    R = np.array([references[n] for n in names])
    # matrix is stored as float32 for memory; upcast before normalising so this matches
    # rank_matches' precision exactly rather than quietly rounding to ~7 significant figures
    V = matrix.astype(np.float64)
    Vn = V / (np.linalg.norm(V, axis=1, keepdims=True) + 1e-12)
    return names, Vn @ R.T
