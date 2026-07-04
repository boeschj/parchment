#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=lib.sh
source "${CLAUDE_PLUGIN_ROOT}/hooks/lib.sh"

canvas_server_alive || exit 0

hook_input="$(cat -)"
session_id="$(canvas_session_id_from "${hook_input}")"
canvas_set_status "${session_id}" "blocked"
exit 0
