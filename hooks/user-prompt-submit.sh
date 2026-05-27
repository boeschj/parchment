#!/usr/bin/env bash
# UserPromptSubmit: ask the daemon for any pending canvas edits in this session
# and emit them as a <canvas-state> block prepended to the user message.

set -euo pipefail
# shellcheck source=lib.sh
source "${CLAUDE_PLUGIN_ROOT}/hooks/lib.sh"

if ! canvas_server_alive; then
  exit 0
fi

hook_input="$(cat -)"
session_id="default"
if command -v jq >/dev/null 2>&1; then
  session_id="$(printf '%s' "${hook_input}" | jq -r '.session_id // "default"')"
else
  parsed="$(printf '%s' "${hook_input}" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if [[ -n "${parsed}" ]]; then session_id="${parsed}"; fi
fi

safe_session_id="$(printf '%s' "${session_id}" | sed 's/[^A-Za-z0-9._-]/_/g')"
url="$(canvas_base_url)/api/sessions/${safe_session_id}/edits?format=injection"

# Daemon does the formatting; the hook just passes stdout through. Curl errors
# (daemon dying mid-prompt, etc.) MUST exit 0 so the prompt is not blocked.
response="$(curl -fsS --max-time 1 "${url}" 2>/dev/null || true)"
if [[ -n "${response}" ]]; then
  printf '%s' "${response}"
fi
