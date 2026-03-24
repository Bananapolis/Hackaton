#!/usr/bin/env bash
# setup-server.sh — Fresh Ubuntu 24.04 server bootstrap for VIA Live
# Run as root on a brand-new droplet/VPS before deploying the app.
# See DEPLOYMENT.md for full context and manual step-by-step guide.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_HOME="/home/$DEPLOY_USER"

echo "=== VIA Live server setup starting: $(date) ==="
echo "Deploy user: $DEPLOY_USER"

# ── 1. Swap (do this FIRST to prevent OOM kills during apt upgrade) ──────────
echo "--- Setting up swap..."
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -w vm.swappiness=10
sysctl -w vm.vfs_cache_pressure=50
cat > /etc/sysctl.d/99-swap-tuning.conf <<'EOF'
vm.swappiness=10
vm.vfs_cache_pressure=50
EOF
echo "Swap configured:"
swapon --show
free -h

# ── 2. OS update + baseline packages ────────────────────────────────────────
echo "--- Updating OS and installing packages..."
dpkg --configure -a || true
apt -f install -y || true
apt update
DEBIAN_FRONTEND=noninteractive apt -y upgrade
apt install -y ca-certificates curl git ufw fail2ban unattended-upgrades apt-listchanges
dpkg-reconfigure -f noninteractive unattended-upgrades

# ── 3. Docker ────────────────────────────────────────────────────────────────
echo "--- Installing Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

# ── 4. Create deploy user ────────────────────────────────────────────────────
echo "--- Creating deploy user: $DEPLOY_USER..."
if ! id "$DEPLOY_USER" &>/dev/null; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG sudo "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"

# Copy root's authorized_keys so the deploy user can log in with the same key
if [[ -f /root/.ssh/authorized_keys ]]; then
  mkdir -p "$DEPLOY_HOME/.ssh"
  cp /root/.ssh/authorized_keys "$DEPLOY_HOME/.ssh/authorized_keys"
  chown -R "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
  chmod 700 "$DEPLOY_HOME/.ssh"
  chmod 600 "$DEPLOY_HOME/.ssh/authorized_keys"
  echo "SSH key copied to $DEPLOY_USER."
else
  echo "WARNING: /root/.ssh/authorized_keys not found. Add SSH key to $DEPLOY_HOME/.ssh/authorized_keys manually before disabling password auth."
fi

# ── 5. Firewall ──────────────────────────────────────────────────────────────
echo "--- Configuring UFW firewall..."
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 49160:49200/udp
ufw --force enable
ufw status verbose

# ── 6. Fail2ban ──────────────────────────────────────────────────────────────
echo "--- Configuring fail2ban..."
cat > /etc/fail2ban/jail.local <<'EOF'
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
systemctl enable --now fail2ban
fail2ban-client status

# ── 7. SSH hardening ─────────────────────────────────────────────────────────
echo "--- Hardening SSH..."
echo ""
echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
echo "  IMPORTANT: Open a second terminal and verify you can log in as"
echo "  $DEPLOY_USER with your SSH key BEFORE this script continues."
echo "  Press ENTER to proceed and disable root/password login."
echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
read -r _

cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
X11Forwarding no
MaxAuthTries 3
EOF
sshd -t
systemctl restart ssh

echo ""
echo "=== Setup complete: $(date) ==="
echo ""
echo "Next steps:"
echo "  1. Reconnect as: ssh $DEPLOY_USER@<SERVER_IP>"
echo "  2. Clone repo:   mkdir -p ~/apps && cd ~/apps && git clone <REPO_URL> app"
echo "  3. Configure:    cp ~/apps/app/backend/.env.example ~/apps/app/backend/.env && nano ~/apps/app/backend/.env"
echo "  4. Deploy:       cd ~/apps/app && ./scripts/deploy-update.sh"
echo "  See DEPLOYMENT.md for full instructions."
