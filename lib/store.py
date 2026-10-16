"""The app's own state: flags (feedback on entities) and custom behaviour labels.

Two plain files in behaviour-ui/store/, append-only for flags so nothing is ever silently lost:
  flags.csv    one row per flag a user has made
  labels.json  one entry per custom behaviour a user has named

A label is "promoted" (ready to export with confidence) once it has at least MIN_FLAGS flags
from at least MIN_ENTITIES distinct entities — mirrors the threshold in the original plan.
"""
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from lib.knowledge import FRAUD_TYPE_NOTES

STORE_DIR = Path(__file__).resolve().parent.parent / "store"
FLAGS_CSV = STORE_DIR / "flags.csv"
LABELS_JSON = STORE_DIR / "labels.json"
FLAGS_COLUMNS = ["flag_id", "ts", "user", "entity_type", "entity_id", "entity_category",
                  "label", "is_new_label", "note", "confidence", "exported", "export_batch"]
MIN_FLAGS, MIN_ENTITIES = 5, 3


def _ensure():
    STORE_DIR.mkdir(exist_ok=True)
    if not FLAGS_CSV.exists():
        pd.DataFrame(columns=FLAGS_COLUMNS).to_csv(FLAGS_CSV, index=False)
    if not LABELS_JSON.exists():
        LABELS_JSON.write_text("{}")


def load_flags():
    _ensure()
    # keep_default_na=False: an empty export_batch (not yet exported) must stay '', not become NaN,
    # or pandas infers that column as float64 and later refuses to write a batch-id string into it
    df = pd.read_csv(FLAGS_CSV, dtype={"entity_id": str, "entity_category": str, "label": str,
                                        "note": str, "export_batch": str, "exported": bool},
                      keep_default_na=False, na_values=[])
    if df.empty:
        return pd.DataFrame(columns=FLAGS_COLUMNS)
    return df


def load_labels():
    _ensure()
    with open(LABELS_JSON) as f:
        return json.load(f)


def add_label(name, description, created_by="analyst"):
    labels = load_labels()
    if name not in labels:
        labels[name] = {"description": description, "created_at": datetime.now(timezone.utc).isoformat(),
                        "created_by": created_by, "status": "candidate"}
        LABELS_JSON.write_text(json.dumps(labels, indent=1))
    return labels[name]


def append_flag(entity_type, entity_id, entity_category, label, note, confidence, user,
                 is_new_label=False, new_label_description=""):
    _ensure()
    if is_new_label:
        add_label(label, new_label_description, created_by=user)
    row = {
        "flag_id": str(uuid.uuid4()), "ts": datetime.now(timezone.utc).isoformat(), "user": user,
        "entity_type": entity_type, "entity_id": entity_id, "entity_category": entity_category or "",
        "label": label, "is_new_label": bool(is_new_label), "note": note or "",
        "confidence": confidence, "exported": False, "export_batch": "",
    }
    pd.DataFrame([row])[FLAGS_COLUMNS].to_csv(FLAGS_CSV, mode="a", header=False, index=False)
    _update_label_status(label)
    return row


def _update_label_status(label):
    labels = load_labels()
    if label not in labels or labels[label]["status"] != "candidate":
        return
    flags = load_flags()
    rows = flags[flags["label"] == label]
    distinct_entities = rows[["entity_type", "entity_id", "entity_category"]].drop_duplicates()
    if len(rows) >= MIN_FLAGS and len(distinct_entities) >= MIN_ENTITIES:
        labels[label]["status"] = "active"
        LABELS_JSON.write_text(json.dumps(labels, indent=1))


def label_status(label):
    """'known' (one of the 6 ground-truth fraud types, always trusted), 'active' (corroborated
    custom behaviour) or 'candidate' (not yet corroborated — including ad-hoc labels that were
    never explicitly created, which default to 'candidate' rather than being trusted by accident)."""
    if label in FRAUD_TYPE_NOTES:
        return "known"
    return load_labels().get(label, {}).get("status", "candidate")


def label_progress(label):
    """How close a candidate label is to being promoted, for display."""
    flags = load_flags()
    rows = flags[flags["label"] == label]
    distinct = len(rows[["entity_type", "entity_id", "entity_category"]].drop_duplicates())
    return {"flags": len(rows), "flags_needed": MIN_FLAGS, "distinct_entities": distinct,
            "entities_needed": MIN_ENTITIES}


def mark_exported(flag_ids, batch_id):
    df = load_flags()
    mask = df["flag_id"].isin(flag_ids)
    df.loc[mask, "exported"] = True
    df.loc[mask, "export_batch"] = batch_id
    df.to_csv(FLAGS_CSV, index=False)
