# Deployment Guide (Ubuntu 24.04 + Docker Compose)

This guide gives you a clean production setup for your hackathon demo and a path to basic CI/CD.

## 1) Recommended architecture

- `backend` container: FastAPI + WebSocket API on internal port `8000`
- `web` container: Nginx serving React build and proxying `/api` + `/ws` to backend
- `caddy` container: TLS termination on `:80/:443` with automatic Let's Encrypt certs for `vialive.libreuni.com`
- `docker-compose.yml` orchestrates all services

## 2) One-time server setup (fresh Ubuntu)

```bash
sudo apt update
sudo apt install -y ca-certificates curl git ufw

# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# Optional firewall (allow web + ssh)
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

## 3) Clone project and prepare secrets

```bash
git clone <YOUR_REPO_URL> app
cd app
cp backend/.env.example backend/.env
nano backend/.env
```

Set at minimum:

- `GEMINI_API_KEY`
- `GEMINI_MODEL` (default is fine)
- `ALLOWED_ORIGINS` (comma-separated, set to `https://vialive.libreuni.com`)

Optional fallback provider:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_BASE_URL`

> Do not commit `backend/.env`.

## 4) Start the app

```bash
docker compose up -d --build
```

Check status:

```bash
docker compose ps
docker compose logs -f --tail=100
```

At this stage the app is live on `http://SERVER_IP`.

For this repository's production domain, it should become available on:

- `https://vialive.libreuni.com`

## 5) Enable HTTPS (required for reliable WebRTC in real browsers)

HTTPS is now handled directly by Docker via Caddy.

Prerequisites:

- DNS `A`/`AAAA` for `vialive.libreuni.com` points to this server
- Ports `80` and `443` are open in cloud firewall + `ufw`

How it works:

- Caddy reads [deploy/Caddyfile](deploy/Caddyfile)
- Caddy automatically obtains/renews certificates from Let's Encrypt
- Caddy reverse-proxies HTTPS traffic to the internal `web` container

Validate after deploy:

```bash
docker compose ps
docker compose logs -f --tail=100 caddy
```

You should see certificate provisioning logs and successful HTTPS startup.

## 6) Updating deploys manually

```bash
git pull
docker compose up -d --build
```

One-command option (recommended after this update):

```bash
./scripts/deploy-update.sh
```

Optional alias (if `make` is installed):

```bash
make deploy-update
```

If you use VS Code on the server, run task: **Server: Pull + Rebuild + Up**.

## 7) Basic CI/CD (GitHub Actions)

A starter workflow is included at [.github/workflows/deploy.yml](.github/workflows/deploy.yml).

It does:

1. Backend syntax check
2. Frontend production build
3. SSH to server and run `git reset --hard origin/main`
4. Write `backend/.env` from GitHub secret
5. `docker compose up -d --build`

Required GitHub repository secrets:

- `SSH_HOST`
- `SSH_PORT` (usually `22`)
- `SSH_USER`
- `SSH_PRIVATE_KEY`
- `DEPLOY_PATH` (example: `/home/ubuntu/app`)
- `BACKEND_ENV_FILE` (full multi-line contents of `backend/.env`)

## 8) Secret handling best practices

- Keep real secrets only in:
  - server file: `backend/.env`, and/or
  - GitHub Actions secrets
- Keep `.env.example` with empty placeholders only
- Rotate keys immediately if leaked
- Avoid printing secrets in CI logs

## 9) Demo-day quick checklist

- DNS points to server
- HTTPS certificate valid
- `ALLOWED_ORIGINS=https://vialive.libreuni.com`
- `docker compose ps` shows both services healthy/running
- Run a full browser test with 1 teacher + 1 student on separate devices/networks
