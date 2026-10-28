#!/bin/sh
# Copy the render bundle a running Deckyard container carries out to the
# runner host, so the operator can register it (docs/ops/renderer-runner.md
# § Registering a release).
#
# Every image builds exactly one bundle into /app/renderer-store/<hash>
# (Dockerfile, stage renderer-bundle); a release that changed the renderer has
# a new hash. This script only copies and prints the register command: the
# registration itself is a root operator action that verifies every byte again.
#
# Usage (on the runner host, as a user that may run docker):
#   scripts/export-renderer-bundle.sh <container> <absolute-target-directory>
#
# The target directory must not exist yet; the bundle lands in
# <target>/<hash>, which is the source store the register command reads.
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <container> <absolute-target-directory>" >&2
  exit 2
fi
container=$1
target=$2

case "$target" in
  /*) ;;
  *)
    echo "target must be an absolute path: $target" >&2
    exit 2
    ;;
esac
if [ -e "$target" ]; then
  echo "target already exists: $target" >&2
  exit 1
fi

hashes=$(docker exec "$container" ls /app/renderer-store)
count=$(printf '%s\n' "$hashes" | grep -c . || true)
hash=$(printf '%s\n' "$hashes" | grep -E '^[0-9a-f]{64}$' || true)
if [ "$count" -ne 1 ] || [ -z "$hash" ]; then
  echo "expected exactly one render bundle in $container:/app/renderer-store, found: $hashes" >&2
  exit 1
fi

mkdir -p "$target"
docker cp "$container:/app/renderer-store/$hash" "$target/$hash"

echo "Exported renderer $hash to $target/$hash"
echo "Register it with:"
echo "  sudo /opt/deckyard-render/image/bin/node /opt/deckyard-render/code/runner/index.js register $target $hash"
