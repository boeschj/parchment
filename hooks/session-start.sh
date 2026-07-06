#!/usr/bin/env bash
# SessionStart: ensure the canvas daemon is up; print canvas URL to stderr so
# it surfaces in Claude Code's onboarding output.

set -euo pipefail
# shellcheck source=lib.sh
source "${CLAUDE_PLUGIN_ROOT}/hooks/lib.sh"

mkdir -p "${CANVAS_STATE_DIR}"

# First-run self-build: a marketplace install drops the raw repo with no
# node_modules and no dist/browser. Build once, guarded by a lock so parallel
# session starts don't race. Subsequent starts cost two stat calls.
if [[ ! -d "${CLAUDE_PLUGIN_ROOT}/node_modules" || ! -d "${CLAUDE_PLUGIN_ROOT}/dist/browser" ]]; then
  if ! command -v bun >/dev/null 2>&1; then
    echo "[clawd-canvas] bun not found in PATH — install bun (https://bun.sh) and re-run \`claude\`." >&2
    exit 0
  fi
  build_lock="${CANVAS_STATE_DIR}/first-run-build.lock"
  if mkdir "${build_lock}" 2>/dev/null; then
    echo "[clawd-canvas] first run — installing deps and building (one-time, ~30s)…" >&2
    (
      cd "${CLAUDE_PLUGIN_ROOT}" &&
        bun install --silent &&
        bun run build:browser
    ) >>"${CANVAS_STATE_DIR}/first-run-build.log" 2>&1 || {
      echo "[clawd-canvas] first-run build failed — see ${CANVAS_STATE_DIR}/first-run-build.log" >&2
      rmdir "${build_lock}" 2>/dev/null || true
      exit 0
    }
    rmdir "${build_lock}" 2>/dev/null || true
  else
    echo "[clawd-canvas] another session is running the first-time build; canvas will be up shortly." >&2
    exit 0
  fi
fi

if ! canvas_server_alive; then
  if ! command -v bun >/dev/null 2>&1; then
    echo "[clawd-canvas] bun not found in PATH — install bun and re-run \`claude\`. https://bun.sh" >&2
    exit 0
  fi
  CANVAS_PORT="${CANVAS_DEFAULT_PORT}" \
    nohup bun run "${CLAUDE_PLUGIN_ROOT}/src/daemon/server.ts" \
    >"${CANVAS_LOG_FILE}" 2>&1 &
  disown || true
fi

if ! canvas_wait_for_health; then
  echo "[clawd-canvas] daemon failed to come up within timeout. See ${CANVAS_LOG_FILE}" >&2
  exit 0
fi

hook_input="$(cat -)"
session_id="default"
transcript_path=""
if command -v jq >/dev/null 2>&1; then
  session_id="$(printf '%s' "${hook_input}" | jq -r '.session_id // "default"')"
  transcript_path="$(printf '%s' "${hook_input}" | jq -r '.transcript_path // ""')"
else
  parsed="$(printf '%s' "${hook_input}" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if [[ -n "${parsed}" ]]; then session_id="${parsed}"; fi
  transcript_path="$(printf '%s' "${hook_input}" | sed -n 's/.*"transcript_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
fi

canvas_register_transcript "${session_id}" "${transcript_path}"

url="$(canvas_session_full_href "${session_id}")"
printf '[clawd-canvas] canvas ready: %s\n' "${url}" >&2
