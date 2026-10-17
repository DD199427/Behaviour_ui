"""Behaviour UI — entry point. Run with: streamlit run app.py (from this folder).

Shows the behaviours already known (from fraud_poc_v2) and discovered (from the Neo4j vector
export), lets a user flag transactions / accounts / merchants with an existing or new behaviour,
and exports pending flags as a Neo4j-ready CSV + Cypher file for the graph team.
"""
import streamlit as st

from lib.data import (EXPORT_DIR, load_account_vectors, load_behaviour_map, load_fraud_events,
                       load_merchant_vectors)
from lib.export import all_pending_flags
from lib.store import load_flags, load_labels

st.set_page_config(page_title="Behaviour Bag", page_icon="\U0001f4ca", layout="wide")

st.title("Behaviour Bag")
st.caption(f"Reading vectors from `{EXPORT_DIR}`")

if not EXPORT_DIR.exists():
    st.error(f"Export folder not found: {EXPORT_DIR}\n\n"
             "Run `build_behaviour_vectors.py` and `build_behaviour_map.py` in "
             "neo4j-behaviour-export/ first.")
else:
    accounts = load_account_vectors()
    merchants = load_merchant_vectors()
    bmap = load_behaviour_map()
    events = load_fraud_events()
    flags = load_flags()
    labels = load_labels()

    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Accounts with vectors", f"{len(accounts):,}")
    c2.metric("Merchants with vectors", f"{len(merchants):,}")
    c3.metric("Known fraud events", f"{len(events):,}")
    n_groups = bmap.loc[bmap["rel_type"] == "IN_BEHAVIOUR_GROUP", "target_id"].nunique()
    c4.metric("Discovered groups", f"{n_groups:,}")
    c5.metric("Pending flags", f"{len(all_pending_flags()):,}",
              help="Flags not yet exported to Neo4j (some may still be awaiting confirmation — see Review & Export)")

    st.divider()
    st.subheader("Get started")
    st.markdown(
        "- **Behaviour Library** — browse the known fraud behaviours and the groups discovered in the data.\n"
        "- **Investigate & Flag** — look up a card, merchant or transaction and flag it.\n"
        "- **Triage Queue** — transactions automatically matched against known and custom behaviours, "
        "not yet reviewed.\n"
        "- **Scan a Behaviour** — scan transactions against one custom behaviour, bulk-confirm matches, "
        "push straight to Neo4j.\n"
        "- **Scan New Transactions** — check a card's activity beyond the current export, computed "
        "on the fly.\n"
        "- **Review & Export** — see pending flags and push them to Neo4j.\n\n"
        "Use the page list in the sidebar to switch between them."
    )

    if labels:
        st.subheader("Custom behaviours created so far")
        st.dataframe(
            [{"label": k, **v} for k, v in labels.items()],
            width="stretch", hide_index=True,
        )

with st.sidebar:
    st.caption("Data is cached for this session.")
    if st.button("Refresh data (re-read files)"):
        st.cache_data.clear()
        st.rerun()
