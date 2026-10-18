#!/usr/bin/env python3
"""Scan January transaction vectors against one proposed behaviour.

The signature is the unit-normalised mean of the example transaction vectors.
That is the same construction as Behaviour UI lib/matching.py custom_references.
Margin is the cosine against that signature minus the cosine against the
normal-spending prototype. Rows at or under the margin are dropped.

Reads a JSON object on stdin:

    {
      "examples": ["txn_id", ...],
      "exclude": ["txn_id", ...],
      "margin": 0.5,
      "limit": 200,
      "cap": 5000,
      "source": "/tmp/Behaviour_ui",
      "prototypes": "/workspace/data/fraud-type-prototypes.json",
      "csv": "/workspace/store/scans/name.csv"
    }

Writes a JSON object to stdout. The CSV, when requested, holds up to `cap`
rows above the margin, highest margin first. The JSON `rows` list is the
first `limit` of those.
"""

from __future__ import annotations

import csv
import gzip
import json
import sys
from pathlib import Path

import numpy as np

EXPECTED = 490407
DIM = 46


def unit(vector: np.ndarray) -> np.ndarray:
    return vector / (np.linalg.norm(vector) + 1e-12)


def load_normal(path: Path) -> np.ndarray:
    payload = json.loads(path.read_text())
    vector = np.asarray(payload["prototypes"]["normal"]["vector"], dtype=np.float64)
    if vector.size != DIM:
        raise SystemExit(f"Normal prototype has {vector.size} dimensions, expected {DIM}")
    return unit(vector)


def consume(parts: list[Path], wanted: set[str]) -> tuple[list[tuple[str, str, str]], list[np.ndarray], dict[str, np.ndarray], int]:
    ids: list[tuple[str, str, str]] = []
    chunks: list[np.ndarray] = []
    examples: dict[str, np.ndarray] = {}
    skipped = 0
    buf_ids: list[tuple[str, str, str]] = []
    buf_vecs: list[np.ndarray] = []

    def flush() -> None:
        if not buf_vecs:
            return
        chunks.append(np.vstack(buf_vecs).astype(np.float32, copy=False))
        ids.extend(buf_ids)
        buf_ids.clear()
        buf_vecs.clear()

    for part in parts:
        with gzip.open(part, "rt", newline="") as handle:
            header = handle.readline()
            if not header.startswith("txn_id,"):
                raise SystemExit(f"Unexpected header in {part.name}")
            for line in handle:
                txn_id, account_id, trans_date, rest = line.split(",", 3)
                vec_text = rest.split(",", 1)[0]
                vector = np.fromstring(vec_text, sep=";", dtype=np.float64)
                if vector.size != DIM:
                    skipped += 1
                    continue
                if txn_id in wanted and txn_id not in examples:
                    examples[txn_id] = vector
                buf_ids.append((txn_id, account_id, trans_date))
                buf_vecs.append(vector)
                if len(buf_vecs) >= 4096:
                    flush()
        flush()
    return ids, chunks, examples, skipped


def main() -> None:
    request = json.load(sys.stdin)
    source = Path(request.get("source") or "/tmp/Behaviour_ui")
    export = source / "data" / "neo4j_export" / "s1" / "transaction_vectors"
    parts = sorted(export.glob("part-*.csv.gz"))
    if not parts:
        raise SystemExit(f"No transaction vector parts in {export}")

    prototypes = Path(request.get("prototypes") or "data/fraud-type-prototypes.json")
    normal = load_normal(prototypes)
    examples = [str(item) for item in request.get("examples") or []]
    if not examples:
        raise SystemExit("A proposed behaviour needs at least one example transaction.")
    exclude = set(str(item) for item in request.get("exclude") or examples)
    margin_floor = float(request.get("margin", 0.5))
    limit = max(1, min(200, int(request.get("limit", 200))))
    cap = max(limit, min(5000, int(request.get("cap", 5000))))

    ids, chunks, found, skipped = consume(parts, set(examples))
    scanned = len(ids)
    missing = [txn_id for txn_id in examples if txn_id not in found]
    if not found:
        raise SystemExit(
            "None of the example transactions are in the January 2025 vector export, so this behaviour has no signature."
        )

    signature = unit(np.mean(np.stack(list(found.values())), axis=0))
    targets = np.stack([signature, normal])
    kept: list[tuple[str, str, str, float, float]] = []
    matched = 0
    offset = 0
    for chunk in chunks:
        norms = np.linalg.norm(chunk, axis=1, keepdims=True) + 1e-12
        scores = (chunk / norms) @ targets.T
        own = scores[:, 0]
        margin = own - scores[:, 1]
        take = np.flatnonzero(margin > margin_floor)
        for index in take:
            txn_id, account_id, trans_date = ids[offset + int(index)]
            if txn_id in exclude:
                continue
            matched += 1
            kept.append(
                (
                    txn_id,
                    account_id,
                    trans_date,
                    round(float(own[index]), 4),
                    round(float(margin[index]), 4),
                )
            )
        offset += chunk.shape[0]
        if len(kept) > cap * 4:
            kept.sort(key=lambda row: (-row[4], row[0]))
            del kept[cap:]

    kept.sort(key=lambda row: (-row[4], row[0]))
    truncated = matched > cap
    if len(kept) > cap:
        del kept[cap:]

    csv_path = request.get("csv")
    if csv_path:
        path = Path(csv_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", newline="") as handle:
            writer = csv.writer(handle, lineterminator="\n")
            writer.writerow(["txn_id", "account_id", "trans_date", "score", "margin"])
            writer.writerows(kept)

    payload = {
        "scanned": scanned,
        "skipped": skipped,
        "expected": EXPECTED,
        "complete": scanned == EXPECTED and skipped == 0,
        "examplesRequested": len(examples),
        "examplesFound": len(found),
        "missing": missing,
        "margin": margin_floor,
        "matched": matched,
        "truncated": truncated,
        "rows": [
            {
                "txnId": txn_id,
                "accountId": account_id,
                "date": trans_date,
                "score": score,
                "margin": margin,
            }
            for txn_id, account_id, trans_date, score, margin in kept[:limit]
        ],
    }
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
