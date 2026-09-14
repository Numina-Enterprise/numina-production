#!/usr/bin/env bash
# Run in the selected GPU-enabled Ubuntu host, after setup-nvidia-container.sh.
set -euo pipefail
set +x
umask 077
stage=${1:-check}
case "$stage" in check|pull|profiles|start) ;; *) echo 'Usage: start-nvidia-nim.sh check|pull|profiles|start' >&2; exit 2 ;; esac
command -v podman >/dev/null
command -v nvidia-ctk >/dev/null
nvidia-ctk cdi list
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
if [[ $stage == check ]]; then
  printf '%s\n' 'Host tools detected. Registry, image, model readiness and entitlement are separate checks.'
  exit 0
fi
# Resolve the candidate in NVIDIA's registry, then supply its reviewed digest.
if [[ ! ${NUMINA_NIM_IMAGE:-} =~ ^nvcr\.io/nim/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]]; then
  echo 'NUMINA_NIM_IMAGE must name an immutable nvcr.io/nim image digest.' >&2; exit 2
fi
if [[ $stage == start && ! ${NIM_MODEL_PROFILE:-} =~ ^[a-f0-9]{64}$ ]]; then
  echo 'Select the exact supported NIM_MODEL_PROFILE from the profiles stage.' >&2; exit 2
fi
if [[ -z ${NGC_API_KEY:-} ]]; then
  read -r -s -p 'NGC API key (hidden): ' NGC_API_KEY
  printf '\n'
fi
[[ -n $NGC_API_KEY ]] || { echo 'An authenticated NGC API key is required.' >&2; exit 2; }
export NGC_API_KEY
# Do not persist registry credentials in the host default auth file.
numinaAuthDir=$(mktemp -d -t numina-ngc.XXXXXXXX)
trap 'rm -f -- "$numinaAuthDir/auth.json"; rmdir -- "$numinaAuthDir"' EXIT
printf '%s' "$NGC_API_KEY" | podman login --authfile "$numinaAuthDir/auth.json" --username '$oauthtoken' --password-stdin nvcr.io
podman pull --authfile "$numinaAuthDir/auth.json" "$NUMINA_NIM_IMAGE"
if [[ $stage == pull ]]; then
  podman image inspect --format '{{.Digest}}' "$NUMINA_NIM_IMAGE"
  exit 0
fi
if [[ $stage == profiles ]]; then
  podman run --rm --pull=never --device nvidia.com/gpu=all --env NGC_API_KEY "$NUMINA_NIM_IMAGE" list-model-profiles
  exit 0
fi
# No --replace: an existing container must be reviewed, never silently replaced.
# This is a local model service. Public exposure belongs behind an authorized
# TLS gateway after NVIDIA entitlement and tenant controls are independently verified.
podman volume create numina-nim-cache >/dev/null
podman run --detach --name numina-nim --pull=never --restart unless-stopped \
  --device nvidia.com/gpu=all --shm-size=16g \
  --publish 127.0.0.1:8000:8000 \
  --env NGC_API_KEY --env NIM_MODEL_PROFILE \
  --env NIM_RELAX_MEM_CONSTRAINTS=1 \
  --volume numina-nim-cache:/opt/nim/.cache \
  "$NUMINA_NIM_IMAGE"
unset NGC_API_KEY
printf '%s\n' 'Container start requested on loopback. Run verify-nvidia-nim.mjs when model initialization finishes; startup alone does not establish readiness or public-service entitlement.'
