# Deploying Behaviour UI to Google Cloud Run

This repo is self-contained: the small dataset it needs (~88 MB) is already included in
`data/`, so it works immediately once deployed — no bucket, no upload, no extra setup. Expect
roughly **$0–5/month** at light usage (Cloud Run and Cloud Build both have a free tier; this app
is small and idle most of the time).

## What you get out of the box, and what you don't

| Works immediately | Needs the optional step below |
|---|---|
| Behaviour Library, Investigate & Flag (accounts/merchants/transactions already in the bundled dataset), Triage Queue, Scan a Behaviour, Review & Export | **Scan New Transactions** for accounts beyond the bundled dataset — needs the full ~8 GB raw dataset, not included here |
| | **Flags/labels surviving a restart** — Cloud Run's local disk is wiped on restart/redeploy/scale-to-zero; without the optional step, every flag you make will be gone the next time the app cold-starts |

If you just want to look around the app, skip straight to **Part 1**. If you want flags to
actually stick, or the full-dataset page to work, come back for **Part 2** afterwards.

## Prerequisites

- A GCP project with billing enabled (Cloud Console → Billing).
- The `gcloud` CLI, authenticated: `gcloud auth login`, then `gcloud config set project <YOUR_PROJECT_ID>`.
- This repo cloned locally: `git clone https://github.com/DD199427/Behaviour_ui.git && cd Behaviour_ui`

## Part 1 — Deploy (5 minutes)

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

gcloud run deploy behaviour-ui \
  --source . \
  --region us-central1 \
  --min-instances 0 \
  --max-instances 2 \
  --memory 1Gi \
  --allow-unauthenticated
```

`--source .` builds the `Dockerfile` in this repo via Cloud Build and deploys it — no local Docker
needed. Takes a few minutes the first time. It prints a URL when done; open it.

**About `--allow-unauthenticated`**: this makes the URL public — anyone who has it can open the
app, flag things, and trigger exports, with no login. The app has no authentication of its own.
The data is synthetic (Sparkov-generated, not real transactions or people), so the actual risk is
low, but it's worth knowing. For something private instead, use `--no-allow-unauthenticated` and
grant access per-person via `gcloud run services add-iam-policy-binding` — anyone opening the URL
without access then needs to authenticate with a Google account that's been granted it.

**Set a budget alert** while you're in the console: Billing → Budgets & alerts → Create budget —
$5/month is a sensible ceiling for this.

## Part 2 (optional) — persistent flags, and the full dataset

Needs a GCS bucket mounted into the Cloud Run service, since local disk doesn't survive restarts.

```bash
gsutil mb -l us-central1 gs://YOUR_BUCKET_NAME

# flags/labels: start empty, the app creates its own files here on first use
# (if you have the full ~8 GB raw dataset too, upload it under data/ in the same bucket, laid out
#  the same way as this repo's bundled data/ folder — i.e. data/customers.csv, data/*.csv per
#  profile block, data/neo4j_export/s1/... — then point BB_DATA_ROOT at data/ instead of leaving
#  it unset)

gcloud run services update behaviour-ui \
  --region us-central1 \
  --execution-environment gen2 \
  --add-volume name=bb-data,type=cloud-storage,bucket=YOUR_BUCKET_NAME \
  --add-volume-mount volume=bb-data,mount-path=/mnt/bb-data \
  --set-env-vars BB_STORE_ROOT=/mnt/bb-data/store
  # add BB_DATA_ROOT=/mnt/bb-data/data too, only if you uploaded the full dataset there
```

Give the Cloud Run service's own service account `roles/storage.objectAdmin` on the bucket, or the
mount won't be able to write:

```bash
SA=$(gcloud run services describe behaviour-ui --region us-central1 --format='value(spec.template.spec.serviceAccountName)')
gsutil iam ch serviceAccount:${SA}:roles/storage.objectAdmin gs://YOUR_BUCKET_NAME
```

**To check it's actually persisting** (not just working within one warm instance): flag something,
force a new revision (`gcloud run services update behaviour-ui --region us-central1` with any
no-op flag, or just wait for it to scale to zero from inactivity), reopen the app, and confirm the
flag is still there.

## Updating later

Any time the code changes, redeploy with the same command from Part 1 — `gcloud run deploy` on an
existing service name updates it in place rather than creating a new one.
