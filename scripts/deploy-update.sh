#!/usr/bin/env bash
set -ex

echo "=== DEPLOY START: $(date) ===" >> /tmp/deploy_debug.log

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Load deploy-time frontend build args from backend/.env when not exported in shell.
if [[ -z "${VITE_RTC_ICE_SERVERS:-}" && -f "$REPO_ROOT/backend/.env" ]]; then
  rtc_line="$(grep -E '^VITE_RTC_ICE_SERVERS=' "$REPO_ROOT/backend/.env" | tail -n 1 || true)"
  if [[ -n "$rtc_line" ]]; then
    export VITE_RTC_ICE_SERVERS="${rtc_line#VITE_RTC_ICE_SERVERS=}"
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

# Redirect docker compose output to prevent hanging SSH sessions.
docker compose up -d --build > /tmp/docker_deploy.log 2>&1

echo "=== DEPLOY END: $(date) ===" >> /tmp/deploy_debug.log
