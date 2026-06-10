#!/usr/bin/env bash
# UserPromptSubmit: ask the daemon for any pending canvas edits in this session
# and emit them as a <canvas-state> block prepended to the user message.
#
# Also acts as a self-heal: if the daemon died (idle shutdown during a long
# claude session, OOM, manual kill) UserPromptSubmit boots it back up. Without
# this, the user's only recovery path is to quit and restart claude — which
# they often don't realize is the issue.

set -euo pipefail
# shellcheck source=lib.sh
source "${CLAUDE_PLUGIN_ROOT}/hooks/lib.sh"

# Self-heal: respawn the daemon if it's dead. Mirrors session-start.sh but
# fire-and-forget — never block the prompt waiting for health.
if ! canvas_server_alive; then
  if command -v bun >/dev/null 2>&1; then
    mkdir -p "${CANVAS_STATE_DIR}"
    CANVAS_PORT="${CANVAS_DEFAULT_PORT}" \
      nohup bun run "${CLAUDE_PLUGIN_ROOT}/src/daemon/server.ts" \
      >"${CANVAS_LOG_FILE}" 2>&1 &
    disown || true
    # Give it ~1s to come up; if it doesn't, just exit — the next prompt will
    # retry. We never block the user's turn on canvas health.
    canvas_wait_for_health || exit 0
  else
    # No bun in PATH; nothing we can do silently. Exit clean so the prompt flows.
    exit 0
  fi
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

# Re-register every prompt: covers daemon restarts mid-session, when the
# in-memory transcript registration was lost.
canvas_register_transcript "${session_id}" "${transcript_path}"

safe_session_id="$(printf '%s' "${session_id}" | sed 's/[^A-Za-z0-9._-]/_/g')"
url="$(canvas_base_url)/api/sessions/${safe_session_id}/edits?format=injection"

# Daemon does the formatting; the hook just passes stdout through. Curl errors
# (daemon dying mid-prompt, etc.) MUST exit 0 so the prompt is not blocked.
response="$(curl -fsS --max-time 1 "${url}" 2>/dev/null || true)"
if [[ -n "${response}" ]]; then
  printf '%s' "${response}"
fi
