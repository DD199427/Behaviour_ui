"""Load behaviour-vector export s1 / v1 (data as of 2026-09-30) into Neo4j.

    pip install neo4j
    export NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=...
    python load_neo4j.py --dir . [--entities account,merchant,transaction] [--create-indexes]

Finds EXISTING nodes by ID and sets vector properties on them; creates no nodes or relationships.
Same result as load.cypher, but reads the files from this folder (no copying into the Neo4j import folder)
and handles the gzip transaction parts directly. Safe to re-run.
"""
import argparse
import csv
import glob
import gzip
import os
import re

from neo4j import GraphDatabase

# Node labels and ID properties in the target graph (set when the export was built; override on the command line)
ACCOUNT_LABEL, ACCOUNT_ID = 'Account', 'account_id'
MERCHANT_LABEL, MERCHANT_NAME, MERCHANT_CATEGORY = 'Merchant', 'name', 'category'
TXN_LABEL, TXN_ID = 'Transaction', 'txn_id'
DIMS = {'account': 31, 'merchant': 31, 'transaction': 46}


def ident(name):
    # labels and property names can't be query parameters, so only allow plain identifiers
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name):
        raise ValueError(f'not a plain identifier: {name!r}')
    return f'`{name}`'


def floats(s):
    return [float(x) for x in s.split(';')]


def ints(s):
    return [int(x) for x in s.split(';')]


def read_rows(path):
    opener = gzip.open if path.endswith('.gz') else open
    with opener(path, 'rt', newline='') as f:
        yield from csv.DictReader(f)


def run_batches(driver, database, query, rows, batch_size):
    loaded = total = 0
    batch = []

    def flush():
        nonlocal loaded
        records, _, _ = driver.execute_query(query, rows=batch, database_=database)
        loaded += records[0]['matched']

    for row in rows:
        batch.append(row)
        total += 1
        if len(batch) == batch_size:
            flush()
            batch = []
    if batch:
        flush()
    return loaded, total


