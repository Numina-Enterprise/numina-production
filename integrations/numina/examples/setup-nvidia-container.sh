#!/usr/bin/env bash
set -euo pipefail
if [[ ${EUID} -ne 0 ]]; then echo 'Run inside the selected Ubuntu WSL distribution as root.' >&2; exit 1; fi
source /etc/os-release
if [[ ${ID} != ubuntu || ${VERSION_ID} != 24.04 ]]; then echo 'This bootstrap targets Ubuntu 24.04.' >&2; exit 1; fi
# Use the Windows NVIDIA driver exposed through WSL; do not install a Linux GPU driver.
apt-get update
apt-get install -y podman gcc curl ca-certificates gnupg
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey -o /tmp/numina-nvidia-container-key.asc
gpg --batch --yes --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg /tmp/numina-nvidia-container-key.asc
curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list -o /tmp/numina-nvidia-container-toolkit.list
sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' /tmp/numina-nvidia-container-toolkit.list > /etc/apt/sources.list.d/nvidia-container-toolkit.list
apt-get update
apt-get install -y nvidia-container-toolkit
mkdir -p /etc/cdi
nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml
nvidia-ctk cdi list
podman --version
printf '%s\n' 'Container prerequisites installed. No model or inference service has been started.'
