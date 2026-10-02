#!/bin/sh

# The setup script uses Bash features below, but this small POSIX wrapper also
# makes `sh scripts/setup.sh` fail gracefully instead of producing a confusing
# `pipefail` error on systems whose /bin/sh is dash.
if [ -z "${BASH_VERSION:-}" ]; then
  if command -v bash >/dev/null 2>&1; then
    exec bash "$0" "$@"
  fi

  printf '%s\n' 'error: Bash is required to run scripts/setup.sh' >&2
  exit 1
fi

set -Eeuo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${BINDER_ENV_FILE:-$PROJECT_ROOT/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$PROJECT_ROOT/docker-compose.yml}"
BINDER_VERSION="${BINDER_VERSION:-$(awk -F'"' '/"version":/ { print $4; exit }' "$PROJECT_ROOT/packages/api/package.json")}"
BINDER_VERSION="${BINDER_VERSION:-unknown}"

printf '\n========================================\n'
printf ' Installing Binder Docker version %s\n' "$BINDER_VERSION"
printf '========================================\n\n'

usage() {
  cat <<'EOF'
Usage: ./scripts/setup.sh [docker compose command ...]

Without arguments, generates missing bootstrap secrets, builds the images,
and starts the Binder Compose stack in the background.

Environment:
  BINDER_ENV_FILE   Environment file to create/use (default: .env)
  BINDER_HOST_PORT  Host port for the Binder web interface (default: 3000)
  BINDER_VERSION     Version shown in the installer banner (default: API package version)
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

discover_host_ip() {
  local host_ip
  local default_interface

  host_ip=''

  if command -v ip >/dev/null 2>&1; then
    host_ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{ for (field = 1; field <= NF; field++) if ($field == "src") { print $(field + 1); exit } }' || true)"
  fi

  if [[ -z "$host_ip" ]] && command -v route >/dev/null 2>&1; then
    default_interface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}' || true)"
    if [[ -n "$default_interface" ]] && command -v ipconfig >/dev/null 2>&1; then
      host_ip="$(ipconfig getifaddr "$default_interface" 2>/dev/null || true)"
    fi
  fi

  if [[ -z "$host_ip" ]] && command -v hostname >/dev/null 2>&1; then
    host_ip="$(hostname -I 2>/dev/null | awk '{ for (field = 1; field <= NF; field++) if ($field !~ /^127\\./ && $field !~ /:/) { print $field; exit } }' || true)"
  fi

  printf '%s' "${host_ip:-127.0.0.1}"
}

is_port_available() {
  local host_port="$1"

  if (exec 3<>"/dev/tcp/127.0.0.1/$host_port") 2>/dev/null; then
    exec 3>&-
    return 1
  fi

  return 0
}

host_port="$(read_env_value BINDER_HOST_PORT || true)"
host_port="${host_port:-3000}"
host_ip=''
if [[ "$#" -eq 0 ]]; then
  if ! [[ "$host_port" =~ ^[0-9]+$ ]] || ((host_port < 1 || host_port > 65535)); then
    printf 'error: BINDER_HOST_PORT must be a TCP port between 1 and 65535\n' >&2
    exit 1
  fi

  host_ip="$(discover_host_ip)"
  printf 'Docker host address: %s\n' "$host_ip"
  printf 'Checking host port %s... ' "$host_port"
  if is_port_available "$host_port"; then
    printf 'available\n'
  else
    printf 'in use\n' >&2
    printf 'error: host port %s is already in use; set BINDER_HOST_PORT to another port or stop the existing service\n' "$host_port" >&2
    exit 1
  fi

  configured_root_uri="$(read_env_value ROOT_URI || true)"
  if [[ -z "$configured_root_uri" || "$configured_root_uri" == "http://localhost"* || "$configured_root_uri" == "https://localhost"* || "$configured_root_uri" == "http://127.0.0.1"* || "$configured_root_uri" == "https://127.0.0.1"* ]]; then
    root_scheme='http'
    if [[ "$configured_root_uri" == https://* ]]; then
      root_scheme='https'
    fi

    configured_root_uri="${root_scheme}://${host_ip}:${host_port}"
    set_env_value ROOT_URI "$configured_root_uri"
    printf 'Configured ROOT_URI: %s\n' "$configured_root_uri"
  fi
fi

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
  setup_url="$(read_env_value ROOT_URI || true)"
  if [[ -z "$setup_url" || "$setup_url" == "http://localhost"* || "$setup_url" == "https://localhost"* || "$setup_url" == "http://127.0.0.1"* || "$setup_url" == "https://127.0.0.1"* ]]; then
    setup_url="http://${host_ip}:${host_port}"
  fi

  setup_secret="$(read_env_value SETUP_SECRET || true)"
  printf '\nBinder is running.\n'
  printf 'Open %s to complete the initial setup.\n' "$setup_url"
  printf 'One-time setup code: %s\n' "$setup_secret"
  printf 'Keep this code private. It is only required to create the first administrator.\n'
else
  run_compose "$@"
fi
