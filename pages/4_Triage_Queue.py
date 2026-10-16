"""Triage Queue — transactions that automatically resemble a known fraud type or a custom
behaviour more than they resemble normal spending, and haven't been flagged yet. This only ever
recommends; nothing here creates a flag by itself — open one and decide on Investigate & Flag."""
import pandas as pd
import streamlit as st

from lib.data import load_transaction_vectors
from lib.matching import MARGIN_THRESHOLD, batch_rank, custom_references, known_references
from lib.store import load_flags

st.set_page_config(page_title="Triage Queue", layout="wide")
st.title("Triage Queue")
st.caption("Automatically surfaced, not confirmed. Every row is a recommendation — open it on "
           "Investigate & Flag and decide for yourself before it becomes a real flag.")

with st.spinner("Loading January 2025 transaction vectors (first time only)…"):
    ids, matrix = load_transaction_vectors()
flags = load_flags()
flagged_ids = (set(flags.loc[flags["entity_type"] == "transaction", "entity_id"])
               if not flags.empty else set())

refs = {**known_references(), **custom_references(flags, ids["txn_id"].values, matrix)}
if "normal" not in refs:
    st.error("No reference behaviours found. Run `build_fraud_prototypes.py` in "
             "neo4j-behaviour-export/ first.")
    st.stop()
non_normal = [n for n in refs if n != "normal"]
if not non_normal:
    st.info("No known fraud types or custom behaviours to compare against yet.")
    st.stop()

names, scores = batch_rank(matrix, refs)
normal_col = names.index("normal")
non_normal_cols = [j for j in range(len(names)) if j != normal_col]
best_j = scores[:, non_normal_cols].argmax(axis=1)
best_name = [names[non_normal_cols[j]] for j in best_j]
best_score = scores[range(len(scores)), [non_normal_cols[j] for j in best_j]]
margin = best_score - scores[:, normal_col]

queue = pd.DataFrame({
    "txn_id": ids["txn_id"].values, "account_id": ids["account_id"].values,
    "trans_date": ids["trans_date"].values, "match": best_name,
    "score": best_score, "margin": margin,
})
queue = queue[~queue["txn_id"].isin(flagged_ids)]

threshold = st.slider(
    "Minimum margin over 'normal spending' to show", 0.0, 1.5, MARGIN_THRESHOLD, 0.05,
    help="How much more a transaction resembles its best match than it resembles normal spending. "
         "Validated once against this dataset's hidden ground truth: 0.5 gave 56% precision at 85% "
         "recall; the very top of the ranking by margin was close to 100% precision. There's no live "
         "ground truth to re-tune this as new data arrives — treat it as a starting point, not a "
         "self-calibrating score.")
shown = queue[queue["margin"] > threshold].sort_values("margin", ascending=False)
DISPLAY_CAP = 200
st.caption(f"{len(shown):,} unflagged transaction(s) above the threshold (of {len(queue):,} unflagged "
           f"total; {len(ids) - len(queue):,} already flagged and excluded). "
           f"Showing the top {min(len(shown), DISPLAY_CAP):,} by margin.")

if shown.empty:
    st.info("Nothing above this threshold right now.")
else:
    display = shown.head(DISPLAY_CAP).reset_index(drop=True)
    st.dataframe(display.rename(columns={"txn_id": "Transaction", "account_id": "Account",
                                         "trans_date": "Date", "match": "Closest match",
                                         "score": "Similarity", "margin": "Margin over normal"}),
                 width="stretch", hide_index=True)

    st.subheader("Open one on Investigate & Flag")
    options = [f"{r.txn_id} — {r.match} (score {r.score:.2f}, margin {r.margin:.2f})"
               for r in display.itertuples()]
    choice = st.selectbox("Pick a transaction from the table above", options, index=None)
    if choice and st.button("Open in Investigate & Flag", type="primary"):
        st.session_state["prefill_txn_id"] = choice.split(" — ", 1)[0]
        st.switch_page("pages/2_Investigate_and_Flag.py")