def main():
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('--dir', default=os.path.dirname(os.path.abspath(__file__)))
    p.add_argument('--entities', default='account,merchant,transaction')
    p.add_argument('--uri', default=os.environ.get('NEO4J_URI', 'bolt://localhost:7687'))
    p.add_argument('--user', default=os.environ.get('NEO4J_USER', 'neo4j'))
    p.add_argument('--password', default=os.environ.get('NEO4J_PASSWORD'))
    p.add_argument('--database', default=os.environ.get('NEO4J_DATABASE', 'neo4j'))
    p.add_argument('--batch-size', type=int, default=5000)
    p.add_argument('--create-indexes', action='store_true', help='also create lookup and vector indexes (Neo4j 5.13+)')
    p.add_argument('--account-label', default=ACCOUNT_LABEL)
    p.add_argument('--account-id-prop', default=ACCOUNT_ID)
    p.add_argument('--merchant-label', default=MERCHANT_LABEL)
    p.add_argument('--merchant-name-prop', default=MERCHANT_NAME)
    p.add_argument('--merchant-category-prop', default=MERCHANT_CATEGORY)
    p.add_argument('--txn-label', default=TXN_LABEL)
    p.add_argument('--txn-id-prop', default=TXN_ID)
    args = p.parse_args()
    if args.password is None:
        p.error('set NEO4J_PASSWORD or pass --password')

    al, aid = ident(args.account_label), ident(args.account_id_prop)
    ml, mname, mcat = ident(args.merchant_label), ident(args.merchant_name_prop), ident(args.merchant_category_prop)
    tl, tid = ident(args.txn_label), ident(args.txn_id_prop)
    meta = 'n.bb_schema = row.bb_schema, n.bb_version = row.bb_version, n.bb_asof = date(row.bb_asof)'
    queries = {
        'account': (f'UNWIND $rows AS row MATCH (n:{al} {{{aid}: row.account_id}}) '
                    f'SET n.bb_profile_vec = row.vec, n.bb_profile_mask = row.mask, {meta} RETURN count(n) AS matched'),
        'merchant': (f'UNWIND $rows AS row MATCH (n:{ml} {{{mname}: row.merchant_name, {mcat}: row.category}}) '
                     f'SET n.bb_merchant_vec = row.vec, n.bb_merchant_mask = row.mask, '
                     f'n.bb_merchant_cpp_vec = row.cpp_vec, n.bb_merchant_cpp_mask = row.cpp_mask, {meta} '
                     f'RETURN count(n) AS matched'),
        'transaction': (f'UNWIND $rows AS row MATCH (n:{tl} {{{tid}: row.txn_id}}) '
                        f'SET n.bb_txn_vec = row.vec, n.bb_txn_mask = row.mask, {meta} RETURN count(n) AS matched'),
    }

    def accounts():
        for r in read_rows(os.path.join(args.dir, 'account_vectors.csv')):
            yield {'account_id': r['account_id'], 'vec': floats(r['bb_profile_vec']), 'mask': ints(r['bb_profile_mask']),
                   'bb_schema': r['bb_schema'], 'bb_version': r['bb_version'], 'bb_asof': r['bb_asof']}

    def merchants():
        for r in read_rows(os.path.join(args.dir, 'merchant_vectors.csv')):
            yield {'merchant_name': r['merchant_name'], 'category': r['category'],
                   'vec': floats(r['bb_merchant_vec']), 'mask': ints(r['bb_merchant_mask']),
                   'cpp_vec': floats(r['bb_merchant_cpp_vec']), 'cpp_mask': ints(r['bb_merchant_cpp_mask']),
                   'bb_schema': r['bb_schema'], 'bb_version': r['bb_version'], 'bb_asof': r['bb_asof']}

    def transactions():
        for path in sorted(glob.glob(os.path.join(args.dir, 'transaction_vectors', 'part-*.csv.gz'))):
            for r in read_rows(path):
                yield {'txn_id': r['txn_id'], 'vec': floats(r['bb_txn_vec']), 'mask': ints(r['bb_txn_mask']),
                       'bb_schema': r['bb_schema'], 'bb_version': r['bb_version'], 'bb_asof': r['bb_asof']}

    sources = {'account': accounts, 'merchant': merchants, 'transaction': transactions}
    entities = [e.strip() for e in args.entities.split(',') if e.strip()]

    with GraphDatabase.driver(args.uri, auth=(args.user, args.password)) as driver:
        driver.verify_connectivity()
        if args.create_indexes:
            for stmt in (f'CREATE INDEX bb_account_id IF NOT EXISTS FOR (n:{al}) ON (n.{aid})',
                         f'CREATE INDEX bb_merchant_key IF NOT EXISTS FOR (n:{ml}) ON (n.{mname}, n.{mcat})',
                         f'CREATE INDEX bb_txn_id IF NOT EXISTS FOR (n:{tl}) ON (n.{tid})'):
                driver.execute_query(stmt, database_=args.database)
        for entity in entities:
            if entity == 'transaction' and not os.path.isdir(os.path.join(args.dir, 'transaction_vectors')):
                print('transaction: no transaction vectors in this export, skipped')
                continue
            loaded, total = run_batches(driver, args.database, queries[entity], sources[entity](), args.batch_size)
            print(f'{entity}: {loaded} of {total} rows matched a node' + ('' if loaded == total else
                  '  <- check the label / ID property names and ID types'))
        if args.create_indexes:
            for name, label, prop, dims in (('bb_account_profile', al, 'bb_profile_vec', DIMS['account']),
                                            ('bb_merchant_profile', ml, 'bb_merchant_vec', DIMS['merchant']),
                                            ('bb_txn_behaviour', tl, 'bb_txn_vec', DIMS['transaction'])):
                driver.execute_query(
                    f'CREATE VECTOR INDEX {name} IF NOT EXISTS FOR (n:{label}) ON (n.{prop}) '
                    f"OPTIONS {{indexConfig: {{`vector.dimensions`: {dims}, `vector.similarity_function`: 'cosine'}}}}",
                    database_=args.database)
            print('indexes created')


if __name__ == '__main__':
    main()
