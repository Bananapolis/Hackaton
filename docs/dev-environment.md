# Dev Environment

Staging runs at `dev.vialive.libreuni.com`, deployed automatically when pushing to the `dev` branch.

## Branch → URL mapping

| Branch | URL | When to use |
|--------|-----|-------------|
| `dev`  | `dev.vialive.libreuni.com` | Test changes before merging to production |
| `main` | `vialive.libreuni.com` | Production |

## Workflow

1. Work on a feature branch or directly on `dev`
2. Push to `dev` → CI runs tests → if they pass, deploys to `dev.vialive.libreuni.com`
3. Verify everything works on the staging URL
4. Merge `dev` → `main` → CI deploys to production

## Server setup (one-time)

The server needs two separate git checkouts:

```bash
cd /home/deploy/apps

# Production (already exists)
# /home/deploy/apps/app  →  main branch

# Staging (create once)
git clone <repo-url> app-dev
cd app-dev
git checkout dev
cp ../app/backend/.env backend/.env   # copy env from production
```

Make sure `dev.vialive.libreuni.com` has a DNS A record pointing to the same server IP.

## How it works

- `docker-compose.dev.yml` runs `backend-dev`, `web-dev`, and `mediamtx` containers
- Both join the shared `vialive` Docker network alongside the production stack
- Caddy (running in production) routes `dev.vialive.libreuni.com` → `web-dev:80`
- Caddy also routes `/live/*` to `mediamtx:8889` for the Android broadcaster / WHEP viewer bridge
- Dev has its own SQLite database (`backend/data-dev.sqlite3`) — separate from production

## Local development

Use VSCode tasks (Ctrl+Shift+P → "Tasks: Run Task"):

- **Dev: Setup** — install all dependencies (run once, or after pulling new deps)
- **Dev: Start** — start backend + frontend dev servers in parallel
- **Backend: Stop API** — free port 9000 if something is stuck

The frontend dev server runs at `https://localhost:5173` and proxies `/api` and `/ws` to the backend at `localhost:9000`.
