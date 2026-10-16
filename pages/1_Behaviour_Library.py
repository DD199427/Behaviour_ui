"""Behaviour Library — what behaviours exist, as of now: known (ground-truth) fraud types,
unsupervised groups discovered in the vectors, and custom behaviours the team has named."""
import pandas as pd
import streamlit as st

from lib.data import load_behaviour_map, load_fraud_events
from lib.knowledge import FRAUD_TYPE_NOTES, group_description
from lib.store import add_label, label_progress, load_flags, load_labels


def describe_deviation(z):
    """Turn a standard-deviations-from-typical score into a plain-English phrase."""
    direction, size = ("higher" if z >= 0 else "lower"), abs(z)
    word = "about typical" if size < 0.5 else \
           "somewhat " + direction if size < 1.5 else \
           "much " + direction if size < 3 else \
           "far " + direction
    return f"{word[0].upper()}{word[1:]} (z = {z:+.1f})"

st.set_page_config(page_title="Behaviour Library", layout="wide")
st.title("Behaviour Library")

tab_known, tab_discovered, tab_custom = st.tabs(
    ["Known fraud behaviours", "Discovered groups", "Custom behaviours"])

# ---- Known fraud behaviours (ground truth from fraud_poc_v2's fraud_events.csv) ----
# One always-visible, plainly formatted section per type — no icons, no colour badges, nothing hidden.
DISPLAY_NAME = {
    "phishing_fake_site": "Phishing (fake site)",
    "breached_online_store": "Breached online store",
    "skimmer_cloned_card": "Skimmer (cloned card)",
    "rogue_employee": "Rogue employee",
    "friendly_family": "Friendly or family",
    "lost_stolen_card": "Lost or stolen card",
}
ENTERED_BY_LABEL = {"cardholder": "Cardholder", "other_user": "Another person"}

with tab_known:
    events = load_fraud_events()
    st.caption(f"{len(events):,} confirmed fraud events, from `Outputs/fraud_poc_v2/fraud_events.csv`. "
               "Ordered by total loss, highest first.")
    summary = events.groupby("fraud_type").agg(
        entered_by=("entered_by", "first"), events=("event_id", "count"),
        median_delay_days=("delay_days", "median"), median_duration_days=("duration_days", "median"),
        median_loss=("fraud_amt", "median"), total_loss=("fraud_amt", "sum"),
    ).reset_index().sort_values("total_loss", ascending=False)

    table = summary.assign(
        Behaviour=lambda d: d["fraud_type"].map(DISPLAY_NAME).fillna(d["fraud_type"]),
        **{"Entered by": lambda d: d["entered_by"].map(ENTERED_BY_LABEL).fillna(d["entered_by"])},
    ).rename(columns={"events": "Events", "median_delay_days": "Median delay (days)",
                      "median_duration_days": "Median duration (days)"})
    table["Median delay (days)"] = table["Median delay (days)"].round().astype(int)
    table["Median duration (days)"] = table["Median duration (days)"].round().astype(int)
    table["Loss per event"] = table["median_loss"].map(lambda v: f"${v:,.0f}")
    table["Total loss"] = table["total_loss"].map(lambda v: f"${v:,.0f}")
    st.dataframe(table[["Behaviour", "Entered by", "Events", "Median delay (days)",
                        "Median duration (days)", "Loss per event", "Total loss"]],
                 width="stretch", hide_index=True)

    st.divider()
    st.caption("What each behaviour looks like — figures for each are in the table above.")
    for i, (_, r) in enumerate(summary.iterrows()):
        name = DISPLAY_NAME.get(r["fraud_type"], r["fraud_type"])
        entered_by = ENTERED_BY_LABEL.get(r["entered_by"], r["entered_by"])
        with st.container(border=True):
            st.markdown(f"##### {name}")
            st.caption(f"Entered by: {entered_by}")
            st.write(FRAUD_TYPE_NOTES.get(r["fraud_type"], ""))
        if i < len(summary) - 1:
            st.divider()

