#!/usr/bin/env bash
# Fast deterministic visual-route hook. It is deliberately separate from
# daemon self-healing so a cold daemon can never consume the routing timeout.

set -euo pipefail

mode="${1:-}"
if [[ -z "${mode}" ]] || ! command -v bun >/dev/null 2>&1; then exit 0; fi

exec bun run "${CLAUDE_PLUGIN_ROOT}/src/router/hook.ts" "${mode}"
