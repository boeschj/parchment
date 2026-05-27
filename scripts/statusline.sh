#!/usr/bin/env bash
# clawd-canvas v0.2 statusline.
#
# Invoked by Claude Code's statusLine.command. NOT a plugin hook — so
# CLAUDE_PLUGIN_ROOT is unset; we self-locate lib.sh via this script's dir.
#
# Output:
#   ◐ canvas localhost:7800/s/abc12345 ✎ plan ⇄ diff ▱ diagram
#
# Visible text is the short URL (auto-detected as clickable on every terminal).
# OSC-8 wraps a click target of the FULL session URL (modern terminals click
# the href, not the displayed text — full id avoids the /s/ redirect race).
# Apple_Terminal does not support OSC-8 at all; fall back to plain text.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
# shellcheck source=../hooks/lib.sh
source "${SCRIPT_DIR}/../hooks/lib.sh"

stdin_payload=""
if [[ ! -t 0 ]]; then
  stdin_payload="$(cat -)"
fi

session_id="default"
if [[ -n "${stdin_payload}" ]] && command -v jq >/dev/null 2>&1; then
  parsed="$(printf '%s' "${stdin_payload}" | jq -r '.session_id // .sessionId // empty')"
  if [[ -n "${parsed}" ]]; then
    session_id="${parsed}"
  fi
elif [[ -n "${CLAUDE_CODE_SESSION_ID:-}" ]]; then
  session_id="${CLAUDE_CODE_SESSION_ID}"
fi

if ! canvas_server_alive; then
  printf '◐ canvas: not running'
  exit 0
fi

# Free heartbeat — bumps session.lastPing each refresh so idle-shutdown counts
# this Claude Code session as live for the next 120s even when no slots change.
# Backgrounded to keep the statusline fast.
safe_session_id="$(printf '%s' "${session_id}" | sed 's/[^A-Za-z0-9._-]/_/g')"
( curl -fsS --max-time 0.5 \
    "$(canvas_base_url)/api/heartbeat?session=${safe_session_id}" \
    >/dev/null 2>&1 || true ) &
disown $! 2>/dev/null || true

display="$(canvas_session_short_url "${session_id}")"
href="$(canvas_session_full_href "${session_id}")"

if [[ "${TERM_PROGRAM:-}" == "Apple_Terminal" ]]; then
  printf '◐ canvas %s' "${display}"
elif [[ -n "${TMUX:-}" ]]; then
  # tmux passthrough wrap for OSC-8. Requires `set -g allow-passthrough on`.
  esc=$'\e'
  printf '%sPtmux;%s%s]8;;%s%s\\◐ canvas %s%s]8;;%s\\%s\\' \
    "${esc}" "${esc}" "${esc}" "${href}" "${esc}" "${display}" "${esc}" "${esc}" "${esc}"
else
  esc=$'\e'
  printf '%s]8;;%s%s\\◐ canvas %s%s]8;;%s\\' "${esc}" "${href}" "${esc}" "${display}" "${esc}" "${esc}"
fi

# Per-kind slot glyphs. Slot files are named slot_<id>.json (id-keyed, not
# numeric) and look like {id, kind, status, origin, title, createdAt, updatedAt}.
slots_dir="$(canvas_slots_dir "${session_id}")"
if [[ -d "${slots_dir}" ]] && command -v jq >/dev/null 2>&1; then
  spinner_frames=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧)
  now_epoch_ms=$(( $(date +%s) * 1000 ))
  now_epoch=$(( now_epoch_ms / 1000 ))
  spinner_index=$(( now_epoch % 8 ))
  spinner_glyph="${spinner_frames[$spinner_index]}"
  stale_threshold_ms=$(( 30 * 1000 ))
  gc_threshold_ms=$(( 5 * 60 * 1000 ))

  for slot_file in "${slots_dir}"/slot_*.json; do
    [[ -e "${slot_file}" ]] || continue
    status="$(jq -r '.status // "rendering"' "${slot_file}" 2>/dev/null || echo "rendering")"
    kind="$(jq -r '.kind // "render"' "${slot_file}" 2>/dev/null || echo "render")"
    created_at="$(jq -r '.createdAt // 0' "${slot_file}" 2>/dev/null || echo 0)"
    updated_at="$(jq -r '.updatedAt // 0' "${slot_file}" 2>/dev/null || echo 0)"
    age_ms=$(( now_epoch_ms - created_at ))
    settled_ms=$(( now_epoch_ms - updated_at ))

    # GC: terminal-state slots older than 5 min are quietly removed so the
    # status line doesn't grow unbounded across a long session.
    if [[ "${status}" != "rendering" ]] && (( settled_ms > gc_threshold_ms )); then
      rm -f "${slot_file}"
      continue
    fi

    case "${kind}" in
      plan)      kind_glyph="✎" ;;
      diagram)   kind_glyph="▱" ;;
      diff)      kind_glyph="⇄" ;;
      dashboard) kind_glyph="▦" ;;
      table)     kind_glyph="⊞" ;;
      report)    kind_glyph="¶" ;;
      *)         kind_glyph="◇" ;;
    esac

    if [[ "${status}" == "rendering" ]] && (( age_ms > stale_threshold_ms )); then
      glyph="⚠ ${kind_glyph}"
    elif [[ "${status}" == "rendering" ]]; then
      glyph="${spinner_glyph}"
    elif [[ "${status}" == "error" ]]; then
      glyph="${kind_glyph}✗"
    else
      glyph="${kind_glyph}"
    fi

    printf ' %s %s' "${glyph}" "${kind}"
  done
fi
