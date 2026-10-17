# Behaviour UI — builds and runs as-is via: gcloud run deploy --source .
# The small bundled dataset (behaviour-ui/data/, ~88 MB) ships inside this image, so the app works
# immediately with no external storage required. See deploy/DEPLOY.md for what that does and
# doesn't include, and how to add the full ~8 GB raw dataset and persistent flag storage later.
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Cloud Run sets $PORT; default to 8080 for local `docker run`
ENV PORT=8080
EXPOSE 8080

# headless + no CORS/XSRF browser checks (Cloud Run sits behind its own HTTPS proxy)
CMD streamlit run app.py \
    --server.port=${PORT} --server.address=0.0.0.0 --server.headless=true \
    --server.enableCORS=false --server.enableXsrfProtection=false
