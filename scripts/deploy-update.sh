#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required but not installed." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but not installed." >&2
  exit 1
fi

if ! git diff --quiet -- . ':!backend/.env'; then
  echo "[deploy] Local tracked changes detected. Discarding tracked changes on server..."
  git reset --hard HEAD
fi

echo "[deploy] Pulling latest code (fast-forward only)..."
git pull --ff-only

echo "[deploy] Rebuilding and restarting containers..."
docker compose up -d --build

echo "[deploy] Current service status:"
docker compose ps
