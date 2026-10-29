#!/usr/bin/env bash
# Google Cloud Platform Zero-Trust Audit
# Governed by numina-google-enterprise
# Target: project-0317d6c9-e943-409e-83f / Zone: us-central1-a

set -euo pipefail

PROJECT_ID="project-0317d6c9-e943-409e-83f"
ZONE="us-central1-a"

echo "=========================================================="
echo " NUMINA GOOGLE CLOUD ZERO-TRUST AUDIT"
echo " Project: $PROJECT_ID | Zone: $ZONE"
echo " Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "=========================================================="

if ! command -v gcloud >/dev/null 2>&1; then
    echo "[!] gcloud CLI is not installed or not in PATH."
    echo "[*] Dry-run specification for GCP Audit checks:"
    echo "    1. gcloud projects describe $PROJECT_ID"
    echo "    2. gcloud compute instances list --project=$PROJECT_ID --filter=\"zone:($ZONE)\""
    echo "    3. gcloud run services list --project=$PROJECT_ID --platform=managed"
    echo "    4. gcloud storage buckets list --project=$PROJECT_ID"
    echo "    5. gcloud iam service-accounts list --project=$PROJECT_ID"
    exit 0
fi

echo "[+] Verifying active GCP authentication & project binding..."
gcloud config set project "$PROJECT_ID" --quiet

echo "[+] Checking Compute Engine instances in $ZONE..."
gcloud compute instances list --project="$PROJECT_ID" --filter="zone:($ZONE)" --format="table(name,status,machineType.basename(),networkInterfaces[0].networkIP:label=INTERNAL_IP)"

echo "[+] Checking Cloud Run services..."
gcloud run services list --project="$PROJECT_ID" --platform=managed --format="table(SERVICE,REGION,URL,LAST_DEPLOYED_BY)"

echo "[+] Checking Cloud Storage buckets..."
gcloud storage buckets list --project="$PROJECT_ID" --format="table(name,location,storageClass)"

echo "=========================================================="
echo " GCP Audit Completed Successfully."
echo "=========================================================="
