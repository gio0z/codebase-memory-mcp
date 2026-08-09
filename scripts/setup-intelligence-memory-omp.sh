#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT_DIR/omp/extension/workspace-provider.js"

if [[ ! -f "$SOURCE" ]]; then
  echo "Missing provider extension: $SOURCE" >&2
  exit 1
fi

if ! command -v codebase-memory-mcp >/dev/null 2>&1; then
  echo "codebase-memory-mcp is not on PATH. Install/build the engine first." >&2
  exit 1
fi

if [[ -n "${PI_CODING_AGENT_DIR:-}" ]]; then
  AGENT_DIR="$PI_CODING_AGENT_DIR"
elif [[ -d "$HOME/.omp/agent" || ! -d "$HOME/.oh-omp/agent" ]]; then
  AGENT_DIR="$HOME/.omp/agent"
else
  AGENT_DIR="$HOME/.oh-omp/agent"
fi

TARGET_DIR="$AGENT_DIR/extensions"
TARGET="$TARGET_DIR/codebase-memory-workspace-provider.js"
mkdir -p "$TARGET_DIR"
cp "$SOURCE" "$TARGET"

cat <<EOF
Installed codebase-memory intelligence provider:
  $TARGET

Provider domain:
  structural.code

Next:
  1. Make sure intelligence-memory is installed in OMP.
  2. Restart/reload OMP.
  3. In an indexed project, run: /intel doctor
EOF
