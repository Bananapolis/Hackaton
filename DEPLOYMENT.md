# Deployment Guide (Ubuntu 24.04 + Docker Compose)

This guide now includes a full post-compromise rebuild workflow (fresh server, security hardening, deployment, and operations) for small cloud droplets used during hackathons.

## 0) Incident response first (before reinstall/redeploy)

If the server was compromised, do this first:

- Rotate all API keys (`GEMINI_API_KEY`, `OPENAI_API_KEY`, etc.).
- Rotate Git credentials/deploy keys used on the server.
- Rotate SSH keys and remove unknown keys from `authorized_keys`.
- Rotate CI/CD secrets (`SSH_PRIVATE_KEY`, `BACKEND_ENV_FILE`, etc.).
- Assume old server secrets are leaked. Do not reuse them.

After that, continue with a fresh server and this runbook.

## 1) Recommended architecture

- `backend` container: FastAPI + WebSocket API on internal port `8000`
- `web` container: Nginx serving React build and proxying `/api` + `/ws` to backend
- `caddy` container: TLS termination on `:80/:443` with automatic Let's Encrypt certs for `vialive.libreuni.com`
- `docker-compose.yml` orchestrates all services

## 2) Fresh server bootstrap (root user)

SSH to the brand-new server as root:

```bash
ssh root@<SERVER_IP>
```

Set helper variables (optional, but keeps commands copy/paste-friendly):

```bash
export DEPLOY_USER=deploy
export DEPLOY_HOME=/home/$DEPLOY_USER
```

Create non-root deploy user and copy your SSH key access:

```bash
adduser "$DEPLOY_USER"
usermod -aG sudo "$DEPLOY_USER"

mkdir -p "$DEPLOY_HOME/.ssh"
cp /root/.ssh/authorized_keys "$DEPLOY_HOME/.ssh/authorized_keys"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
chmod 700 "$DEPLOY_HOME/.ssh"
chmod 600 "$DEPLOY_HOME/.ssh/authorized_keys"
```

### 2.1) Add swap FIRST (mandatory on small droplets)

Do this before `apt upgrade` / `apt install` to prevent OOM kills and SSH disconnects.

Use 2G swap (adjust size if needed):

```bash
sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

sudo sysctl vm.swappiness=10
sudo sysctl vm.vfs_cache_pressure=50
cat <<'EOF' | sudo tee /etc/sysctl.d/99-swap-tuning.conf
vm.swappiness=10
vm.vfs_cache_pressure=50
EOF

sudo swapon --show
free -h
```

### 2.2) Update OS + install baseline packages

```bash
sudo apt update
sudo apt -y upgrade
sudo apt install -y ca-certificates curl git ufw fail2ban unattended-upgrades apt-listchanges
```

Enable automatic security updates:

```bash
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
```

If a previous upgrade was interrupted, repair package state first:

```bash
sudo dpkg --configure -a
sudo apt -f install -y
```

### 2.3) Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $DEPLOY_USER
```

### 2.4) Firewall (allow SSH + web)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status verbose
```

### 2.5) Fail2ban (SSH brute-force protection)

```bash
cat <<'EOF' | sudo tee /etc/fail2ban/jail.local
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5
backend = systemd

[sshd]
enabled = true
port = ssh
logpath = %(sshd_log)s
EOF

sudo systemctl enable --now fail2ban
sudo fail2ban-client status
sudo fail2ban-client status sshd
```

### 2.6) SSH hardening (important)

First, open a second terminal and confirm you can login as deploy user with key:

```bash
ssh $DEPLOY_USER@<SERVER_IP>
```

Only then disable root/password logins:

```bash
cat <<'EOF' | sudo tee /etc/ssh/sshd_config.d/99-hardening.conf
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
X11Forwarding no
MaxAuthTries 3
EOF

sudo sshd -t && sudo systemctl restart ssh
```

## 3) Deploy project (deploy user)

Reconnect as deploy user:

```bash
ssh deploy@<SERVER_IP>
```

Create project directory and clone repo:

```bash
mkdir -p ~/apps
cd ~/apps
git clone <YOUR_REPO_URL> app
cd app
```

Create environment file and configure secrets:

```bash
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

### 3.1) SQLite preflight (important, prevents old folder-vs-file issue)

Before first `docker compose up`, make sure host path `backend/data.sqlite3` is a **file** (not a directory).

```bash
cd ~/apps/app

# If it is accidentally a directory, replace it with a file.
if [ -d backend/data.sqlite3 ]; then
  rm -rf backend/data.sqlite3
fi

touch backend/data.sqlite3
chmod 664 backend/data.sqlite3
sudo chown -R deploy:deploy ~/apps/app
```

## 4) Start services

```bash
cd ~/apps/app
docker compose up -d --build
```

If you get:

`permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`

your current shell likely has not picked up `docker` group membership yet. Fix it with one of these options:

```bash
# preferred: refresh group membership in current shell
newgrp docker

# then run again
cd ~/apps/app
docker compose up -d --build
```

or fully log out and back in as `deploy`, then retry. As a temporary workaround only, you can run:

```bash
sudo docker compose up -d --build
```

Check status:

```bash
docker compose ps
docker compose logs -f --tail=100
```

At this stage the app is live on `http://SERVER_IP`.

For this repository's production domain, it should become available on:

- `https://vialive.libreuni.com`

## 5) HTTPS validation (required for reliable WebRTC)

HTTPS is handled by Caddy.

Prerequisites:

- DNS `A`/`AAAA` for `vialive.libreuni.com` points to this server
- Ports `80` and `443` are open in cloud firewall + `ufw`

