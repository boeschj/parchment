#!/usr/bin/env bash
# Shared helpers for clawd-canvas v0.2 hooks.

CANVAS_STATE_DIR="${HOME}/.canvas"
CANVAS_PORT_FILE="${CANVAS_STATE_DIR}/server.port"
CANVAS_PID_FILE="${CANVAS_STATE_DIR}/server.pid"
CANVAS_TOKEN_FILE="${CANVAS_STATE_DIR}/server.token"
CANVAS_LOG_FILE="${CANVAS_STATE_DIR}/server.log"
CANVAS_DEFAULT_PORT="${CANVAS_PORT:-7800}"
CANVAS_TOKEN_HEADER="X-Canvas-Token"

canvas_token() {
  if [[ -f "${CANVAS_TOKEN_FILE}" ]]; then
    cat "${CANVAS_TOKEN_FILE}"
  fi
}

canvas_port() {
  if [[ -f "${CANVAS_PORT_FILE}" ]]; then
    cat "${CANVAS_PORT_FILE}"
  else
    echo "${CANVAS_DEFAULT_PORT}"
  fi
}

canvas_base_url() {
  echo "http://localhost:$(canvas_port)"
}

# Compact session url for status line. First 6 hex chars of the session id.
canvas_session_short_url() {
  local session_id="$1"
  local hex
  hex="$(printf '%s' "${session_id}" | tr 'A-Z' 'a-z' | tr -cd '0-9a-f' | cut -c1-6)"
  if [[ -z "${hex}" ]]; then
    hex="$(printf '%s' "${session_id}" | tr -cd 'A-Za-z0-9' | cut -c1-6 | tr 'A-Z' 'a-z')"
    if [[ -z "${hex}" ]]; then hex="default"; fi
  fi
  echo "localhost:$(canvas_port)/s/${hex}"
}

canvas_session_short_href() {
  echo "http://$(canvas_session_short_url "$1")"
}

# Full session url — what the browser actually subscribes to. The /s/ redirect
# resolves to this so a click via OSC-8 always lands on the right session.
canvas_session_full_href() {
  local session_id="$1"
  local safe_id
  safe_id="$(printf '%s' "${session_id}" | sed 's/[^A-Za-z0-9._-]/_/g')"
  echo "http://localhost:$(canvas_port)/?session=${safe_id}"
}

canvas_slots_dir() {
  local session_id="$1"
  local safe_id
  safe_id="$(printf '%s' "${session_id}" | sed 's/[^A-Za-z0-9._-]/_/g')"
  echo "${CANVAS_STATE_DIR}/sessions/${safe_id}/slots"
}

canvas_server_alive() {
  if [[ ! -f "${CANVAS_PID_FILE}" ]]; then return 1; fi
  local pid
  pid="$(cat "${CANVAS_PID_FILE}")"
  if [[ -z "${pid}" ]]; then return 1; fi
  kill -0 "${pid}" 2>/dev/null
}

canvas_wait_for_health() {
  local attempts=20
  local url
  url="$(canvas_base_url)/api/health"
  while (( attempts > 0 )); do
    if curl -fsS --max-time 1 "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
    attempts=$((attempts - 1))
  done
  return 1
}
