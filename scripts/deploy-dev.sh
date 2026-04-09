#!/usr/bin/env bash
# Deploy the 'dev' branch to dev.vialive.libreuni.com
# Called by CI on push to the 'dev' branch.
# Server setup (one-time):
#   cd /home/deploy/apps && git clone <repo> app-dev && cd app-dev && git checkout dev
set -ex

echo "=== DEPLOY-DEV START: $(date) ===" >> /tmp/deploy_debug.log

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

read_env_value() {
  local key="$1"
  local file="$2"
  local line
  local value
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi
  value="${line#*=}"

  if [[ "$value" =~ ^\".*\"$ ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" =~ ^\'.*\'$ ]]; then
    value="${value:1:${#value}-2}"
  fi

  printf '%s' "$value"
}

# Load VITE_GOOGLE_CLIENT_ID from backend/.env for the frontend build arg.
if [[ -z "${VITE_GOOGLE_CLIENT_ID:-}" && -f "$REPO_ROOT/backend/.env" ]]; then
  google_client_id="$(read_env_value "VITE_GOOGLE_CLIENT_ID" "$REPO_ROOT/backend/.env" || true)"
  if [[ -n "$google_client_id" ]]; then
    export VITE_GOOGLE_CLIENT_ID="$google_client_id"
  fi
fi

# Load VITE_RTC_ICE_SERVERS (explicit value takes priority).
if [[ -z "${VITE_RTC_ICE_SERVERS:-}" && -f "$REPO_ROOT/backend/.env" ]]; then
  rtc_value="$(read_env_value "VITE_RTC_ICE_SERVERS" "$REPO_ROOT/backend/.env" || true)"
  if [[ -n "$rtc_value" ]]; then
    export VITE_RTC_ICE_SERVERS="$rtc_value"
  fi
fi

# Build ICE config from TURN vars if still not set.
if [[ -z "${VITE_RTC_ICE_SERVERS:-}" && -f "$REPO_ROOT/backend/.env" ]]; then
  turn_host="$(read_env_value "TURN_PUBLIC_HOST" "$REPO_ROOT/backend/.env" || true)"
  turn_user="$(read_env_value "TURN_USERNAME" "$REPO_ROOT/backend/.env" || true)"
  turn_pass="$(read_env_value "TURN_PASSWORD" "$REPO_ROOT/backend/.env" || true)"

  if [[ -z "$turn_host" ]]; then
    turn_host="vialive.libreuni.com"
  fi

  if [[ -n "$turn_user" && -n "$turn_pass" ]]; then
    export VITE_RTC_ICE_SERVERS="[{\"urls\":\"stun:stun.l.google.com:19302\"},{\"urls\":\"turn:${turn_host}:3478?transport=udp\",\"username\":\"${turn_user}\",\"credential\":\"${turn_pass}\"},{\"urls\":\"turn:${turn_host}:3478?transport=tcp\",\"username\":\"${turn_user}\",\"credential\":\"${turn_pass}\"}]"
  fi
fi

if [[ -z "${VITE_RTC_ICE_SERVERS:-}" ]]; then
  echo "[deploy-dev] WARNING: VITE_RTC_ICE_SERVERS is empty." >> /tmp/deploy_debug.log
fi

if [[ -z "${EXTERNAL_IP:-}" && -f "$REPO_ROOT/backend/.env" ]]; then
  external_ip="$(read_env_value "EXTERNAL_IP" "$REPO_ROOT/backend/.env" || true)"
  if [[ -n "$external_ip" ]]; then
    export EXTERNAL_IP="$external_ip"
  fi
fi

if ! git diff --quiet -- . ":(exclude)backend/.env"; then
  git reset --hard HEAD
fi

git pull --ff-only

export VITE_APP_VERSION="$(git rev-parse --short HEAD) · $(git log -1 --format=%cd --date=short)"

docker compose -f docker-compose.dev.yml -p app-dev up -d --build > /tmp/docker_deploy_dev.log 2>&1

echo "=== DEPLOY-DEV END: $(date) ===" >> /tmp/deploy_debug.log
