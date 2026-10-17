"""Scan New Transactions — pull one card's transactions from beyond the frozen batch export
(currently January 2025) straight from the raw data, compute their vectors on the fly using the
exact same feature code as the batch export, and scan them against everything already known.

For a large new batch (e.g. a whole new month, for every card) it's faster and more thorough to
re-run build_behaviour_vectors.py in neo4j-behaviour-export/ instead — this page is for a quick,
single-card check without waiting for that.
"""
import pandas as pd
import streamlit as st

import lib.live_scan as LS
from lib.data import HAS_RAW_TRANSACTION_FILES
from lib.matching import MARGIN_THRESHOLD, batch_rank, custom_references, known_references
from lib.store import append_flag, load_flags, load_labels

st.set_page_config(page_title="Scan New Transactions", layout="wide")
st.title("Scan New Transactions")
st.caption(
    "Computed fresh from the raw data, not the frozen export — these vectors use the same feature "
    "code as the batch build, so they're directly comparable to everything else in this app.")
if not HAS_RAW_TRANSACTION_FILES:
    st.warning(
        "The full raw dataset (~8 GB) isn't included in this deployment — only the small bundled "
        "dataset is. This page will say so per account looked up; see deploy/DEPLOY.md for how to "
        "add the full dataset if you want this page to work.")

c1, c2 = st.columns([2, 1])
cc_num = c1.text_input("Account ID (cc_num)")
min_date = c2.text_input("On or after", value="2025-02-01",
                         help="The current export covers through January 2025.")

if cc_num:
    with st.spinner("Reading this card's history and computing vectors…"):
        ids, vecs, error = LS.new_transactions(cc_num, min_date)

    if error:
        st.error(error)
    elif ids.empty:
        st.info(f"No transactions found for this card on or after {min_date}.")
    else:
        flags = load_flags()
        flagged_ids = (set(flags.loc[flags["entity_type"] == "transaction", "entity_id"])
                      if not flags.empty else set())
        new_ids = ids[~ids["txn_id"].isin(flagged_ids)].reset_index(drop=True)
        new_vecs = vecs[~ids["txn_id"].isin(flagged_ids).values]
        st.caption(f"{len(ids)} transaction(s) found; {len(new_ids)} not already flagged.")

        if new_ids.empty:
            st.info("All of them are already flagged — see Review & Export.")
        else:
            refs = {**known_references(), **custom_references(flags, ids["txn_id"].values, vecs)}
            names, scores = batch_rank(new_vecs, refs)
            if "normal" in names:
                normal_col = names.index("normal")
                non_normal_cols = [j for j in range(len(names)) if j != normal_col]
            else:
                normal_col, non_normal_cols = None, list(range(len(names)))

            if not non_normal_cols:
                st.warning("No reference behaviours to compare against yet.")
            else:
                best_j = scores[:, non_normal_cols].argmax(axis=1)
                best_name = [names[non_normal_cols[j]] for j in best_j]
                best_score = scores[range(len(scores)), [non_normal_cols[j] for j in best_j]]
                margin = best_score - (scores[:, normal_col] if normal_col is not None else 0.0)

                table = pd.DataFrame({
                    "txn_id": new_ids["txn_id"], "trans_date": new_ids["trans_date"],
                    "match": best_name, "score": best_score, "margin": margin,
                }).sort_values("margin", ascending=False).reset_index(drop=True)
                table.insert(0, "Select", False)

                st.dataframe(table.drop(columns="Select").rename(columns={
                    "txn_id": "Transaction", "trans_date": "Date", "match": "Closest match",
                    "score": "Similarity", "margin": "Margin over normal"}),
                    width="stretch", hide_index=True)

                edited = st.data_editor(
                    table, hide_index=True, width="stretch", key=f"newtxn_editor_{cc_num}_{min_date}",
                    column_config={"Select": st.column_config.CheckboxColumn(
                        help="Tick the ones you want to flag")},
                    disabled=["txn_id", "trans_date", "match", "score", "margin"])
                selected = edited[edited["Select"]]

                st.subheader(f"Flag {len(selected)} selected")
                labels = load_labels()
                label_choices = sorted(set(best_name)) + sorted(k for k in labels if k not in best_name)
                flag_as = st.selectbox("As", label_choices or ["(no reference behaviours yet)"])
                user = st.text_input("Your name", st.session_state.get("user", "analyst"), key="newtxn_user")
                note = st.text_input("Note (optional)", "confirmed via Scan New Transactions", key="newtxn_note")
                if st.button(f"Flag {len(selected)} transaction(s) as {flag_as}", type="primary",
                            disabled=selected.empty):
                    for _, r in selected.iterrows():
                        append_flag("transaction", r["txn_id"], "", flag_as, note, float(r["score"]), user)
                    st.session_state["user"] = user
                    st.success(f"Flagged {len(selected)} transaction(s) as {flag_as}. "
                               "Go to Review & Export (or Scan a Behaviour) to push to Neo4j.")
                    st.caption("Note: these transactions aren't in the frozen vector export, so the "
                               "flag itself is recorded now, but it won't attach to anything in Neo4j "
                               "until a future export run includes this date range.")
                    st.rerun()
