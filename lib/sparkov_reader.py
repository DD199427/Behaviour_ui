"""Reads Sparkov-format raw transaction files into per-card arrays, for on-demand vector
computation (see lib/live_scan.py).

This is the exact subset needed from neo4j-behaviour-export/build_behaviour_vectors.py, copied
rather than imported across repos so behaviour-ui has no dependency on anything outside itself —
it needs to run standalone (e.g. deployed on its own, cloned without the rest of this project).
If the feature logic in the original ever changes, re-sync this file and lib/sparkov_features.py
(a verbatim copy of features.py) by hand; there's no automated link between the two copies.
"""
import os
from datetime import date

import numpy as np

from lib import sparkov_features as F

TXN_COLUMNS = ['cc_num', 'trans_num', 'trans_date', 'trans_time', 'unix_time', 'category', 'amt', 'is_fraud',
               'merchant', 'merch_lat', 'merch_long']


def day_ordinal(s):
    return date.fromisoformat(s).toordinal()


def transaction_files(data_dir):
    files = []
    for name in sorted(os.listdir(data_dir)):
        if not name.endswith('.csv') or name == 'customers.csv':
            continue
        with open(os.path.join(data_dir, name), 'r') as f:
            header = f.readline().rstrip('\n').split('|')
        if all(c in header for c in TXN_COLUMNS):
            files.append(name)
    return files


def read_file(path, asof):
    """Parse one transaction file into arrays sorted by card, then time (rows after the as-of date dropped)."""
    cols = [[] for _ in TXN_COLUMNS]
    with open(path, 'r') as f:
        header = f.readline().rstrip('\n').split('|')
        ix = [header.index(c) for c in TXN_COLUMNS]
        date_ix = ix[TXN_COLUMNS.index('trans_date')]
        for line in f:
            r = line.rstrip('\n').split('|')
            if r[date_ix] <= asof:
                for col, i in zip(cols, ix):
                    col.append(r[i])
    if not cols[0]:
        return None
    cc, trans_num, tdate, ttime, unix, category, amt, is_fraud, merchant, mlat, mlon = cols

    card_ids, card = np.unique(np.array(cc), return_inverse=True)
    mkeys = list(dict.fromkeys(zip(merchant, category)))
    mindex = {k: i for i, k in enumerate(mkeys)}
    days = {d: day_ordinal(d) for d in set(tdate)}
    ts = np.array(unix, dtype=np.int64)
    order = np.lexsort((ts, card))

    a = {
        'card': card,
        'trans_num': np.array(trans_num, dtype=object),
        'ts': ts,
        'day': np.array([days[d] for d in tdate], dtype=np.int64),
        'tod': np.array([int(t[:2]) * 3600 + int(t[3:5]) * 60 + int(t[6:8]) for t in ttime], dtype=np.int64),
        'cat': np.array([F.CAT_INDEX.get(c, -1) for c in category], dtype=np.int64),
        'online': np.array([c.endswith('_net') for c in category]),
        'amt': np.array(amt, dtype=float),
        'is_fraud': np.array(is_fraud) == '1',
        'merchant': np.array([mindex[k] for k in zip(merchant, category)], dtype=np.int64),
        'merch_lat': np.array(mlat, dtype=float),
        'merch_long': np.array(mlon, dtype=float),
    }
    a = {k: v[order] for k, v in a.items()}
    a['hour'] = a['tod'] // 3600
    a['band'] = a['hour'] // 4
    a['weekday'] = (a['day'] + 6) % 7  # date.toordinal() 1 = Monday -> 0 = Monday ... 6 = Sunday
    return a, card_ids, mkeys


def card_arrays(a, lo, hi):
    return {k: v[lo:hi] for k, v in a.items()}
