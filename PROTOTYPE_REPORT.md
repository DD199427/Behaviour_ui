# Non_Fraud prototype report

Team Non_Fraud. January 2025 book, behaviour schema s1 version v1, as of 30 Sep 2026.

Ranking figures are the prototype’s one-time check against the generator’s labels, recorded in `lib/matching.py`. Loss figures are computed from `data/fraud_events.csv`. Population counts for the January vectors are from `data/neo4j_export/s1/transaction_vectors/`.

## Ranking

Each January transaction is a unit vector. Cosine similarity is taken against six fraud-type prototypes and a normal-spending prototype built from 5,000 ordinary examples. Margin is the best fraud similarity minus the normal similarity. The score ranks a charge. It does not create a flag. A person confirms a row before it is exported.

| Check | Result |
|---|---|
| True fraud type is the closest match | 66% |
| True fraud type is in the top 3 | 99.5% |
| Precision at margin above 0.5 | 56% |
| Recall at margin above 0.5 | 85% |
| Precision in the top ~500 of 490,407 January transactions | 100% |

Phishing and a breached online store often swap the top rank. Both look like a cardholder’s own online spree. What separates them is the delay after compromise, and that delay is not inside one transaction vector.

A margin above 0.5 is the operating point used by the triage queue. It is a starting threshold. There is no live ground truth to retune it as new charges arrive.

## Confirmed fraud in the generator book

2,144 events, 51,833 fraud transactions, $10,979,191 total loss.

Delay is days from compromise to the first fraud charge. Duration is inclusive days from the first fraud charge to the last.

| Behaviour | Entered by | Events | Median delay (days) | Median duration (days) | Loss per event | Total loss |
|---|---|---:|---:|---:|---:|---:|
| Phishing (fake site) | Cardholder | 599 | 1 | 4 | $6,485 | $4,336,719 |
| Breached online store | Cardholder | 399 | 50 | 5 | $7,336 | $3,119,572 |
| Skimmer (cloned card) | Cardholder | 326 | 12 | 4 | $5,074 | $1,870,196 |
| Rogue employee | Another person | 190 | 8 | 5 | $3,313 | $706,441 |
| Lost or stolen card | Another person | 287 | 0 | 3 | $1,810 | $569,576 |
| Friendly or family | Another person | 343 | 0 | 29 | $1,091 | $376,687 |

## Prototype example counts

Transactions used to build each signature in `data/neo4j_export/s1/fraud_type_prototypes.json`. These are not the event counts above.

| Signature | Examples |
|---|---:|
| Normal spending | 5,000 |
| Breached online store | 657 |
| Skimmer (cloned card) | 408 |
| Phishing (fake site) | 378 |
| Friendly or family | 337 |
| Lost or stolen card | 133 |
| Rogue employee | 131 |

## Where to open it

- Desk: http://35.200.168.106:8443/
- Scan API: `POST http://35.200.168.106:8443/api/scan`
- GitHub: https://github.com/DD199427/Behaviour_ui

The public address serves the Next.js desk in `nonfraud-desk/`. The Streamlit screens in the deck are the app on `main`.
