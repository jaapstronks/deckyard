#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   bash scripts/vps-deploy.sh --host <your-server-ip> --user root
#
# Pulls latest code and rebuilds containers.

HOST=""
USER="root"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --user) USER="$2"; shift 2 ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$HOST" ]]; then
  echo "Missing --host" >&2
  exit 2
fi

SSH="ssh -o StrictHostKeyChecking=accept-new ${USER}@${HOST}"

$SSH 'set -e; cd /opt/deckyard; git pull; docker compose up -d --build'
echo "Deployed."


