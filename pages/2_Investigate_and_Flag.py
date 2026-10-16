"""Investigate & Flag — look up a card, merchant or transaction, see what stands out about it
and what it behaves like, then flag it with an existing or brand-new behaviour."""
import numpy as np
import pandas as pd
import streamlit as st

from lib.data import (deviation_table, feature_names, load_account_vectors, load_behaviour_map,
                       load_merchant_vectors, load_schema, load_transaction_vectors, topk_cosine)
from lib.knowledge import FRAUD_TYPE_NOTES
from lib.matching import custom_references, known_references, rank_matches, summarise
from lib.store import add_label, append_flag, load_flags, load_labels

st.set_page_config(page_title="Investigate & Flag", layout="wide")
st.title("Investigate & Flag")

schema = load_schema()
bmap = load_behaviour_map()
entity_type = st.radio("Look up a", ["Account", "Merchant", "Transaction"], horizontal=True)


def label_options():
    # known fraud types + every custom behaviour (candidate or active) — not the discovered groups
    # themselves; propose one of those as a real, named behaviour from the Behaviour Library instead
    labels = load_labels()
    known = sorted(FRAUD_TYPE_NOTES)
    custom = sorted(k for k in labels if k not in FRAUD_TYPE_NOTES)
    return known + custom


def flag_form(entity_type, entity_id, entity_category=""):
    st.subheader("Flag this")
    options = label_options() + ["+ New behaviour…"]
    choice = st.selectbox("Behaviour", options, key=f"label_{entity_type}_{entity_id}_{entity_category}")
    is_new, new_desc = False, ""
    if choice == "+ New behaviour…":
        is_new = True
        choice = st.text_input("New behaviour name", key=f"newname_{entity_type}_{entity_id}")
        new_desc = st.text_area("What does it look like?", key=f"newdesc_{entity_type}_{entity_id}")
    col1, col2, col3 = st.columns(3)
    confidence = col1.slider("Confidence", 0.0, 1.0, 0.8, key=f"conf_{entity_type}_{entity_id}")
    user = col2.text_input("Your name", st.session_state.get("user", "analyst"), key=f"user_{entity_type}_{entity_id}")
    note = col3.text_input("Note (optional)", key=f"note_{entity_type}_{entity_id}")
    if st.button("Submit flag", key=f"submit_{entity_type}_{entity_id}_{entity_category}", type="primary"):
        if not choice:
            st.warning("Pick or name a behaviour first.")
            return
        st.session_state["user"] = user
        append_flag(entity_type.lower(), entity_id, entity_category, choice, note, confidence, user,
                    is_new_label=is_new, new_label_description=new_desc)
        st.success(f"Flagged {entity_type.lower()} `{entity_id}` as **{choice}**. "
                   "See it on the Review & Export page.")


def show_group_and_neighbours(label, entity_id, entity_category=""):
    mask = (bmap["source_label"] == label) & (bmap["source_id"] == entity_id)
    if entity_category:
        mask &= bmap["source_category"] == entity_category
    own = bmap[mask]
    group = own[own["rel_type"] == "IN_BEHAVIOUR_GROUP"]
    neigh = own[own["rel_type"] == "BEHAVES_LIKE"].sort_values("rank")
    c1, c2 = st.columns(2)
    with c1:
        st.markdown("**Discovered group**")
        if group.empty:
            st.caption("Not in the current export.")
        else:
            g = group.iloc[0]
            st.write(f"`{g['target_id']}` — {g['target_properties'].get('summary', '')}")
    with c2:
        st.markdown("**Most similar (behaves like)**")
        if neigh.empty:
            st.caption("Not in the current export.")
        else:
            st.dataframe(neigh[["target_id", "target_category", "score"]].rename(
                columns={"target_id": "id", "score": "similarity"}), width="stretch", hide_index=True)


def show_deviation(vec, vector_key, caption):
    feats = schema["vectors"][vector_key]["features"]
    rows = deviation_table(vec, feats)
    st.markdown("**What stands out**")
    st.caption(caption)
    st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)


