// OPTIONAL: build a behaviour map from the loaded vectors (export s1 / v1).
// Needs the Graph Data Science (GDS) library 2.4 or later: Neo4j Desktop / self-managed with the GDS plugin, or AuraDS.
// AuraDB Free does not include GDS. Run AFTER load.cypher or load_neo4j.py.
//
// What it creates:
//   (:Account)-[:BEHAVES_LIKE {score}]->(:Account)    each account's 10 most similar accounts
//   (:Merchant)-[:BEHAVES_LIKE {score}]->(:Merchant)  each merchant's 10 most similar merchants
//   bb_behaviour_group property on accounts and merchants                  communities of similar behaviour
// Re-running: delete the old links first (step 0), or they will be duplicated.
// knn randomSeed + concurrency 1 make the links repeatable; louvain with concurrency 1 is repeatable too.

// ---- 0. Remove links from an earlier run
MATCH (:Account)-[r:BEHAVES_LIKE]->(:Account) CALL { WITH r DELETE r } IN TRANSACTIONS OF 10000 ROWS;
MATCH (:Merchant)-[r:BEHAVES_LIKE]->(:Merchant) CALL { WITH r DELETE r } IN TRANSACTIONS OF 10000 ROWS;

// ---- 1. Accounts: similarity links, then groups
MATCH (a:Account) WHERE a.bb_profile_vec IS NOT NULL
WITH gds.graph.project('bb_accounts', a, null, {sourceNodeProperties: a {.bb_profile_vec}}) AS g
RETURN g.nodeCount AS accounts_projected;
CALL gds.knn.write('bb_accounts', {
  nodeProperties: {bb_profile_vec: 'COSINE'}, topK: 10, randomSeed: 42, concurrency: 1,
  writeRelationshipType: 'BEHAVES_LIKE', writeProperty: 'score'
});
CALL gds.graph.drop('bb_accounts');

CALL gds.graph.project('bb_account_links', 'Account',
  {BEHAVES_LIKE: {orientation: 'UNDIRECTED', properties: 'score'}});
CALL gds.louvain.write('bb_account_links', {
  relationshipWeightProperty: 'score', writeProperty: 'bb_behaviour_group', concurrency: 1
});
CALL gds.graph.drop('bb_account_links');

// ---- 2. Merchants: the same, on the activity vector (not the cpp vector)
MATCH (m:Merchant) WHERE m.bb_merchant_vec IS NOT NULL
WITH gds.graph.project('bb_merchants', m, null, {sourceNodeProperties: m {.bb_merchant_vec}}) AS g
RETURN g.nodeCount AS merchants_projected;
CALL gds.knn.write('bb_merchants', {
  nodeProperties: {bb_merchant_vec: 'COSINE'}, topK: 10, randomSeed: 42, concurrency: 1,
  writeRelationshipType: 'BEHAVES_LIKE', writeProperty: 'score'
});
CALL gds.graph.drop('bb_merchants');

CALL gds.graph.project('bb_merchant_links', 'Merchant',
  {BEHAVES_LIKE: {orientation: 'UNDIRECTED', properties: 'score'}});
CALL gds.louvain.write('bb_merchant_links', {
  relationshipWeightProperty: 'score', writeProperty: 'bb_behaviour_group', concurrency: 1
});
CALL gds.graph.drop('bb_merchant_links');

// ---- 3. Look at the groups
MATCH (a:Account) WHERE a.bb_behaviour_group IS NOT NULL
RETURN a.bb_behaviour_group AS group, count(*) AS accounts ORDER BY accounts DESC LIMIT 20;

// In Neo4j Bloom / Browser: colour accounts and merchants by bb_behaviour_group, size merchants by
// m.bb_merchant_cpp_vec[0] (raw share of cardholders later defrauded is f_cpp_victim_visitor_share in the CSV).
