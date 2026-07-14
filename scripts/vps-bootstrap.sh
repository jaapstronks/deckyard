#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   bash scripts/vps-bootstrap.sh \
#     --host <your-server-ip> \
#     --user root \
#     --repo git@github.com:yourorg/deckyard.git \
#     --domain slides.example.com \
#     --email admin@example.com
#
# Notes:
# - Requires SSH access already set up (your server key).
# - If the GitHub repo is private, the VPS also needs GitHub access:
#   use a GitHub Deploy Key and clone via SSH (`git@github.com:...`).
# - This installs Docker, clones the repo to /opt/deckyard, writes /opt/deckyard/.env,
#   and starts the stack with HTTPS (Caddy).

HOST=""
USER="root"
REPO=""
DOMAIN=""
EMAIL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --user) USER="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$HOST" || -z "$REPO" || -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Missing required args. See usage header in this file." >&2
  exit 2
fi

SSH="ssh -o StrictHostKeyChecking=accept-new ${USER}@${HOST}"

echo "==> Installing Docker (if needed)…"
$SSH 'command -v docker >/dev/null 2>&1 || (apt-get update -y && apt-get install -y ca-certificates curl gnupg && install -m 0755 -d /etc/apt/keyrings && curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && chmod a+r /etc/apt/keyrings/docker.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list && apt-get update -y && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin)'

echo "==> Ensuring git + ssh client are installed…"
$SSH 'command -v git >/dev/null 2>&1 || (apt-get update -y && apt-get install -y git openssh-client)'

echo "==> Trusting GitHub host key on the VPS (first-time SSH)…"
$SSH 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && (ssh-keyscan -H github.com >> ~/.ssh/known_hosts 2>/dev/null || true) && chmod 600 ~/.ssh/known_hosts || true'

echo "==> Creating deploy folder…"
$SSH 'mkdir -p /opt/deckyard && cd /opt/deckyard && test -d .git || true'

echo "==> Cloning repo (or updating remote)…"
$SSH "cd /opt/deckyard && if [ -d .git ]; then \
  git remote set-url origin '${REPO}'; \
  GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=accept-new' git fetch --all --prune; \
  (git checkout -q main 2>/dev/null || git checkout -q -b main origin/main); \
  git reset --hard origin/main; \
  git clean -fd; \
else \
  GIT_SSH_COMMAND='ssh -o StrictHostKeyChecking=accept-new' git clone '${REPO}' .; \
fi"
$SSH "cd /opt/deckyard && if [ ! -f docker-compose.yml ]; then echo 'ERROR: docker-compose.yml not found in /opt/deckyard.' >&2; echo 'This usually means your Docker changes are not committed/pushed to the GitHub repo you are cloning.' >&2; echo 'Fix: commit + push from your laptop, then run: cd /opt/deckyard && git pull' >&2; exit 1; fi"

echo "==> Writing /opt/deckyard/.env (you can edit later)…"
$SSH "cd /opt/deckyard && cat > .env <<'EOF'
DOMAIN=${DOMAIN}
LETSENCRYPT_EMAIL=${EMAIL}

# Optional (AI Wizard):
# OPENAI_API=...
# OPENAI_MODEL=gpt-4o-mini
EOF"

echo "==> Starting services…"
$SSH 'cd /opt/deckyard && docker compose up -d --build'

echo
echo "Done."
echo "- App should be reachable at: https://${DOMAIN}"
echo "- Logs: ssh ${USER}@${HOST} 'cd /opt/deckyard && docker compose logs -f --tail=200'"


