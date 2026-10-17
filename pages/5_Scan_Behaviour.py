"""Scan a Behaviour — pick one custom behaviour, scan every transaction against just it, review
and bulk-confirm the matches, then push straight to Neo4j.

Matching still never auto-flags — you select which matches are real before anything is recorded.
Export still respects the same candidate/active gating as Review & Export (reuses build_export()
directly); this page is a shortcut through the same rules, not a bypass of them.
"""
import pandas as pd
import streamlit as st

from lib.data import load_transaction_vectors
from lib.export import build_export
from lib.matching import MARGIN_THRESHOLD, batch_rank, custom_references, known_references
from lib.store import append_flag, label_progress, label_status, load_flags, load_labels

st.set_page_config(page_title="Scan a Behaviour", layout="wide")
st.title("Scan a Behaviour")

labels = load_labels()
if not labels:
    st.info("No custom behaviours yet. Create one on **Behaviour Library** or **Investigate & Flag** first.")
else:
    behaviour = st.selectbox("Custom behaviour", sorted(labels))
    meta = labels[behaviour]
    st.caption(f"Status: **{meta['status']}** — {meta['description'] or '(no description)'}")

    with st.spinner("Loading January 2025 transaction vectors (first time only)…"):
        ids, matrix = load_transaction_vectors()
    flags = load_flags()
    flagged_ids = (set(flags.loc[flags["entity_type"] == "transaction", "entity_id"])
                  if not flags.empty else set())

    refs = custom_references(flags, ids["txn_id"].values, matrix)
    if behaviour not in refs:
        st.warning(
            f"**{behaviour}** has no confirmed transaction examples yet, so there's nothing to scan "
            "with — a behaviour only gets a signature once at least one transaction has been flagged "
            "under it. Go to **Investigate & Flag**, look up one transaction you believe fits it, flag "
            "it there, then come back here to find more like it.")
    else:
        # ---- scan: this one behaviour vs. a 'normal spending' baseline ----
        scan_refs = {behaviour: refs[behaviour]}
        normal_ref = known_references().get("normal")
        if normal_ref is not None:
            scan_refs["normal"] = normal_ref
        names, scores = batch_rank(matrix, scan_refs)
        own_col = names.index(behaviour)
        margin = (scores[:, own_col] - scores[:, names.index("normal")]
                 if "normal" in names else scores[:, own_col])

        queue = pd.DataFrame({"txn_id": ids["txn_id"].values, "account_id": ids["account_id"].values,
                              "trans_date": ids["trans_date"].values, "score": scores[:, own_col],
                              "margin": margin})
        queue = queue[~queue["txn_id"].isin(flagged_ids)]

        threshold = st.slider(f"Minimum margin over 'normal spending' to show as a possible {behaviour}",
                              0.0, 1.5, MARGIN_THRESHOLD, 0.05)
        DISPLAY_CAP = 200
        above = queue[queue["margin"] > threshold]
        shown = above.sort_values("margin", ascending=False).head(DISPLAY_CAP).reset_index(drop=True)
        st.caption(f"{len(above):,} unflagged transaction(s) above the threshold "
                   f"({len(flagged_ids):,} already flagged, excluded). Showing the top {len(shown):,}.")

        if shown.empty:
            st.info("Nothing above this threshold right now.")
        else:
            shown.insert(0, "Select", False)
            edited = st.data_editor(
                shown, hide_index=True, width="stretch", key=f"scan_editor_{behaviour}",
                column_config={"Select": st.column_config.CheckboxColumn(
                    help="Tick the ones you confirm are real")},
                disabled=["txn_id", "account_id", "trans_date", "score", "margin"])
            selected = edited[edited["Select"]]

            st.subheader(f"Flag {len(selected)} selected as {behaviour}")
            user = st.text_input("Your name", st.session_state.get("user", "analyst"), key="scan_user")
            note = st.text_input("Note (optional)", f"bulk-confirmed via Scan a Behaviour ({behaviour})",
                                 key="scan_note")
            if st.button(f"Flag {len(selected)} transaction(s)", type="primary", disabled=selected.empty):
                for _, r in selected.iterrows():
                    append_flag("transaction", r["txn_id"], "", behaviour, note, float(r["score"]), user)
                st.session_state["user"] = user
                st.success(f"Flagged {len(selected)} transaction(s) as {behaviour}.")
                st.rerun()

        # ---- push this behaviour's pending flags to Neo4j, same rules as Review & Export ----
        st.divider()
        st.subheader(f"Push {behaviour} to Neo4j")
        own_pending = (flags[(~flags["exported"]) & (flags["label"] == behaviour)]
                      if not flags.empty else flags)
        status = label_status(behaviour)
        st.write(f"**{len(own_pending)}** flag(s) for **{behaviour}** not yet exported. Status: **{status}**.")

        force = True
        if status == "candidate" and not own_pending.empty:
            prog = label_progress(behaviour)
            st.caption(f"Still unconfirmed — {prog['flags']}/{prog['flags_needed']} flags, "
                       f"{prog['distinct_entities']}/{prog['entities_needed']} distinct entities so far. "
                       "Held back from export by default, same rule as Review & Export.")
            force = st.checkbox("Export anyway, even though it's still a candidate")

        if st.button(f"Push {behaviour} to Neo4j", type="primary", disabled=own_pending.empty or not force):
            result = build_export(own_pending)
            st.success(f"Wrote {result['rows']} rows (batch `{result['batch']}`).")
            st.code(f"{result['csv']}\n{result['cypher']}")
            st.caption("Send these files to the graph team — load_flagged_behaviours.cypher is safe to re-run.")
            st.rerun()