if entity_type == "Account":
    accounts = load_account_vectors()
    account_id = st.text_input("Account ID (cc_num)")
    if account_id:
        row = accounts[accounts["account_id"] == account_id]
        if row.empty:
            st.error("No account with that ID in the current export.")
        else:
            r = row.iloc[0]
            st.caption(f"{int(r['n_tx']):,} transactions on record")
            vec = [float(x) for x in r["bb_profile_vec"].split(";")]
            show_deviation(vec, "account", "Ranked by how extreme the (scaled) feature value is. "
                           "'robust' features are deviations from all accounts; shares/flags are shown as-is.")
            show_group_and_neighbours("Account", account_id)
            flag_form("Account", account_id)

elif entity_type == "Merchant":
    merchants = load_merchant_vectors()
    # a handful of names are reused across categories, so list both together and split them back out
    options = sorted(merchants["merchant_name"] + " — " + merchants["category"])
    choice = st.selectbox("Merchant", options, index=None, placeholder="Search by name…")
    if choice:
        name, category = choice.rsplit(" — ", 1)
        row = merchants[(merchants["merchant_name"] == name) & (merchants["category"] == category)]
        if row.empty:
            st.error("No merchant with that name and category in the current export.")
        else:
            r = row.iloc[0]
            st.caption(f"{int(r['n_tx']):,} transactions, {int(r['n_cardholders']):,} distinct cardholders")
            vec = [float(x) for x in r["bb_merchant_vec"].split(";")]
            show_deviation(vec, "merchant", "Ranked the same way as for accounts, across all merchants.")
            cpp = [float(x) for x in r["bb_merchant_cpp_vec"].split(";")]
            cpp_names = feature_names(schema, "merchant_cpp")
            st.warning("**Fraud-exposure signal** (built from fraud labels — informative, not a feature "
                       "to train a model on without a time-ordered split): " +
                       ", ".join(f"{n} = {v:.2f}" for n, v in zip(cpp_names, cpp)))
            show_group_and_neighbours("Merchant", name, category)
            flag_form("Merchant", name, category)

else:
    with st.spinner("Loading January 2025 transaction vectors (first time only)…"):
        ids, matrix = load_transaction_vectors()
    st.caption(f"{len(ids):,} transactions indexed (range currently exported: January 2025 only)")
    # a one-shot pre-fill from the Triage Queue's "look up" button — read once, then forget it,
    # so it doesn't keep overriding whatever the user types next
    txn_id = st.text_input("Transaction ID", value=st.session_state.pop("prefill_txn_id", ""))
    if txn_id:
        hit = np.flatnonzero(ids["txn_id"].values == txn_id)
        if hit.size == 0:
            st.error("Not found. Only transactions in the exported date range are indexed here.")
        else:
            i = int(hit[0])
            row = ids.iloc[i]
            st.caption(f"Account `{row['account_id']}`, {row['trans_date']}")

            st.markdown("**Closest matching behaviour**")
            st.caption("Automatic — a similarity score against known fraud types, a 'normal spending' "
                       "baseline, and any custom behaviour with confirmed transaction examples. This "
                       "only recommends; it never creates a flag by itself. Known types that look alike "
                       "at a single transaction (e.g. phishing vs. a breached store) can rank close "
                       "together — read the top few, not just the first.")
            flags_now = load_flags()
            refs = {**known_references(), **custom_references(flags_now, ids["txn_id"].values, matrix)}
            ranked = rank_matches(matrix[i], refs)
            headline, margin = summarise(ranked)
            st.write(headline)
            if ranked:
                st.dataframe(pd.DataFrame(ranked[:5], columns=["Behaviour", "Similarity"]),
                             width="stretch", hide_index=True)

            show_deviation(matrix[i], "transaction",
                           "Ranked by how extreme the (scaled) feature value is — a quick, approximate "
                           "read; the vector already compares this transaction with the card's own history.")
            st.markdown("**Most similar other transactions**")
            order, sims = topk_cosine(matrix, matrix[i], 10, exclude=i)
            neigh = ids.iloc[order].copy()
            neigh["similarity"] = sims
            st.dataframe(neigh[["txn_id", "account_id", "trans_date", "similarity"]],
                         width="stretch", hide_index=True)
            flag_form("Transaction", txn_id)
