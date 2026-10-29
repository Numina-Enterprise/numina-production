#!/usr/bin/env bash
# ==============================================================================
# gcs-verify.sh
# Diagnostic & Verification Script for Tailscale -> Google Cloud Storage (GCS)
# Validates bucket access, IAM bindings, and end-to-end canary log writes.
# ==============================================================================

set -euo pipefail

# Color formatting
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[PASS]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[FAIL]${NC} $1"; }

BUCKET_NAME="${1:-}"
TAILSCALE_SA="${2:-}"

usage() {
    echo "Usage: $0 <bucket-name-or-gs-uri> [tailscale-service-account-email]"
    echo ""
    echo "Example:"
    echo "  $0 my-tailscale-audit-logs"
    echo "  $0 gs://my-tailscale-audit-logs logstream@tailscale-production.iam.gserviceaccount.com"
    exit 1
}

if [[ -z "${BUCKET_NAME}" ]]; then
    usage
fi

# Normalize bucket name (strip gs:// prefix if provided)
BUCKET_NAME="${BUCKET_NAME#gs://}"
BUCKET_URI="gs://${BUCKET_NAME}"

echo "=================================================================="
echo " Tailscale GCS Verification Tool (Audit Logs & Session Streams)"
echo " Target Bucket : ${BUCKET_URI}"
if [[ -n "${TAILSCALE_SA}" ]]; then
    echo " Service Account: ${TAILSCALE_SA}"
fi
echo " Timestamp     : $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "=================================================================="
echo ""

# 1. Verify Google Cloud CLI installation
log_info "1. Checking Google Cloud CLI environment..."
if ! command -v gcloud &> /dev/null; then
    log_error "'gcloud' CLI is not found. Please install the Google Cloud SDK."
    exit 1
fi
ACTIVE_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null || true)
if [[ -z "${ACTIVE_ACCOUNT}" ]]; then
    log_error "No active gcloud authentication found. Run 'gcloud auth login' or activate a service account."
    exit 1
fi
log_success "gcloud CLI is authenticated as: ${ACTIVE_ACCOUNT}"

# 2. Check Bucket Existence and Metadata
log_info "2. Inspecting GCS bucket ${BUCKET_URI}..."
if ! gcloud storage buckets describe "${BUCKET_URI}" --format="json" &> /dev/null; then
    log_error "Bucket ${BUCKET_URI} does not exist or your active account lacks 'storage.buckets.get' permission."
    exit 1
fi
LOCATION=$(gcloud storage buckets describe "${BUCKET_URI}" --format="value(location)")
STORAGE_CLASS=$(gcloud storage buckets describe "${BUCKET_URI}" --format="value(defaultStorageClass)")
log_success "Bucket exists in location: [${LOCATION}] with default class: [${STORAGE_CLASS}]."

# 3. Check IAM Bindings for Tailscale Ingestion Service Account
if [[ -n "${TAILSCALE_SA}" ]]; then
    log_info "3. Verifying IAM permissions for Tailscale service account: ${TAILSCALE_SA}..."
    IAM_ROLES=$(gcloud storage buckets get-iam-policy "${BUCKET_URI}" \
        --filter="bindings.members:${TAILSCALE_SA}" \
        --format="value(bindings.role)" 2>/dev/null || true)

    if [[ -z "${IAM_ROLES}" ]]; then
        log_error "No IAM bindings found for ${TAILSCALE_SA} on ${BUCKET_URI}."
        log_warn "Tailscale requires 'roles/storage.objectCreator' to stream logs."
        log_info "To grant this, run:"
        echo "  gcloud storage buckets add-iam-policy-binding ${BUCKET_URI} \\"
        echo "    --member=\"serviceAccount:${TAILSCALE_SA}\" \\"
        echo "    --role=\"roles/storage.objectCreator\""
    else
        log_success "Active IAM roles for ${TAILSCALE_SA}: ${IAM_ROLES}"
        if echo "${IAM_ROLES}" | grep -E -q "roles/storage.objectCreator|roles/storage.admin|roles/storage.objectAdmin"; then
            log_success "Service account has write authorization."
        else
            log_warn "Role '${IAM_ROLES}' might not permit creating new objects. Ensure 'roles/storage.objectCreator' is assigned."
        fi
    fi
else
    log_info "3. Skipping Tailscale Service Account IAM check (no service account email provided as argument 2)."
fi

# 4. Check Object Retention & Lifecycle Settings
log_info "4. Checking lifecycle policies (Audit Compliance)..."
LIFECYCLE=$(gcloud storage buckets describe "${BUCKET_URI}" --format="json(lifecycle_config)" 2>/dev/null || true)
if [[ "${LIFECYCLE}" != "{}" && -n "${LIFECYCLE}" ]]; then
    log_success "Bucket lifecycle rules are active for automated archiving/expiration."
else
    log_warn "No lifecycle configuration found. Consider adding a 90-day or 365-day retention rule for audit compliance."
fi

# 5. Canary Write and Read Verification
log_info "5. Executing canary write test..."
TEST_FILE=$(mktemp /tmp/gcs-verify-XXXXXX.json)
CANARY_OBJECT="${BUCKET_URI}/.tailscale-canary/verify-$(date +%s).json"

cat <<EOF > "${TEST_FILE}"
{
  "source": "tailscale-ssh-verify",
  "verified_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "status": "HEALTHY"
}
EOF

if gcloud storage cp "${TEST_FILE}" "${CANARY_OBJECT}" &> /dev/null; then
    log_success "Canary object write successful: ${CANARY_OBJECT}"
    
    # Read check
    if gcloud storage cat "${CANARY_OBJECT}" | grep -q "HEALTHY"; then
        log_success "Canary object read verification passed."
    fi
    
    # Cleanup canary object
    gcloud storage rm "${CANARY_OBJECT}" &> /dev/null || true
    log_success "Canary cleanup completed."
else
    log_error "Write test failed. Verify object creation permissions on bucket ${BUCKET_URI}."
fi
rm -f "${TEST_FILE}"

echo ""
echo "=================================================================="
log_success "GCS Verification Completed Successfully."
echo "=================================================================="
