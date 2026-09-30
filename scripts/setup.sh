#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${BINDER_ENV_FILE:-$PROJECT_ROOT/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$PROJECT_ROOT/docker-compose.yml}"

usage() {
  cat <<'EOF'
Usage: ./scripts/setup.sh [docker compose command ...]

Without arguments, generates missing bootstrap secrets, builds the images,
and starts the Binder Compose stack in the background.

Environment:
  BINDER_ENV_FILE   Environment file to create/use (default: .env)
  COMPOSE_FILE      Compose file to use (default: docker-compose.yml)

Examples:
  ./scripts/setup.sh
  ./scripts/setup.sh up -d
  ./scripts/setup.sh logs -f api
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if ! command -v openssl >/dev/null 2>&1; then
  printf 'error: openssl is required to generate bootstrap secrets\n' >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  printf 'error: docker is required to start the Compose stack\n' >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  printf 'error: Docker Compose v2 is required\n' >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ ! -f "$PROJECT_ROOT/.env.example" ]]; then
    printf 'error: environment template not found: %s\n' "$PROJECT_ROOT/.env.example" >&2
    exit 1
  fi

  cp "$PROJECT_ROOT/.env.example" "$ENV_FILE"
  printf 'Created %s from .env.example\n' "$ENV_FILE"
else
  printf 'Using existing environment file %s\n' "$ENV_FILE"
fi

read_env_value() {
  local key="$1"

  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE"
}

is_placeholder() {
  case "$1" in
    ''|replace-with-*|\<*\>) return 0 ;;
    *) return 1 ;;
  esac
}

set_env_value() {
  local key="$1"
  local value="$2"
  local temporary_path

  temporary_path="$(mktemp "${TMPDIR:-/tmp}/binder-env.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    index($0, key "=") == 1 {
      print key "=" value
      replaced = 1
      next
    }
    { print }
    END {
      if (!replaced) print key "=" value
    }
  ' "$ENV_FILE" > "$temporary_path"
  mv "$temporary_path" "$ENV_FILE"
}

ensure_secret() {
  local key="$1"
  local value="$2"
  local current_value

  current_value="$(read_env_value "$key" || true)"
  if is_placeholder "$current_value"; then
    set_env_value "$key" "$value"
    printf 'Generated %s\n' "$key"
  else
    printf 'Preserved configured %s\n' "$key"
  fi
}

ensure_secret DATABASE_PASSWORD "$(openssl rand -hex 32)"
ensure_secret ENCRYPTION_KEY "$(openssl rand -base64 32 | tr -d '\r\n')"
ensure_secret SESSION_SECRET "$(openssl rand -hex 48)"
ensure_secret SETUP_SECRET "$(openssl rand -hex 48)"

chmod 600 "$ENV_FILE"
printf 'Protected %s with mode 600\n' "$ENV_FILE"

compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

run_compose() {
  BINDER_ENV_FILE="$ENV_FILE" "${compose[@]}" "$@"
}

run_compose config --quiet

if [[ "$#" -eq 0 ]]; then
  run_compose build
  run_compose up -d
else
  run_compose "$@"
fi

printf '\nBinder is running. The first administrator can be created through the onboarding screen.\n'
