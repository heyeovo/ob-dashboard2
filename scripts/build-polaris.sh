#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Polaris lives outside the Next.js project to avoid Turbopack scanning conflicts
POLARIS_SOURCE="${POLARIS_SOURCE:-$ROOT_DIR/../polaris-local-first}"
OUT_DIR="$ROOT_DIR/public/chat"

if [ ! -d "$POLARIS_SOURCE" ]; then
  echo "ERROR: Polaris source not found at $POLARIS_SOURCE"
  echo "Set POLARIS_SOURCE env var or clone polaris-local-first next to ob-dashboard2"
  exit 1
fi

echo "=== Building Polaris from $POLARIS_SOURCE ==="
cd "$POLARIS_SOURCE"
npm ci --prefer-offline

export MSYS_NO_PATHCONV=1
export POLARIS_BASE='/chat/'
npx vite build --outDir dist

echo "=== Copying Polaris output to $OUT_DIR ==="
rm -rf "$OUT_DIR"
cp -r "$POLARIS_SOURCE/dist" "$OUT_DIR"

echo "=== Polaris build complete ==="
