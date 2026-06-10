#!/usr/bin/env bash
# clawd-canvas statusline.
#
# Invoked by Claude Code's statusLine.command. NOT a plugin hook — so
# CLAUDE_PLUGIN_ROOT is unset; we self-locate lib.sh via this script's dir.
#
# Output when no plan exists:    ◐ canvas localhost:7800/s/abc123 ▦ dashboard
# Output once a plan slot lands: ✎ view plan localhost:7800/s/abc123
#
# Visible text is the short URL (auto-detected as clickable on every terminal).
# OSC-8 wraps a click target of the FULL session URL (modern terminals click
# the href, not the displayed text — full id avoids the /s/ redirect race).
# Apple_Terminal does not support OSC-8 at all; fall back to plain text.
#
# This script is strictly read-only: slot files are the daemon's persisted
# canvas content, never garbage-collected from here.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
# shellcheck source=../hooks/lib.sh
source "${SCRIPT_DIR}/../hooks/lib.sh"

MAX_SLOT_GLYPHS=6

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

# Free heartbeat — bumps session.lastPing each refresh, which is how the
# daemon resolves "the active claude session" for MCP calls.
# Backgrounded to keep the statusline fast.
safe_session_id="$(printf '%s' "${session_id}" | sed 's/[^A-Za-z0-9._-]/_/g')"
( curl -fsS --max-time 0.5 \
    "$(canvas_base_url)/api/heartbeat?session=${safe_session_id}" \
    >/dev/null 2>&1 || true ) &
disown $! 2>/dev/null || true

# One jq pass over the session's slot files: does a plan exist, and what
# are the most recent non-plan slots (kind + status, newest first)?
# Glob *.json, not slot_*.json — MCP callers may supply their own slot ids,
# and the daemon writes <slotId>.json verbatim.
slots_dir="$(canvas_slots_dir "${session_id}")"
has_plan="false"
recent_slots=""
slot_files=("${slots_dir}"/*.json)
if [[ -e "${slot_files[0]:-}" ]] && command -v jq >/dev/null 2>&1; then
  slot_summary="$(jq -s --argjson limit "${MAX_SLOT_GLYPHS}" '{
    hasPlan: (map(select(.kind == "plan")) | length > 0),
    recent: (map(select(.kind != "plan"))
      | sort_by(-.updatedAt)
      | .[:$limit]
      | map("\(.kind) \(.status) \(.createdAt) \(.updatedAt)"))
  }' "${slot_files[@]}" 2>/dev/null || echo "")"
  if [[ -n "${slot_summary}" ]]; then
    has_plan="$(printf '%s' "${slot_summary}" | jq -r '.hasPlan')"
    recent_slots="$(printf '%s' "${slot_summary}" | jq -r '.recent[]')"
  fi
fi

label="◐ canvas"
if [[ "${has_plan}" == "true" ]]; then
  label="✎ view plan"
fi

display="$(canvas_session_short_url "${session_id}")"
href="$(canvas_session_full_href "${session_id}")"

if [[ "${TERM_PROGRAM:-}" == "Apple_Terminal" ]]; then
  printf '%s %s' "${label}" "${display}"
elif [[ -n "${TMUX:-}" ]]; then
  # tmux passthrough for OSC-8. Requires `set -g allow-passthrough on`.
  # Every ESC inside a passthrough must be doubled or tmux terminates the
  # DCS at the first single ESC-backslash and forwards a broken half-open
  # OSC-8 to the host terminal. Two complete wraps: open link, then close.
  esc=$'\e'
  open_seq="${esc}Ptmux;${esc}${esc}]8;;${href}${esc}${esc}\\${esc}\\"
  close_seq="${esc}Ptmux;${esc}${esc}]8;;${esc}${esc}\\${esc}\\"
  printf '%s%s %s%s' "${open_seq}" "${label}" "${display}" "${close_seq}"
else
  esc=$'\e'
  printf '%s]8;;%s%s\\%s %s%s]8;;%s\\' "${esc}" "${href}" "${esc}" "${label}" "${display}" "${esc}" "${esc}"
fi

# Per-kind glyphs for the most recent non-plan slots.
if [[ -n "${recent_slots}" ]]; then
  spinner_frames=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧)
  now_epoch_ms=$(( $(date +%s) * 1000 ))
  spinner_index=$(( (now_epoch_ms / 1000) % 8 ))
  spinner_glyph="${spinner_frames[$spinner_index]}"
  stale_threshold_ms=$(( 30 * 1000 ))

  while read -r kind status created_at updated_at; do
    [[ -n "${kind}" ]] || continue
    age_ms=$(( now_epoch_ms - created_at ))

    case "${kind}" in
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
  done <<< "${recent_slots}"
fi
