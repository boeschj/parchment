#!/usr/bin/env bash
# SessionStart: ensure the canvas daemon is up; print canvas URL to stderr so
# it surfaces in Claude Code's onboarding output.

set -euo pipefail
# shellcheck source=lib.sh
source "${CLAUDE_PLUGIN_ROOT}/hooks/lib.sh"

mkdir -p "${CANVAS_STATE_DIR}"

# Refresh the stable statusline launcher so a user's settings.json path
# (bash ~/.parchment/statusline.sh) keeps working across plugin updates.
canvas_write_statusline_launcher

# First-run self-build: a marketplace install drops the raw repo with no
# node_modules and no dist/browser. The build runs DETACHED so a cold-cache
# install (which can exceed the SessionStart hook timeout) never gets killed
# mid-build; the detached chain also boots the daemon when it finishes. A lock
# guards against parallel session starts, and a stale lock (crashed or
# timeout-killed builder) self-heals after 10 minutes.
BUILD_LOCK_STALE_MINUTES=10

if [[ ! -d "${CLAUDE_PLUGIN_ROOT}/node_modules" || ! -d "${CLAUDE_PLUGIN_ROOT}/dist/browser" ]]; then
  if ! command -v bun >/dev/null 2>&1; then
    echo "[clawd-canvas] bun not found in PATH — install bun (https://bun.sh) and re-run \`claude\`." >&2
    exit 0
  fi
  build_lock="${CANVAS_STATE_DIR}/first-run-build.lock"
  if [[ -d "${build_lock}" ]] && [[ -n "$(find "${build_lock}" -maxdepth 0 -mmin +${BUILD_LOCK_STALE_MINUTES} 2>/dev/null)" ]]; then
    echo "[clawd-canvas] clearing stale first-run build lock." >&2
    rmdir "${build_lock}" 2>/dev/null || true
  fi
  if mkdir "${build_lock}" 2>/dev/null; then
    echo "[clawd-canvas] first run — installing deps and building in the background (~1 min on a cold cache). The canvas comes up automatically when it finishes." >&2
    nohup bash -c '
      set -uo pipefail
      cd "$1" || exit 1
      if bun install --silent && bun run build:browser; then
        rmdir "$2" 2>/dev/null || true
        CANVAS_PORT="$3" nohup bun run "$1/src/daemon/server.ts" >>"$4" 2>&1 &
      else
        echo "[clawd-canvas] first-run build failed" >>"$5"
        rmdir "$2" 2>/dev/null || true
      fi
    ' first-run-build "${CLAUDE_PLUGIN_ROOT}" "${build_lock}" "${CANVAS_DEFAULT_PORT}" "${CANVAS_LOG_FILE}" "${CANVAS_STATE_DIR}/first-run-build.log" \
      >>"${CANVAS_STATE_DIR}/first-run-build.log" 2>&1 &
    disown || true
  else
    echo "[clawd-canvas] another session is running the first-time build; the canvas will be up shortly." >&2
  fi
  exit 0
fi

# Adopt a newer build automatically: if the daemon is alive but running code
# older than what's on disk (a plugin update or rebuild), replace it. State is
# persisted to disk, so the restart is lossless and the browser tab reconnects
# on its own — the user never runs a command to pick up an update.
if canvas_server_alive && canvas_daemon_is_stale; then
  echo "[clawd-canvas] newer build detected — restarting the canvas daemon to adopt it." >&2
  canvas_stop_daemon
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
cwd=""
if command -v jq >/dev/null 2>&1; then
  session_id="$(printf '%s' "${hook_input}" | jq -r '.session_id // "default"')"
  transcript_path="$(printf '%s' "${hook_input}" | jq -r '.transcript_path // ""')"
  cwd="$(printf '%s' "${hook_input}" | jq -r '.cwd // ""')"
else
  parsed="$(printf '%s' "${hook_input}" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if [[ -n "${parsed}" ]]; then session_id="${parsed}"; fi
  transcript_path="$(printf '%s' "${hook_input}" | sed -n 's/.*"transcript_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  cwd="$(printf '%s' "${hook_input}" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
fi

# The MCP server scopes its active-session lookup by CLAUDE_PROJECT_DIR, so
# activate with that exact value when present — otherwise the new session's cwd
# won't match the lookup and the old session still wins. Fall back to hook cwd.
if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
  cwd="${CLAUDE_PROJECT_DIR}"
fi

# Announce this session as the foreground one (with its cwd) so MCP artifacts
# route here — the /clear misattribution fix. Must run every SessionStart.
canvas_activate_session "${session_id}" "${cwd}"
canvas_register_transcript "${session_id}" "${transcript_path}"

url="$(canvas_session_full_href "${session_id}")"
printf '[clawd-canvas] canvas ready: %s\n' "${url}" >&2
