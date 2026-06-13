#!/usr/bin/env bash
# PostToolUse with matcher "*": push plans to the canvas the moment they
# exist.
#
# Plan mode writes the plan to ~/.claude/plans/<slug>.md (via Write/Edit)
# BEFORE ExitPlanMode ever runs — and ExitPlanMode only completes if the
# user approves, so approval-time capture misses exactly the case the
# canvas exists for: reading and editing the plan before deciding. Capture
# on the file write instead, and treat ExitPlanMode (when it does complete)
# as a final sync of the same slot.

set -euo pipefail
# shellcheck source=lib.sh
source "${CLAUDE_PLUGIN_ROOT}/hooks/lib.sh"

if ! canvas_server_alive; then exit 0; fi
if ! command -v jq >/dev/null 2>&1; then exit 0; fi

hook_input="$(cat -)"
tool_name="$(printf '%s' "${hook_input}" | jq -r '.tool_name // empty')"

# Capture trace: one line per invocation so "hook never fired" and "hook
# fired but bailed" are distinguishable after the fact. Reset at 1MB so it
# never grows unbounded.
trace_file="${CANVAS_STATE_DIR}/hook-trace.log"
if [[ -f "${trace_file}" ]] && (( $(wc -c < "${trace_file}") > 1048576 )); then
  : > "${trace_file}"
fi
echo "$(date '+%Y-%m-%dT%H:%M:%S') tool=${tool_name}" >> "${trace_file}" 2>/dev/null || true

plan_file=""
case "${tool_name}" in
  Write|Edit|MultiEdit)
    file_path="$(printf '%s' "${hook_input}" | jq -r '.tool_input.file_path // empty')"
    if [[ "${file_path}" == "${HOME}/.claude/plans/"*.md ]]; then
      plan_file="${file_path}"
    fi
    ;;
  ExitPlanMode)
    plan_file="$(printf '%s' "${hook_input}" | jq -r '.tool_input.planFilePath // empty')"
    ;;
  *)
    exit 0
    ;;
esac

if [[ -z "${plan_file}" || ! -f "${plan_file}" ]]; then exit 0; fi

session_id="$(printf '%s' "${hook_input}" | jq -r '.session_id // "default"')"
cwd="$(printf '%s' "${hook_input}" | jq -r '.cwd // empty')"
plan_name="$(basename "${plan_file}" .md)"

# Stable slot id per plan file: every revision replaces the slot instead of
# stacking near-duplicates in the rail.
slot_id="plan_$(printf '%s' "${plan_name}" | sed 's/[^A-Za-z0-9_-]/_/g')"

token="$(canvas_token)"
base_url="$(canvas_base_url)"
safe_session_id="$(printf '%s' "${session_id}" | sed 's/[^A-Za-z0-9._-]/_/g')"

payload="$(jq -n \
  --arg kind "plan" \
  --arg title "${plan_name}.md" \
  --arg origin "auto-capture" \
  --arg cwd "${cwd}" \
  --arg slotId "${slot_id}" \
  --rawfile markdown "${plan_file}" \
  '{
    kind: $kind,
    title: $title,
    origin: $origin,
    cwd: $cwd,
    slotId: $slotId,
    spec: {
      root: "main",
      elements: {
        main: {
          type: "PlanFile",
          props: { title: $title, markdown: $markdown, editable: true }
        }
      }
    }
  }')"

curl -fsS --max-time 2 \
  -H 'content-type: application/json' \
  -H "${CANVAS_TOKEN_HEADER}: ${token}" \
  -X POST \
  -d "${payload}" \
  "${base_url}/api/sessions/${safe_session_id}/slots" \
  >/dev/null 2>&1 || true
