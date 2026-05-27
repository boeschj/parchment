#!/usr/bin/env bash
# PostToolUse with matcher "*": when ExitPlanMode fires, auto-push the plan to
# the canvas as a PlanFile slot. Other tools are ignored.

set -euo pipefail
# shellcheck source=lib.sh
source "${CLAUDE_PLUGIN_ROOT}/hooks/lib.sh"

if ! canvas_server_alive; then exit 0; fi
if ! command -v jq >/dev/null 2>&1; then exit 0; fi

hook_input="$(cat -)"
tool_name="$(printf '%s' "${hook_input}" | jq -r '.tool_name // empty')"

if [[ "${tool_name}" != "ExitPlanMode" ]]; then
  exit 0
fi

session_id="$(printf '%s' "${hook_input}" | jq -r '.session_id // "default"')"
cwd="$(printf '%s' "${hook_input}" | jq -r '.cwd // empty')"
plan="$(printf '%s' "${hook_input}" | jq -r '.tool_input.plan // empty')"

if [[ -z "${plan}" ]]; then exit 0; fi

token="$(canvas_token)"
base_url="$(canvas_base_url)"
safe_session_id="$(printf '%s' "${session_id}" | sed 's/[^A-Za-z0-9._-]/_/g')"

payload="$(jq -n \
  --arg kind "plan" \
  --arg title "Plan from Claude" \
  --arg origin "auto-capture" \
  --arg cwd "${cwd}" \
  --arg markdown "${plan}" \
  '{
    kind: $kind,
    title: $title,
    origin: $origin,
    cwd: $cwd,
    spec: {
      root: "main",
      elements: {
        main: {
          type: "PlanFile",
          props: { markdown: $markdown, editable: true }
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
