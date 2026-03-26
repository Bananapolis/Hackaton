#!/usr/bin/env bash
set -ex

echo "=== DEPLOY START: $(date) ===" >> /tmp/deploy_debug.log

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

  # Accept both quoted and unquoted KEY=value lines.
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

# Load deploy-time frontend build args from backend/.env when not exported in shell.
if [[ -z "${VITE_RTC_ICE_SERVERS:-}" && -f "$REPO_ROOT/backend/.env" ]]; then
  rtc_value="$(read_env_value "VITE_RTC_ICE_SERVERS" "$REPO_ROOT/backend/.env" || true)"
  if [[ -n "$rtc_value" ]]; then
    export VITE_RTC_ICE_SERVERS="$rtc_value"
  fi
fi

# If no explicit ICE config is provided, build one from self-hosted TURN vars.
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

# Export TURN runtime vars for docker-compose interpolation when available.
if [[ -f "$REPO_ROOT/backend/.env" ]]; then
  if [[ -z "${TURN_REALM:-}" ]]; then
    turn_realm="$(read_env_value "TURN_REALM" "$REPO_ROOT/backend/.env" || true)"
    if [[ -n "$turn_realm" ]]; then
      export TURN_REALM="$turn_realm"
    fi
  fi

  if [[ -z "${TURN_USERNAME:-}" ]]; then
    turn_user="$(read_env_value "TURN_USERNAME" "$REPO_ROOT/backend/.env" || true)"
    if [[ -n "$turn_user" ]]; then
      export TURN_USERNAME="$turn_user"
    fi
  fi

  if [[ -z "${TURN_PASSWORD:-}" ]]; then
    turn_pass="$(read_env_value "TURN_PASSWORD" "$REPO_ROOT/backend/.env" || true)"
    if [[ -n "$turn_pass" ]]; then
      export TURN_PASSWORD="$turn_pass"
    fi
  fi

  if [[ -z "${TURN_MIN_PORT:-}" ]]; then
    turn_min_port="$(read_env_value "TURN_MIN_PORT" "$REPO_ROOT/backend/.env" || true)"
    if [[ -n "$turn_min_port" ]]; then
      export TURN_MIN_PORT="$turn_min_port"
    fi
  fi

  if [[ -z "${TURN_MAX_PORT:-}" ]]; then
    turn_max_port="$(read_env_value "TURN_MAX_PORT" "$REPO_ROOT/backend/.env" || true)"
    if [[ -n "$turn_max_port" ]]; then
      export TURN_MAX_PORT="$turn_max_port"
    fi
  fi
fi

if [[ -z "${VITE_RTC_ICE_SERVERS:-}" ]]; then
  echo "[deploy] WARNING: VITE_RTC_ICE_SERVERS is empty. WebRTC will run STUN-only and may fail across different networks/devices." >> /tmp/deploy_debug.log
else
  echo "[deploy] VITE_RTC_ICE_SERVERS detected for frontend build args." >> /tmp/deploy_debug.log
fi

if ! git diff --quiet -- . ":(exclude)backend/.env"; then
  git reset --hard HEAD
fi

git pull --ff-only

export VITE_APP_VERSION="$(git rev-parse --short HEAD) · $(git log -1 --format=%cd --date=short)"

# Redirect docker compose output to prevent hanging SSH sessions.
docker compose up -d --build > /tmp/docker_deploy.log 2>&1

echo "=== DEPLOY END: $(date) ===" >> /tmp/deploy_debug.log
