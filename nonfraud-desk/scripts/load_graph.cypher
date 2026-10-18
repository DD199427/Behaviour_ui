// Load behaviour map s1/v1 into Neo4j 5.
// The shipped load_behaviour_map.cypher MATCHES Account and Merchant nodes that already exist.
// This script creates those nodes, then the groups and the BEHAVES_LIKE edges.
// CSV must sit in the Neo4j import directory as behaviour_map.csv.

CREATE CONSTRAINT account_id IF NOT EXISTS FOR (a:Account) REQUIRE a.account_id IS UNIQUE;
CREATE CONSTRAINT group_id IF NOT EXISTS FOR (g:BehaviourGroup) REQUIRE g.group_id IS UNIQUE;
CREATE INDEX merchant_name_category IF NOT EXISTS FOR (m:Merchant) ON (m.name, m.category);
CREATE INDEX behaves_rank IF NOT EXISTS FOR ()-[r:BEHAVES_LIKE]-() ON (r.rank);

LOAD CSV WITH HEADERS FROM 'file:///behaviour_map.csv' AS row
WITH row WHERE row.rel_type = 'IN_BEHAVIOUR_GROUP' AND row.source_label = 'Account'
CALL {
  WITH row
  MERGE (a:Account {account_id: row.source_id})
  MERGE (g:BehaviourGroup {group_id: row.target_id})
  SET g.entity = 'account',
      g.properties_json = row.target_properties_json,
      g.schema = row.schema,
      g.version = row.version,
      g.asof = row.asof
  MERGE (a)-[r:IN_BEHAVIOUR_GROUP]->(g)
  SET r.properties_json = row.properties_json
} IN TRANSACTIONS OF 5000 ROWS;

LOAD CSV WITH HEADERS FROM 'file:///behaviour_map.csv' AS row
WITH row WHERE row.rel_type = 'IN_BEHAVIOUR_GROUP' AND row.source_label = 'Merchant'
CALL {
  WITH row
  MERGE (m:Merchant {name: row.source_id, category: row.source_category})
  MERGE (g:BehaviourGroup {group_id: row.target_id})
  SET g.entity = 'merchant',
      g.properties_json = row.target_properties_json,
      g.schema = row.schema,
      g.version = row.version,
      g.asof = row.asof
  MERGE (m)-[r:IN_BEHAVIOUR_GROUP]->(g)
  SET r.properties_json = row.properties_json
} IN TRANSACTIONS OF 2000 ROWS;

LOAD CSV WITH HEADERS FROM 'file:///behaviour_map.csv' AS row
WITH row WHERE row.rel_type = 'BEHAVES_LIKE' AND row.source_label = 'Account'
CALL {
  WITH row
  MATCH (a:Account {account_id: row.source_id})
  MATCH (b:Account {account_id: row.target_id})
  MERGE (a)-[r:BEHAVES_LIKE]->(b)
  SET r.score = toFloat(row.score),
      r.rank = toInteger(row.rank),
      r.properties_json = row.properties_json,
      r.schema = row.schema,
      r.version = row.version
} IN TRANSACTIONS OF 5000 ROWS;

LOAD CSV WITH HEADERS FROM 'file:///behaviour_map.csv' AS row
WITH row WHERE row.rel_type = 'BEHAVES_LIKE' AND row.source_label = 'Merchant'
CALL {
  WITH row
  MATCH (m:Merchant {name: row.source_id, category: row.source_category})
  MATCH (n:Merchant {name: row.target_id, category: row.target_category})
  MERGE (m)-[r:BEHAVES_LIKE]->(n)
  SET r.score = toFloat(row.score),
      r.rank = toInteger(row.rank),
      r.properties_json = row.properties_json,
      r.schema = row.schema,
      r.version = row.version
} IN TRANSACTIONS OF 2000 ROWS;
