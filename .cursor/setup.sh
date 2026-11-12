#!/usr/bin/env bash
# Cursor cloud-agent setup.
# Confirms Node matches .nvmrc, then runs npm ci when a root lockfile exists.
# npm ci does not rewrite package-lock.json. npm install is never used.
# Writes a timestamped log to .cursor/logs/ and exits non-zero on failure.
# Does not print the environment, npm config, or secret files.
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$root"

mkdir -p .cursor/logs
log=".cursor/logs/setup-$(date -u +%Y%m%dT%H%M%SZ).log"

fail() {
  printf 'event=setup_failed code=%s\n' "$1"
  exit 1
}

main() {
  set -euo pipefail

  printf 'event=setup_start utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  if [[ ! -f .nvmrc ]]; then
    fail NVMRC_REQUIRED
  fi
  version="$(tr -d '[:space:]' < .nvmrc)"
  if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
    fail NVMRC_INVALID
  fi
  if ! command -v node >/dev/null 2>&1; then
    fail NODE_REQUIRED
  fi

  actual="$(node -p 'process.versions.node')"
  bundled_openssl="$(node -p 'process.versions.openssl')"
  if [[ "$actual" != "$version" ]]; then
    printf 'event=setup_failed code=NODE_VERSION_MISMATCH expected=%s actual=%s\n' "$version" "$actual"
    exit 1
  fi
  printf 'event=node_ok version=%s openssl=%s\n' "$actual" "$bundled_openssl"

  mapfile -t foreign_lockfiles < <(find . -type f \
    \( -name pnpm-lock.yaml -o -name yarn.lock -o -name bun.lock -o -name bun.lockb \) \
    -not -path './.git/*' -not -path './node_modules/*')
  if ((${#foreign_lockfiles[@]} > 0)); then
    fail UNEXPECTED_LOCKFILE
  fi

  mapfile -t npm_lockfiles < <(find . -type f -name package-lock.json \
    -not -path './.git/*' -not -path './node_modules/*')
  if ((${#npm_lockfiles[@]} == 0)); then
    fail PACKAGE_MANAGER_UNKNOWN
  fi
  printf 'event=package_manager manager=npm lockfile_count=%s\n' "${#npm_lockfiles[@]}"

  install_command='npm ci --ignore-scripts --no-audit --no-fund'
  if [[ -f package-lock.json ]]; then
    printf 'event=install_start manager=npm command=%s\n' "$install_command"
    npm ci --ignore-scripts --no-audit --no-fund
    printf 'event=install_ok manager=npm\n'
  else
    dependency_keys="$(node --input-type=module -e 'import {readFileSync} from "node:fs"; const pkg=JSON.parse(readFileSync("package.json","utf8")); const names=["dependencies","devDependencies","optionalDependencies"].filter((key)=>pkg[key]&&typeof pkg[key]==="object"&&Object.keys(pkg[key]).length); process.stdout.write(names.join(","));')"
    if [[ -n "$dependency_keys" ]]; then
      fail PACKAGE_LOCK_REQUIRED
    fi
    printf 'event=install_skipped manager=npm reason=no_root_dependencies_and_no_root_lockfile command=%s\n' "$install_command"
  fi

  printf 'event=setup_ok utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

set +e
main >"$log" 2>&1
status=$?
cat "$log"
exit "$status"
