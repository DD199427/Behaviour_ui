import type { FlagLabel } from "@/lib/behaviour-copy"

export type ExportCharge = {
  txnId: string
  accountId: string
  date: string
  score: number
  margin: number
}

export type FlaggedExport = {
  batch: string
  rows: number
  csvName: string
  cypherName: string
  csv: string
  cypher: string
}

const COLUMNS = [
  "rel_type",
  "source_label",
  "source_id",
  "source_category",
  "target_label",
  "target_id",
  "target_category",
  "score",
  "rank",
  "schema",
  "version",
  "asof",
  "properties_json",
  "target_properties_json",
  "account_id",
  "trans_date",
  "margin",
]

function csvField(value: string | number): string {
  const text = String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

function batchStamp(now = new Date()): string {
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
  return `v${iso}`
}

export function buildFlaggedExport(
  label: FlagLabel,
  charges: ExportCharge[],
  user: string,
  note: string,
  now = new Date(),
): FlaggedExport {
  const batch = batchStamp(now)
  const asof = now.toISOString().slice(0, 10)
  const lines = [COLUMNS.join(",")]
  for (const charge of charges) {
    const properties = {
      ts: now.toISOString(),
      user,
      note,
      batch,
      margin: charge.margin,
      account_id: charge.accountId,
      trans_date: charge.date,
      is_new_label: label.origin === "analyst",
    }
    const target = {
      description: label.description,
      status: label.status,
      origin: label.origin,
      flags: label.flags,
      entities: label.entities,
    }
    const row = [
      "FLAGGED_AS",
      "Transaction",
      charge.txnId,
      "",
      "BehaviourLabel",
      label.name,
      "",
      charge.score.toFixed(4),
      "",
      "labels",
      batch,
      asof,
      JSON.stringify(properties),
      JSON.stringify(target),
      charge.accountId,
      charge.date,
      charge.margin.toFixed(4),
    ]
    lines.push(row.map(csvField).join(","))
  }

  const chargeWord = charges.length === 1 ? "charge" : "charges"
  const cypher = `// Proposed behaviour ${label.name}, export batch ${batch} (${charges.length} ${chargeWord} to load).
// Copy flagged_behaviours.csv into the Neo4j import directory, then run:
//   bin/cypher-shell -u neo4j -p <password> -f load_flagged_behaviours.cypher
// In Neo4j Browser, put :auto before each LOAD CSV.
// MERGE is safe to re-run. Transaction nodes are created when this graph does
// not already hold the January charge. ON_ACCOUNT is added only when that
// Account is already in the behaviour map. Status on this label: ${label.status}.

CREATE CONSTRAINT bb_label_name IF NOT EXISTS FOR (b:BehaviourLabel) REQUIRE b.name IS UNIQUE;
CREATE CONSTRAINT bb_txn_id IF NOT EXISTS FOR (t:Transaction) REQUIRE t.txn_id IS UNIQUE;

LOAD CSV WITH HEADERS FROM 'file:///flagged_behaviours.csv' AS row
CALL {
  WITH row
  WHERE row.version = '${batch}'
  MERGE (b:BehaviourLabel {name: row.target_id})
  SET b.properties_json = row.target_properties_json,
      b.schema = row.schema,
      b.version = row.version,
      b.origin = '${label.origin}',
      b.status = '${label.status}'
} IN TRANSACTIONS OF 1000 ROWS;

LOAD CSV WITH HEADERS FROM 'file:///flagged_behaviours.csv' AS row
WITH row
WHERE row.version = '${batch}' AND row.source_label = 'Transaction'
CALL {
  WITH row
  MERGE (t:Transaction {txn_id: row.source_id})
  SET t.account_id = row.account_id, t.trans_date = row.trans_date
  WITH row, t
  MATCH (b:BehaviourLabel {name: row.target_id})
  MERGE (t)-[r:FLAGGED_AS]->(b)
  SET r.confidence = toFloat(row.score),
      r.margin = toFloat(row.margin),
      r.properties_json = row.properties_json,
      r.source = 'analyst-confirm'
  WITH row, t
  OPTIONAL MATCH (a:Account {account_id: row.account_id})
  FOREACH (_ IN CASE WHEN a IS NULL THEN [] ELSE [1] END | MERGE (t)-[:ON_ACCOUNT]->(a))
} IN TRANSACTIONS OF 1000 ROWS;
`

  return {
    batch,
    rows: charges.length,
    csvName: "flagged_behaviours.csv",
    cypherName: "load_flagged_behaviours.cypher",
    csv: `${lines.join("\n")}\n`,
    cypher,
  }
}
