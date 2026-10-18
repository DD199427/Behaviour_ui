#!/usr/bin/env python3
"""Build data/behaviour-index.json from behaviour_map.csv.

The CSV is the s1/v1 behaviour map (BEHAVES_LIKE and IN_BEHAVIOUR_GROUP).
Default input is the copy extracted under /tmp, then ./data/raw/behaviour_map.csv.
"""

from __future__ import annotations

import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "behaviour-index.json"


def find_csv() -> Path:
    if len(sys.argv) > 1:
        return Path(sys.argv[1])
    candidates = [
        Path("/tmp/behaviours/Behaviours/behaviour_map.csv"),
        ROOT / "data" / "raw" / "behaviour_map.csv",
    ]
    for path in candidates:
        if path.exists():
            return path
    raise SystemExit("Pass the path to behaviour_map.csv")


def main() -> None:
    src = find_csv()
    accounts: dict[str, dict] = {}
    merchants: dict[tuple[str, str], dict] = {}
    groups: dict[str, dict] = {}
    account_links = 0
    merchant_links = 0
    cross_links = 0

    with src.open(newline="") as handle:
        for row in csv.DictReader(handle):
            rel = row["rel_type"]
            if rel == "IN_BEHAVIOUR_GROUP":
                gid = row["target_id"]
                if gid not in groups and row["target_properties_json"]:
                    raw = json.loads(row["target_properties_json"])
                    groups[gid] = {
                        "id": gid,
                        "entity": raw["entity"],
                        "size": raw["size"],
                        "summary": raw["summary"],
                        "method": raw["method"],
                        "top": [
                            {
                                "feature": item["feature"],
                                "group": item["group_value"],
                                "overall": item["overall_value"],
                                "stat": item["stat"],
                                "sd": item["vs_overall_sd"],
                            }
                            for item in raw.get("top_features", [])
                        ],
                    }
                if row["source_label"] == "Account":
                    accounts.setdefault(row["source_id"], {"g": gid, "peers": []})
                    accounts[row["source_id"]]["g"] = gid
                else:
                    key = (row["source_id"], row["source_category"])
                    merchants.setdefault(key, {"g": gid, "peers": []})
                    merchants[key]["g"] = gid
            elif rel == "BEHAVES_LIKE" and row["source_label"] == "Account":
                account_links += 1
                accounts.setdefault(row["source_id"], {"g": None, "peers": []})
                accounts[row["source_id"]]["peers"].append(
                    (int(row["rank"]), row["target_id"], round(float(row["score"]), 5))
                )
            elif rel == "BEHAVES_LIKE" and row["source_label"] == "Merchant":
                merchant_links += 1

    spotlight = None
    rank1_cross = 0
    for aid, account in accounts.items():
        account["peers"].sort()
        for rank, tid, score in account["peers"]:
            src_g = account["g"]
            dst_g = accounts.get(tid, {}).get("g")
            if src_g and dst_g and src_g != dst_g:
                cross_links += 1
                if rank == 1:
                    rank1_cross += 1
                    if spotlight is None:
                        spotlight = {
                            "accountId": aid,
                            "accountGroup": src_g,
                            "peerId": tid,
                            "peerGroup": dst_g,
                            "score": score,
                        }

    acc_out = {}
    for aid, account in accounts.items():
        peers = []
        for _rank, tid, score in account["peers"][:10]:
            peers.append([tid, score, accounts.get(tid, {}).get("g") or ""])
        acc_out[aid] = {"g": account["g"], "peers": peers}

    roster: dict[str, list[str]] = defaultdict(list)
    for aid, account in acc_out.items():
        if account["g"]:
            roster[account["g"]].append(aid)
    for ids in roster.values():
        ids.sort()

    merchant_rows = [
        {"name": name, "category": category, "group": info["g"]}
        for (name, category), info in merchants.items()
        if info["g"]
    ]
    merchant_rows.sort(key=lambda item: (item["group"], item["category"], item["name"]))

    payload = {
        "asof": "2026-09-30",
        "schema": "s1",
        "version": "v1",
        "counts": {
            "accounts": len(acc_out),
            "merchants": len(merchant_rows),
            "accountLinks": account_links,
            "merchantLinks": merchant_links,
            "accountGroups": sum(1 for g in groups if g.startswith("A")),
            "merchantGroups": sum(1 for g in groups if g.startswith("M")),
            "crossGroupAccountLinks": cross_links,
            "rank1CrossGroup": rank1_cross,
        },
        "spotlight": spotlight,
        "groups": groups,
        "roster": roster,
        "merchants": merchant_rows,
        "accounts": acc_out,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1_000_000:.2f} MB)")
    print(json.dumps(payload["counts"]))
    print("spotlight", spotlight)


if __name__ == "__main__":
    main()
