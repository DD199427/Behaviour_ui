"""Scan a Behaviour — pick one custom behaviour, scan every transaction against just it (plus
anything an auditor uploads), review and bulk-confirm the matches, then push straight to Neo4j.

Matching still never auto-flags — you select which matches are real before anything is recorded.
Export still respects the same candidate/active gating as Review & Export (reuses build_export()
directly); this page is a shortcut through the same rules, not a bypass of them.
"""
import pandas as pd
import streamlit as st

from lib import upload_scan
from lib.data import load_transaction_vectors
from lib.export import build_export
from lib.matching import MARGIN_THRESHOLD, batch_rank, custom_references, known_references
from lib.store import append_flag, label_progress, label_status, load_flags, load_labels

st.set_page_config(page_title="Scan a Behaviour", layout="wide")
st.title("Scan a Behaviour")


def review_and_flag(df, behaviour, key_suffix, flag_note_default):
    """The shared tick-to-select review table + 'Flag N' button, used for both the regular scan
    and the uploaded-data scan below. df needs txn_id/account_id/trans_date, and optionally
    score/margin (omitted when the behaviour has no signature to score against yet)."""
    if df.empty:
        st.info("Nothing to review here.")
        return
    display = df.reset_index(drop=True).copy()
    display.insert(0, "Select", False)
    disabled = [c for c in display.columns if c != "Select"]
    edited = st.data_editor(
        display, hide_index=True, width="stretch", key=f"editor_{key_suffix}",
        column_config={"Select": st.column_config.CheckboxColumn(help="Tick the ones you confirm are real")},
        disabled=disabled)
    selected = edited[edited["Select"]]

    st.write(f"**{len(selected)}** selected")
    user = st.text_input("Your name", st.session_state.get("user", "analyst"), key=f"user_{key_suffix}")
    note = st.text_input("Note (optional)", flag_note_default, key=f"note_{key_suffix}")
    if st.button(f"Flag {len(selected)} transaction(s) as {behaviour}", type="primary",
                key=f"flagbtn_{key_suffix}", disabled=selected.empty):
        for _, r in selected.iterrows():
            score = float(r["score"]) if "score" in r and pd.notna(r["score"]) else 0.5
            append_flag("transaction", r["txn_id"], "", behaviour, note, score, user)
        st.session_state["user"] = user
        st.success(f"Flagged {len(selected)} transaction(s) as {behaviour}.")
        st.rerun()


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
    normal_ref = known_references().get("normal")
    has_signature = behaviour in refs

    # ================= Upload additional data for this behaviour =================
    st.divider()
    st.subheader("Upload additional data")
    st.caption(
        "If an auditor has transactions they believe show this behaviour — for one card or "
        "several — upload them here. A card already in this system is merged with its real "
        "history for accurate scoring; an unknown card's rows are used on their own.")
    with st.expander("Required CSV format"):
        st.markdown(upload_scan.CSV_FORMAT_HELP)
        st.download_button("Download an example CSV", upload_scan.example_csv(),
                           file_name="example_transactions.csv", mime="text/csv")

    uploaded = st.file_uploader(f"Transactions believed to show {behaviour}", type="csv", key="uploader")
    if uploaded is not None:
        accepted, rejected = upload_scan.parse_upload(uploaded)
        if not rejected.empty:
            st.warning(f"{len(rejected)} row(s) rejected — these were not scanned:")
            st.dataframe(rejected, hide_index=True, width="stretch")
        if accepted.empty:
            st.info("No valid rows to scan.")
        else:
            with st.spinner("Computing vectors for the uploaded transactions…"):
                up_ids, up_vecs, up_notes = upload_scan.vectors_for_upload(accepted)
            for cc, note_text in up_notes.items():
                st.caption(f"`{cc}`: {note_text}")

            up_table = pd.DataFrame({"txn_id": up_ids["txn_id"], "account_id": up_ids["account_id"],
                                     "trans_date": up_ids["trans_date"]})
            if has_signature:
                up_scan_refs = {behaviour: refs[behaviour]}
                if normal_ref is not None:
                    up_scan_refs["normal"] = normal_ref
                up_names, up_scores = batch_rank(up_vecs, up_scan_refs)
                own_j = up_names.index(behaviour)
                up_table["score"] = up_scores[:, own_j]
                if "normal" in up_names:
                    up_table["margin"] = up_scores[:, own_j] - up_scores[:, up_names.index("normal")]
                up_table = up_table.sort_values("score", ascending=False)
            else:
                st.caption(f"**{behaviour}** has no existing signature yet, so these can't be scored against "
                           "it — review on your own judgement. Flagging some here will give it its first "
                           "examples.")
            st.markdown("**Review the uploaded transactions**")
            review_and_flag(up_table, behaviour, "upload",
                            f"from an uploaded file, confirmed as {behaviour}")

    # ================= Scan the existing dataset =================
    st.divider()
    st.subheader("Scan the existing dataset")
    if not has_signature:
        st.warning(
            f"**{behaviour}** has no confirmed transaction examples yet, so there's nothing to scan "
            "with — a behaviour only gets a signature once at least one transaction has been flagged "
            "under it (including via the upload above). Go to **Investigate & Flag**, look up one "
            "transaction you believe fits it, flag it there, then come back here to find more like it.")
    else:
        scan_refs = {behaviour: refs[behaviour]}
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
        shown = above.sort_values("margin", ascending=False).head(DISPLAY_CAP)
        st.caption(f"{len(above):,} unflagged transaction(s) above the threshold "
                   f"({len(flagged_ids):,} already flagged, excluded). Showing the top {len(shown):,}.")
        review_and_flag(shown, behaviour, "scan", f"bulk-confirmed via Scan a Behaviour ({behaviour})")

    # ================= push this behaviour's pending flags to Neo4j =================
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
