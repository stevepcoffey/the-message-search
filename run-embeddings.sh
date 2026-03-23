#!/usr/bin/env bash
# Run npm embeddings in a loop until the generator prints a successful completion line.
# Loads environment from .env.local (same as local dev).

set -u

cd "$(dirname "$0")"

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

while true; do
  tmp="$(mktemp)"
  set +e
  npm run embeddings 2>&1 | tee "$tmp"
  set -e

  if grep -q 'Done in ' "$tmp"; then
    rm -f "$tmp"
    exit 0
  fi

  rm -f "$tmp"
  echo 'Restarting embeddings...'
  sleep 5
done
