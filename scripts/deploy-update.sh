#!/usr/bin/env bash
set -ex

echo "=== DEPLOY START: $(date) ===" >> /tmp/deploy_debug.log

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! git diff --quiet -- . ':!backend/.env'; then
  git reset --hard HEAD
fi

git pull --ff-only

# redirecting docker compose to prevent hanging ssh sessions
docker compose up -d --build > /tmp/docker_deploy.log 2>&1

echo "=== DEPLOY END: $(date) ===" >> /tmp/deploy_debug.log
