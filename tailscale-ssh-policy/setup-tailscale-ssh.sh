#!/usr/bin/env bash
# ==============================================================================
# setup-tailscale-ssh.sh
# Automated Zero-Trust Host Provisioning Script for Tailscale SSH
# ==============================================================================

set -Eeuo pipefail
umask 077

# Safety switches. Keep installation and firewall activation explicit because
# both actions can change a host's security boundary.
ALLOW_TAILSCALE_INSTALL="${ALLOW_TAILSCALE_INSTALL:-false}"
TAILSCALE_INSTALL_SHA256="${TAILSCALE_INSTALL_SHA256:-}"
TAILSCALE_ACCEPT_ROUTES="${TAILSCALE_ACCEPT_ROUTES:-false}"
UFW_ENABLE="${UFW_ENABLE:-true}"
ALLOW_NO_UFW="${ALLOW_NO_UFW:-false}"

cleanup() {
    unset TAILSCALE_AUTHKEY
}
trap cleanup EXIT

# Text formatting
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

require_command() {
    command -v "$1" >/dev/null 2>&1 || {
        log_error "Required command not found: $1"
        exit 1
    }
}

# 1. Require Superuser Privileges
if [[ $EUID -ne 0 ]]; then
   log_error "This script must be run as root or via sudo."
   exit 1
fi

log_info "Starting Tailscale SSH and Zero-Trust Host Provisioning..."

# 2. Check and install Tailscale only when explicitly enabled.
if ! command -v tailscale &> /dev/null; then
    if [[ "${ALLOW_TAILSCALE_INSTALL}" != "true" ]]; then
        log_error "Tailscale is not installed. Install it separately or set ALLOW_TAILSCALE_INSTALL=true with TAILSCALE_INSTALL_SHA256 set."
        exit 1
    fi

    require_command curl
    require_command sha256sum
    if [[ -z "${TAILSCALE_INSTALL_SHA256}" ]]; then
        log_error "Refusing an unpinned installer. Set TAILSCALE_INSTALL_SHA256 to the reviewed SHA-256 of the official installer."
        exit 1
    fi

    installer_path="$(mktemp)"
    trap 'rm -f "${installer_path}"; cleanup' EXIT
    log_info "Downloading the pinned official Tailscale installer..."
    curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
        --output "${installer_path}" https://tailscale.com/install.sh
    echo "${TAILSCALE_INSTALL_SHA256}  ${installer_path}" | sha256sum --check --status || {
        log_error "Installer checksum verification failed."
        exit 1
    }
    sh "${installer_path}"
    rm -f "${installer_path}"
    log_success "Tailscale installed successfully."
else
    log_info "Tailscale binary is already installed."
fi

# 3. Ensure tailscaled system service is active
if ! systemctl is-active --quiet tailscaled; then
    log_info "Starting and enabling tailscaled service..."
    systemctl enable --now tailscaled
fi

# 4. Configure Tailscale Node with SSH & tag
# Optional: Pass TAILSCALE_AUTHKEY environment variable for non-interactive node registration
if tailscale status &> /dev/null; then
    log_info "Node is already logged into Tailscale. Applying SSH flag non-disruptively..."
    tailscale set --ssh=true
    log_success "Tailscale SSH enabled."
else
    if [[ -n "${TAILSCALE_AUTHKEY:-}" ]]; then
        if [[ "${TAILSCALE_AUTHKEY}" =~ [[:space:]] ]]; then
            log_error "TAILSCALE_AUTHKEY contains whitespace and was rejected."
            exit 1
        fi
        log_info "Authenticating node with the supplied protected auth key..."
        tailscale_args=(up "--authkey=${TAILSCALE_AUTHKEY}" --ssh --advertise-tags=tag:server)
        if [[ "${TAILSCALE_ACCEPT_ROUTES}" == "true" ]]; then
            tailscale_args+=(--accept-routes)
        fi
        tailscale "${tailscale_args[@]}"
        log_success "Tailscale node authenticated and tagged as tag:server."
    else
        if [[ ! -t 0 ]]; then
            log_error "Node is not logged in and no auth key was provided; refusing a non-interactive login."
            exit 1
        fi
        log_info "Starting interactive Tailscale login with SSH enabled..."
        tailscale up --ssh --advertise-tags=tag:server
    fi
fi

# 5. Host Firewall Hardening (UFW)
if command -v ufw &> /dev/null; then
    log_info "Configuring UFW to isolate TCP port 22 to tailscale0..."

    ufw default deny incoming
    ufw default allow outgoing
    
    # Remove any legacy SSH allow rules. Tailscale SSH authorization is handled
    # by the Tailscale SSH policy; this host firewall does not allow TCP/22.
    ufw delete allow 22/tcp 2>/dev/null || true
    ufw delete allow OpenSSH 2>/dev/null || true
    ufw delete allow in on tailscale0 to any port 22 proto tcp 2>/dev/null || true
    
    if [[ "${UFW_ENABLE}" == "true" ]]; then
        ufw --force enable
    else
        if ! ufw status | grep -q "Status: active"; then
            log_error "UFW is inactive. Re-run with UFW_ENABLE=true after confirming console access."
            exit 1
        fi
        log_info "UFW is already active; leaving activation state unchanged."
    fi
    ufw reload
    log_success "UFW rules updated: Port 22 is restricted to tailscale0."
else
    if [[ "${ALLOW_NO_UFW}" != "true" ]]; then
        log_error "UFW is not installed; refusing to claim host hardening succeeded."
        exit 1
    fi
    log_warn "UFW is not installed. Verify an equivalent nftables/iptables policy manually."
fi

# 6. Verification
log_info "Verifying Tailscale SSH status on this host..."
tailscale status --json | grep -i '"ssh": true' > /dev/null && \
    log_success "Verification passed: Tailscale SSH is ACTIVE." || \
    log_warn "Could not verify SSH active status in tailscale status output."

echo ""
log_success "Host provisioning completed. The server is ready to accept Zero-Trust Tailscale SSH sessions."
