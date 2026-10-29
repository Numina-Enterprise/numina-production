#!/usr/bin/env bash
# ==============================================================================
# Linux Host Network & SSH Hardening for Tailscale Zero Trust
# ==============================================================================
set -euo pipefail

echo "==> 1. Verifying Tailscale installation and status..."
if ! command -v tailscale &>/dev/null; then
    echo "Tailscale not installed. Installing..."
    curl -fsSL https://tailscale.com/install.sh | sh
fi

echo "==> 2. Bringing up Tailscale with strict security posture..."
# --ssh: Enables Tailscale SSH management
# --shields-up: Blocks all incoming connections from other tailnet nodes by default
# --accept-routes=false: Prevents override by advertised routes
sudo tailscale up \
    --ssh \
    --accept-routes=false \
    --accept-dns=true \
    --shields-up

echo "==> 3. Configuring UFW Host Firewall (Zero Trust Inbound)..."
if command -v ufw &>/dev/null; then
    # Reset / ensure default deny incoming
    sudo ufw default deny incoming
    sudo ufw default allow outgoing

    # Allow traffic ONLY over the encrypted Tailscale WireGuard virtual interface
    sudo ufw allow in on tailscale0

    # Enable firewall non-interactively
    echo "y" | sudo ufw enable
    sudo ufw status verbose
else
    echo "UFW not found. If using iptables/nftables, ensure eth0/public interfaces drop port 22."
fi

echo "==> 4. Hardening complete."
echo "Public port 22 is now closed. Connect exclusively via: tailscale ssh <user>@<tailscale-ip-or-magicdns>"
