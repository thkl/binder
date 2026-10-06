#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export CI=true

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ "$node_major" != "24" ]]; then
  printf 'This workflow requires Node.js 24; found %s.\n' "$(node --version)" >&2
  exit 1
fi

pnpm_run() {
  corepack pnpm@11.21.0 "$@"
}

run_step() {
  local description="$1"
  shift
  printf '\n==> %s\n' "$description"
  "$@"
}

run_step 'Install dependencies' pnpm_run install --frozen-lockfile
run_step 'Check source formatting' pnpm_run run format:check
run_step 'Check settings translations' pnpm_run run check:settings-i18n
run_step 'Build shared contracts' pnpm_run --filter @binder/common build
run_step 'Build API' pnpm_run --filter @binder/api build
run_step 'Build worker' pnpm_run --filter @binder/worker build
run_step 'Build Angular client' bash -c 'cd packages/client && ./node_modules/.bin/ng build'
run_step 'Run type checks' pnpm_run run typecheck
run_step 'Run API security tests' pnpm_run --filter @binder/api test
run_step 'Run workspace tests with coverage' pnpm_run run coverage
run_step 'Audit production dependencies' pnpm_run audit --prod --audit-level=high

printf '\nSecurity workflow verification passed.\n'
