# Non_Fraud · Behaviour desk

A card-fraud desk for the AI Builder Cup 2026, BFSI theme (intelligent risk, fraud, and financial experiences). Team Non_Fraud.

The desk scores a charge against two things that are already true in this book:

- The Sparkov fraud profile: fraud is about 0.10% of rows, it clusters at night, it arrives as a short burst, and it stays under $1,447.68. The largest genuine ticket is $45,688.89, so a large amount is not a fraud signal.
- The behaviour map (schema s1, version v1, 30 Sep 2026): 8,817 accounts in four groups and 861 merchants in ten groups, each with ten nearest neighbours.

A daylight account that starts firing online charges after 22:00 is a departure. A night-native account buying dinner at 23:00 is not. The case note says which, and names the points.

## Backend

The behaviour map lives in Neo4j 5. Accounts, merchants, and behaviour groups are nodes. `BEHAVES_LIKE` is the similarity edge (score and rank). `IN_BEHAVIOUR_GROUP` is membership. A confirmed January charge adds a `Transaction` and a `BehaviourLabel`, joined by `FLAGGED_AS`. The desk reads that graph over Bolt. The night-tape score stays in the app: fixed points, not a query that pretends to be a model. The January queue is also not a trained probability. It is cosine similarity against prototype vectors.

```bash
# Neo4j 5 community, CSV in the import directory, then:
bin/cypher-shell -u neo4j -p nonfraud-local -f scripts/load_graph.cypher
```

Set `NEO4J_URI=bolt://127.0.0.1:7687` (see `.env.example`). With the variable unset, the desk reads `data/behaviour-index.json` instead.

## Run it on your computer

This does not need Neo4j, a cloud host, or an API key. The behaviour map is read from `data/behaviour-index.json`. Confirmed flags are written to `store/flags.json` on that machine.

```bash
npm install
npm run local
```

Then open [http://127.0.0.1:43123](http://127.0.0.1:43123) in a browser on the same computer. `npm run dev` is the cloud-agent server and is not the one to use on your own machine.

The desk is the night tape. Atlas is the fourteen measured groups. Triage is the January 2025 queue: cosine similarity against the six generator fraud prototypes, confirmed by a person, then written to Neo4j as `FLAGGED_AS`. Library is those generator types, the discovered groups, and the flags already on the graph. Try a charge scores an account and merchant you pick from the map, with the same weights.

Keys on the desk: `J` and `K` move the queue, `1` blocks, `2` steps up, `3` releases.

## Gemini

Case notes are written by the desk rules so the prototype runs with no key. To have Gemini rewrite a note from the same evidence:

```bash
cp .env.example .env.local
# set GEMINI_API_KEY
```

`GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`. On Cloud Run you can skip the key and use the runtime service account:

```bash
GOOGLE_GENAI_USE_VERTEXAI=true
GOOGLE_CLOUD_PROJECT=your-project
GOOGLE_CLOUD_LOCATION=asia-southeast1
GEMINI_MODEL=gemini-3.5-flash-lite
```

The model only receives the evidence packet for the open case: masked account, group summary, neighbours, the tape, and the point breakdown. If the call fails, the desk note stays on screen.

## Deploy on Cloud Run

```bash
gcloud run deploy nonfraud-desk \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY=your-key
```

The Dockerfile builds the Next.js standalone server and listens on `PORT` (8080 in the image). The behaviour index is copied into the image.

## Deploy on the k3s cluster

The manifest matches a single-node k3s install with Traefik: namespace `nonfraud`, a NodePort on **30080**, and an Ingress host `nonfraud.desk.local`.

On the machine that already has the cluster:

```bash
docker build -t nonfraud-desk:local .
docker save nonfraud-desk:local | sudo k3s ctr images import -
kubectl apply -f deploy/k8s/desk.yaml
kubectl -n nonfraud rollout status deploy/behaviour-desk
```

Anyone who can reach a node then opens `http://<node-ip>:30080`. For a name instead of a port, point `nonfraud.desk.local` at that node, or change the Ingress host in `deploy/k8s/desk.yaml` before applying. k3d uses `k3d image import nonfraud-desk:local -c <cluster>` instead of `k3s ctr`.

Set `GEMINI_API_KEY` on the container only if you want Gemini to rewrite the case notes. The desk runs on its own rules without it.

## How a charge is scored

Points are fixed. They are not a trained probability.

| Signal | What it adds |
|---|---|
| Category | shopping_net +18, misc_net +16, grocery_pos +15, down to home +1, from the published fraud rates |
| Hour | +16 in the 22:00 hour, +14 from midnight to 04:00, +5 until 06:00. Multiplied by 1.35 for A01, 0.45 for A02, 0.4 for A04 |
| Burst | Charges in the last six hours: 2 → +5, up to 8 or more → +30 |
| Amount | +4 inside $80–$1,448. −12 at $1,500 or more, above the fraud ceiling in this book |
| Merchant group | Thin (M01), shopping online (M06), and night grocery checkout (M07) add the most |
| Profile clash | A03 buying fuel, or A01 in a high-fraud category |
| Online at night | +5 for a `_net` category inside the fraud hours |

The case score is the hottest charge on the tape so far, with the burst counted up to that charge. Block at 70, step up at 46, watch at 28.

## Data

`data/behaviour-index.json` is built from `behaviour_map.csv`:

```bash
python3 scripts/build_index.py /path/to/behaviour_map.csv
```

`data/triage.csv` is the January 2025 queue. It is scored from the Behaviour UI export (transaction vectors and `fraud_type_prototypes.json`, schema s1 / v1, as of 30 Sep 2026):

```bash
BEHAVIOUR_UI=/path/to/Behaviour_ui python3 scripts/build_triage.py
```

The twelve cases on the desk are scripted from the Sparkov profile and pinned to real accounts and real merchants. They are not rows from the 95,127,613-transaction extract. That full extract is not in this workspace. The January queue is 490,407 real transactions from that export, not the scripted tape. The six fraud names are the generator's planted types.

## Scan a proposed behaviour

Confirm at least one January charge under a name this desk proposed. Scan averages those charge vectors, scores the rest of January against that signature and against normal spending, and keeps the margin. Tick the rows that are really that behaviour. The desk writes two files:

- `flagged_behaviours.csv` — one `FLAGGED_AS` row per confirmed charge
- `load_flagged_behaviours.cypher` — `MERGE`s the label, the transaction, and the edge. Safe to re-run

Copy the CSV into the Neo4j import directory and run the Cypher with `cypher-shell`. The same charges are also written to the Neo4j this desk is using, when `NEO4J_URI` is set. The scan reads the January vector parts from `BEHAVIOUR_UI` (default `/tmp/Behaviour_ui`). Without those files the queue still works; the scan does not.

The same scan is a public POST. `push` defaults to false, so the response carries the CSV and Cypher without writing the graph. Set `push` to true to write those charges into Neo4j as well.

```bash
curl -s -X POST "$DESK/api/scan" \
  -H 'Content-Type: application/json' \
  -d '{"label":"night_repeat","description":"Repeated online charges after midnight.","examples":["<txn id>","<txn id>"],"margin":0.5,"push":false}'
```

`GET /api/scan` returns that contract. `examples` can be omitted when the behaviour already has confirmed January charges.

Every merchant name in the generator starts with `fraud_`. That prefix is not a fraud label. The desk strips it for display.

Rebuild the index, then `npm run dev`. The desk refuses to boot if a scripted case no longer lands on the band it was written for.
