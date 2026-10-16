"""Review & Export — see every flag made so far, and push the confirmed ones to Neo4j as a
relationship CSV + Cypher file, in the same shape the graph team already knows how to load.

Only flags for a 'known' (ground-truth) or 'active' (corroborated) behaviour export by default.
Flags for a 'candidate' behaviour are held back until it has enough corroborating flags, unless
you explicitly choose to include them."""
import streamlit as st

from lib.export import all_pending_flags, build_export, pending_flags
from lib.store import label_progress, label_status, load_flags

st.set_page_config(page_title="Review & Export", layout="wide")
st.title("Review & Export")

flags = load_flags()
all_pending = all_pending_flags()
ready = pending_flags()
held_back = (all_pending[all_pending["label"].map(lambda l: label_status(l) == "candidate")]
             if not all_pending.empty else all_pending)

c1, c2, c3, c4 = st.columns(4)
c1.metric("Total flags", f"{len(flags):,}")
c2.metric("Ready to export", f"{len(ready):,}")
c3.metric("Awaiting confirmation", f"{len(held_back):,}")
c4.metric("Distinct behaviours flagged", f"{flags['label'].nunique() if not flags.empty else 0:,}")

st.subheader("Ready to export")
st.caption("Known fraud types, and custom behaviours that have been corroborated (active).")
if ready.empty:
    st.info("Nothing ready yet.")
else:
    st.dataframe(ready[["ts", "entity_type", "entity_id", "entity_category", "label", "confidence",
                        "note", "user"]], width="stretch", hide_index=True)

include_candidates = False
if not held_back.empty:
    st.subheader("Awaiting confirmation")
    st.caption("These behaviours are still candidates — not yet corroborated by enough flags. "
               "Held back from export by default.")
    for label in sorted(held_back["label"].unique()):
        prog = label_progress(label)
        st.write(f"**{label}** — {prog['flags']}/{prog['flags_needed']} flags, "
                 f"{prog['distinct_entities']}/{prog['entities_needed']} distinct entities so far")
        rows = held_back[held_back["label"] == label]
        st.dataframe(rows[["ts", "entity_type", "entity_id", "entity_category", "confidence", "note", "user"]],
                     width="stretch", hide_index=True)
    include_candidates = st.checkbox("Also include unconfirmed (candidate) behaviours in the export")

to_export = all_pending if include_candidates else ready
st.divider()
if to_export.empty:
    st.info("Nothing to export right now.")
else:
    if st.button(f"Export {len(to_export)} flag(s) to Neo4j", type="primary"):
        result = build_export(to_export)
        st.success(f"Wrote {result['rows']} rows (batch `{result['batch']}`).")
        st.code(f"{result['csv']}\n{result['cypher']}")
        st.caption("Send these two files to the graph team (or drop the whole "
                   "neo4j_export/s1/ folder) — load_flagged_behaviours.cypher is safe to re-run.")
        st.rerun()

with st.expander("All flags (including already exported)"):
    st.dataframe(flags, width="stretch", hide_index=True)