Validate after deploy:

```bash
docker compose ps
docker compose logs -f --tail=100 caddy
curl -I https://vialive.libreuni.com
```

You should see certificate provisioning logs and successful HTTPS startup.

If Caddy logs show ACME errors like:

- `Timeout during connect (likely firewall problem)`
- `During secondary validation ... Fetching http://vialive.libreuni.com/.well-known/acme-challenge/...`

then inbound validation from Let's Encrypt cannot reach this server on `:80` and/or `:443`.

Use this checklist:

1. Confirm DNS points to this exact server (check both `A` and `AAAA` records).
  - If you do not have working IPv6 on this host, remove the `AAAA` record.
2. Confirm cloud/provider firewall allows inbound TCP `80` and `443` (in addition to UFW).
3. Confirm `ufw status` shows `OpenSSH`, `80/tcp`, `443/tcp` as allowed.
4. If using a DNS proxy/CDN (e.g., Cloudflare orange-cloud), switch to DNS-only while issuing certs.
5. Retry after DNS/firewall fixes:
  - `docker compose restart caddy`
  - `docker compose logs -f --tail=200 caddy`

Notes:

- The `failed to sufficiently increase receive buffer size` message is usually non-fatal and not the reason cert issuance fails.
- Caddy will automatically retry ACME issuance after connectivity is fixed.
- Browser error `SSL_ERROR_INTERNAL_ERROR_ALERT` usually means Caddy has not successfully obtained a valid cert yet.
- Even if DNS was not changed recently, cert issuance can still fail after server rebuild if:
  - the server public IP changed but `A` still points elsewhere, or
  - an old `AAAA` record exists but this host has no working IPv6 path.

Quick verify commands (run on server):

```bash
curl -4 ifconfig.me; echo
dig +short A vialive.libreuni.com
dig +short AAAA vialive.libreuni.com
curl -4I http://vialive.libreuni.com
curl -4I https://vialive.libreuni.com
```

If all checks look correct but HTTPS still fails with `SSL_ERROR_INTERNAL_ERROR_ALERT`, do a clean Caddy ACME state reset:

```bash
cd ~/apps/app

# show current caddy volumes
docker volume ls | grep caddy

# stop stack and remove only caddy state volumes
docker compose down
docker volume rm app_caddy_data app_caddy_config || true

# start again and watch fresh issuance
docker compose up -d --build
docker compose logs -f --tail=300 caddy
```

Expected success logs include lines like `certificate obtained successfully` / `server is listening only on the HTTPS port` without subsequent ACME challenge errors.

If logs repeatedly fail on `challenge_type":"tls-alpn-01"` secondary validation timeout, force HTTP-01 only (port 80 challenge):

1. In [deploy/Caddyfile](deploy/Caddyfile), under `tls { ... }`, set:
  - `issuer acme { disable_tlsalpn_challenge }`
2. Redeploy Caddy:

```bash
cd ~/apps/app
docker compose up -d --build caddy
docker compose logs -f --tail=300 caddy
```

This avoids TLS-ALPN validation path issues and uses HTTP-01 only.

## 6) Day-2 operations (manual updates)

From project root on server:

```bash
cd ~/apps/app
git pull --ff-only
docker compose up -d --build
```

One-command option (recommended):

```bash
cd ~/apps/app
./scripts/deploy-update.sh
```

Optional alias (if `make` is installed):

```bash
cd ~/apps/app
make deploy-update
```

If you use VS Code on the server, run task: **Server: Pull + Rebuild + Up**.

## 7) Quick recovery commands (service troubleshooting)

```bash
cd ~/apps/app
docker compose ps
docker compose logs -f --tail=200 backend
docker compose logs -f --tail=200 web
docker compose logs -f --tail=200 caddy
docker compose restart backend web caddy
```

If backend keeps restarting with `sqlite3.OperationalError: unable to open database file`, the bind-mounted DB path may be wrong on host (often `backend/data.sqlite3` accidentally became a directory).

Fix on server:

```bash
cd ~/apps/app

# if this prints "directory", remove it and recreate as file
if [ -d backend/data.sqlite3 ]; then rm -rf backend/data.sqlite3; fi

# ensure sqlite file exists and is writable
touch backend/data.sqlite3
chmod 664 backend/data.sqlite3

# ensure deploy user owns project files
sudo chown -R deploy:deploy ~/apps/app

docker compose up -d --build
docker compose logs -f --tail=100 backend
```

## 8) Basic CI/CD (GitHub Actions)

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
- `DEPLOY_PATH` (example: `/home/deploy/apps/app`)
- `BACKEND_ENV_FILE` (full multi-line contents of `backend/.env`)

## 9) Secret and access handling best practices

- Keep real secrets only in:
  - server file: `backend/.env`, and/or
  - GitHub Actions secrets
- Keep `.env.example` with empty placeholders only
- Rotate keys immediately if leaked
- Avoid printing secrets in CI logs
- Prefer deploy user with SSH keys only (no password auth)

## 10) Post-hack hardening checklist

- [ ] `PermitRootLogin no` applied
- [ ] `PasswordAuthentication no` applied
- [ ] Fail2ban active for SSH
- [ ] UFW allows only OpenSSH, 80, 443
- [ ] unattended-upgrades enabled
- [ ] all compromised credentials rotated
- [ ] fresh `backend/.env` written from rotated keys

## 11) Demo-day quick checklist

- DNS points to server
- HTTPS certificate valid
- `ALLOWED_ORIGINS=https://vialive.libreuni.com`
- `docker compose ps` shows all services running
- Run full browser test with 1 teacher + 1 student on separate devices/networks
