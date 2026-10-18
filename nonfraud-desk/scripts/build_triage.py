#!/usr/bin/env python3
"""Score January 2025 transaction vectors against the Behaviour UI prototypes.

The source is the Sparkov behaviour export bundled with Behaviour UI
(schema s1 / v1, as of 2026-09-30): fraud_type_prototypes.json and
transaction_vectors/part-*.csv.gz. Matching follows that project's
lib/matching.py: cosine similarity of unit-normalised vectors, and the
margin is the best generator fraud type minus the normal prototype.

Rows under the floor are dropped. The desk serves the remaining file; it
does not parse the gzip parts at request time.

    BEHAVIOUR_UI=/path/to/Behaviour_ui python3 scripts/build_triage.py
"""

from __future__ import annotations

import csv
import gzip
import json
import os
import statistics
from collections import defaultdict
from datetime import date
from pathlib import Path

import numpy as np

FLOOR = 0.20
ROOT = Path(__file__).resolve().parent.parent
SOURCE = Path(os.environ.get("BEHAVIOUR_UI", "/tmp/Behaviour_ui"))
EXPORT = SOURCE / "data" / "neo4j_export" / "s1"
OUT = ROOT / "data"


def unit(vector: np.ndarray) -> np.ndarray:
    return vector / (np.linalg.norm(vector) + 1e-12)


def load_prototypes() -> tuple[list[str], np.ndarray]:
    payload = json.loads((EXPORT / "fraud_type_prototypes.json").read_text())
    prototypes = payload["prototypes"]
    names = [name for name in prototypes if name != "normal"] + ["normal"]
    matrix = np.stack(
        [unit(np.asarray(prototypes[name]["vector"], dtype=np.float64)) for name in names]
    )
    return names, matrix


def score_parts(names: list[str], prototypes: np.ndarray) -> tuple[list[tuple], dict]:
    normal_col = names.index("normal")
    fraud_cols = [index for index in range(len(names)) if index != normal_col]
    fraud_names = [names[index] for index in fraud_cols]
    parts = sorted((EXPORT / "transaction_vectors").glob("part-*.csv.gz"))
    if not parts:
        raise SystemExit(f"No transaction vector parts in {EXPORT / 'transaction_vectors'}")

    kept: list[tuple] = []
    scanned = 0
    bad = 0
    thresholds = (0.20, 0.35, 0.50, 0.80)
    above = {f"{cut:.2f}": 0 for cut in thresholds}
    by_type = defaultdict(int)

    for part in parts:
        buf_ids: list[tuple[str, str, str]] = []
        buf_vecs: list[np.ndarray] = []

        def flush() -> None:
            nonlocal scanned
            if not buf_vecs:
                return
            batch = np.vstack(buf_vecs)
            norms = np.linalg.norm(batch, axis=1, keepdims=True) + 1e-12
            scores = (batch / norms) @ prototypes.T
            fraud_scores = scores[:, fraud_cols]
            best_j = fraud_scores.argmax(axis=1)
            best_score = fraud_scores[np.arange(best_j.size), best_j]
            margin = best_score - scores[:, normal_col]
            for cut in thresholds:
                above[f"{cut:.2f}"] += int((margin >= cut).sum())
            take = np.flatnonzero(margin >= FLOOR)
            for index in take:
                txn_id, account_id, trans_date = buf_ids[index]
                match = fraud_names[int(best_j[index])]
                kept.append(
                    (
                        txn_id,
                        account_id,
                        trans_date,
                        match,
                        round(float(best_score[index]), 4),
                        round(float(margin[index]), 4),
                    )
                )
                by_type[match] += 1
            scanned_now = batch.shape[0]
            scanned += scanned_now
            buf_ids.clear()
            buf_vecs.clear()

        with gzip.open(part, "rt", newline="") as handle:
            header = handle.readline()
            if not header.startswith("txn_id,"):
                raise SystemExit(f"Unexpected header in {part.name}")
            for line in handle:
                txn_id, account_id, trans_date, rest = line.split(",", 3)
                vec_text = rest.split(",", 1)[0]
                vector = np.fromstring(vec_text, sep=";", dtype=np.float64)
                if vector.size != 46:
                    bad += 1
                    continue
                buf_ids.append((txn_id, account_id, trans_date))
                buf_vecs.append(vector)
                if len(buf_vecs) >= 4096:
                    flush()
        flush()
        print(f"{part.name}: scanned {scanned:,} kept {len(kept):,}", flush=True)

    kept.sort(key=lambda row: (-row[5], row[0]))
    meta = {
        "scanned": scanned,
        "skipped": bad,
        "floor": FLOOR,
        "aboveFloor": len(kept),
        "above": above,
        "byTypeAtFloor": dict(sorted(by_type.items())),
        "range": ["2025-01-01", "2025-01-31"],
        "schema": "s1",
        "version": "v1",
        "asof": "2026-09-30",
        "method": (
            "cosine similarity of unit-normalised bb_txn_vec against "
            "fraud_type_prototypes.json; margin is the best generator type minus normal"
        ),
    }
    return kept, meta


def build_library() -> dict:
    path = SOURCE / "data" / "fraud_events.csv"
    grouped: dict[str, list[dict]] = defaultdict(list)
    with path.open(newline="") as handle:
        for row in csv.DictReader(handle, delimiter="|"):
            grouped[row["fraud_type"]].append(row)

    types = []
    for fraud_type, rows in grouped.items():
        delays = []
        durations = []
        losses = []
        entered: dict[str, int] = defaultdict(int)
        for row in rows:
            start = date.fromisoformat(row["fraud_start"][:10])
            compromise = date.fromisoformat(row["compromise_date"][:10])
            end = date.fromisoformat(row["fraud_end"][:10])
            delays.append((start - compromise).days)
            durations.append((end - start).days + 1)
            losses.append(float(row["fraud_amt"]))
            entered[row["entered_by"]] += 1
        entered_by = max(entered, key=entered.get)
        types.append(
            {
                "id": fraud_type,
                "enteredBy": entered_by,
                "events": len(rows),
                "medianDelayDays": int(round(statistics.median(delays))),
                "medianDurationDays": int(round(statistics.median(durations))),
                "medianLoss": round(statistics.median(losses), 2),
                "totalLoss": round(sum(losses), 2),
            }
        )
    types.sort(key=lambda item: -item["totalLoss"])
    return {
        "events": sum(item["events"] for item in types),
        "types": types,
        "source": "Sparkov generator fraud_events.csv, via the Behaviour UI bundle",
    }


def main() -> None:
    if not EXPORT.exists():
        raise SystemExit(f"Export folder not found: {EXPORT}")
    names, prototypes = load_prototypes()
    kept, meta = score_parts(names, prototypes)
    if meta["scanned"] != 490407:
        raise SystemExit(f"Expected 490,407 transaction vectors, scanned {meta['scanned']}")

    OUT.mkdir(parents=True, exist_ok=True)
    triage_path = OUT / "triage.csv"
    with triage_path.open("w", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(["txn_id", "account_id", "trans_date", "match", "score", "margin"])
        writer.writerows(kept)
    (OUT / "triage-meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    (OUT / "fraud-library.json").write_text(json.dumps(build_library(), indent=2) + "\n")
    prototypes_out = OUT / "fraud-type-prototypes.json"
    prototypes_out.write_bytes((EXPORT / "fraud_type_prototypes.json").read_bytes())
    print(json.dumps(meta, indent=2))
    print(f"wrote {triage_path} ({triage_path.stat().st_size / 1_000_000:.1f} MB)")


if __name__ == "__main__":
    main()