# ---- Discovered groups (unsupervised clusters from behaviour_map.csv) ----
with tab_discovered:
    bmap = load_behaviour_map()
    groups = (bmap[bmap["rel_type"] == "IN_BEHAVIOUR_GROUP"]
              .drop_duplicates("target_id")[["target_id", "target_properties"]])
    st.caption(f"{len(groups)} groups found by clustering the account and merchant vectors "
               "(no fraud labels used).")
    for _, g in groups.sort_values("target_id").iterrows():
        group_id = g["target_id"]
        p = g["target_properties"]
        entity = p.get("entity", "")
        size = p.get("size", 0)
        top_features = p.get("top_features", [])
        with st.expander(f"**{group_id}** ({entity}) — {size:,} members"):
            st.write(group_description(entity, size, top_features))
            st.caption(p.get("method", ""))
            if top_features:
                feats = pd.DataFrame([{
                    "Feature": f["feature"],
                    "How different from typical": describe_deviation(f["vs_overall_sd"]),
                    "This group": f["group_value"],
                    "Typical (all)": f["overall_value"],
                } for f in top_features])
                st.dataframe(feats, width="stretch", hide_index=True, column_config={
                    "How different from typical": st.column_config.TextColumn(
                        help="How far this group's average is from the average across all of them: "
                             "about typical (under 0.5 standard deviations), somewhat (0.5-1.5), "
                             "much (1.5-3) or far (3+). The 'z' number is the precise figure.")})

            st.divider()
            if st.checkbox("Propose this group as a new behaviour", key=f"propose_toggle_{group_id}"):
                st.caption("This only creates the behaviour, as a candidate — it does not flag any "
                           "members. Go to Investigate & Flag and confirm individual members there "
                           "to corroborate it.")
                name = st.text_input("Behaviour name", value=f"{entity}_pattern_{group_id}",
                                     key=f"propose_name_{group_id}")
                description = st.text_area("Description", value=group_description(entity, size, top_features),
                                           key=f"propose_desc_{group_id}")
                user = st.text_input("Your name", st.session_state.get("user", "analyst"),
                                     key=f"propose_user_{group_id}")
                if st.button("Create behaviour", key=f"propose_submit_{group_id}", type="primary"):
                    if not name:
                        st.warning("Give it a name first.")
                    elif name in load_labels() or name in FRAUD_TYPE_NOTES:
                        st.warning(f"**{name}** already exists — pick a different name.")
                    else:
                        st.session_state["user"] = user
                        add_label(name, description, created_by=user)
                        members = bmap[(bmap["rel_type"] == "IN_BEHAVIOUR_GROUP")
                                       & (bmap["target_id"] == group_id)]
                        ids = ((members["source_id"] + " (" + members["source_category"] + ")").tolist()
                               if entity == "merchant" else members["source_id"].tolist())
                        shown = ", ".join(ids[:15]) + (f" (+{len(ids) - 15} more)" if len(ids) > 15 else "")
                        st.success(f"Created **{name}** as a candidate behaviour. Members of this "
                                   f"group, to go confirm individually: {shown}")

# ---- Custom behaviours (named by users on the Investigate & Flag page) ----
with tab_custom:
    labels = load_labels()
    custom = {k: v for k, v in labels.items() if k not in FRAUD_TYPE_NOTES}
    if not custom:
        st.info("No custom behaviours yet. Create one from the **Investigate & Flag** page.")
    else:
        flags = load_flags()
        for name, meta in sorted(custom.items()):
            prog = label_progress(name)
            status = meta["status"]
            badge = "🟢 active" if status == "active" else f"🟡 candidate ({prog['flags']}/{prog['flags_needed']} flags, {prog['distinct_entities']}/{prog['entities_needed']} entities)"
            with st.expander(f"**{name}** — {badge}"):
                st.write(meta["description"] or "_(no description)_")
                st.caption(f"Created by {meta['created_by']} on {meta['created_at'][:10]}")
                rows = flags[flags["label"] == name]
                if not rows.empty:
                    st.dataframe(rows[["ts", "entity_type", "entity_id", "note"]],
                                 width="stretch", hide_index=True)
