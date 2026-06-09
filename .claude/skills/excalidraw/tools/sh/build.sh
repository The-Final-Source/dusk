#!/usr/bin/env bash
# Thin shell wrapper around the excalidraw build TS entrypoint.
# Forwards all flags. See src/build.ts for the supported flags.
#
# Preserves the caller's working directory so relative --spec and --out
# paths resolve against where the user invoked the command. Invokes tsx
# by absolute path from the TS package's own node_modules so the tool
# stays self-contained regardless of cwd.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TS_DIR="$( cd "${SCRIPT_DIR}/../ts" && pwd )"
TSX="${TS_DIR}/node_modules/.bin/tsx"

if [[ ! -x "${TSX}" ]]; then
  echo "error: tsx not found at ${TSX}" >&2
  echo "       run: cd ${TS_DIR} && pnpm install --ignore-workspace" >&2
  exit 1
fi

exec "${TSX}" "${TS_DIR}/src/build.ts" "$@"
