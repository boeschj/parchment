import type {
  BoardOpsResult,
  BoardScene,
  EditKind,
  SessionSummary,
  Slot,
  SlotOpsResult,
} from "../shared/types.ts";

const TOKEN_HEADER = "x-canvas-token";

let cachedToken: string | null = null;

async function ensureToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const response = await fetch("/api/bootstrap");
  if (!response.ok) throw new Error(`bootstrap failed: ${response.status}`);
  const payload = (await response.json()) as { token: string };
  cachedToken = payload.token;
  return cachedToken;
}

export function clearCachedToken(): void {
  cachedToken = null;
}

async function authorizedHeaders(): Promise<HeadersInit> {
  const token = await ensureToken();
  return {
    "content-type": "application/json",
    [TOKEN_HEADER]: token,
  };
}

export async function postEdit(
  sessionId: string,
  body: { slotId: string; elementId?: string | null; kind: EditKind; payload: Record<string, unknown> },
): Promise<void> {
  const headers = await authorizedHeaders();
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/edits`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`postEdit failed (${response.status}): ${text}`);
  }
}

export async function deleteSlot(sessionId: string, slotId: string): Promise<void> {
  const headers = await authorizedHeaders();
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/slots/${encodeURIComponent(slotId)}`,
    { method: "DELETE", headers },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`deleteSlot failed (${response.status}): ${text}`);
  }
}

export async function fetchBoardScene(sessionId: string): Promise<BoardScene> {
  const headers = await authorizedHeaders();
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/board`, { headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`fetchBoardScene failed (${response.status}): ${text}`);
  }
  return (await response.json()) as BoardScene;
}

export async function postBoardScene(
  sessionId: string,
  scene: BoardScene,
  clientId: string,
): Promise<void> {
  const headers = await authorizedHeaders();
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/board`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...scene, clientId }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`postBoardScene failed (${response.status}): ${text}`);
  }
}

export async function postBoardOpsResult(
  sessionId: string,
  requestId: string,
  result: BoardOpsResult,
): Promise<void> {
  const headers = await authorizedHeaders();
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/board/ops-result`,
    { method: "POST", headers, body: JSON.stringify({ requestId, result }) },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`postBoardOpsResult failed (${response.status}): ${text}`);
  }
}

export async function postSlotOpsResult(
  sessionId: string,
  requestId: string,
  result: SlotOpsResult,
): Promise<void> {
  const headers = await authorizedHeaders();
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/slots/ops-result`,
    { method: "POST", headers, body: JSON.stringify({ requestId, result }) },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`postSlotOpsResult failed (${response.status}): ${text}`);
  }
}

// The daemon's slot list is the source of truth — the slot-ops executor reads
// it directly so a slot pushed moments before an export is always visible,
// even if this tab's React state hasn't re-rendered yet.
export async function fetchSessionSlots(sessionId: string): Promise<Slot[]> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/state`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`fetchSessionSlots failed (${response.status}): ${text}`);
  }
  const payload = (await response.json()) as { slots?: Slot[] };
  return payload.slots ?? [];
}

export async function fetchSessions(): Promise<SessionSummary[]> {
  const response = await fetch("/api/sessions");
  if (!response.ok) throw new Error(`fetchSessions failed: ${response.status}`);
  const payload = await response.json();
  return payload.sessions ?? [];
}

export async function resetSession(sessionId: string): Promise<void> {
  const headers = await authorizedHeaders();
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/reset`,
    { method: "POST", headers },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`resetSession failed (${response.status}): ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Trace explorer endpoints (read-only GETs, no token required)
// ---------------------------------------------------------------------------

import type {
  GlobalCostReport,
  TraceProject,
  TraceSessionDetail,
  TraceSessionSummary,
} from "../shared/trace/api-types.ts";

export async function fetchTraceProjects(): Promise<TraceProject[]> {
  const response = await fetch("/api/trace/projects");
  if (!response.ok) throw new Error(`fetchTraceProjects failed: ${response.status}`);
  const payload = (await response.json()) as { projects: TraceProject[] };
  return payload.projects ?? [];
}

export async function fetchTraceSessions(projectId: string): Promise<TraceSessionSummary[]> {
  const response = await fetch(`/api/trace/projects/${encodeURIComponent(projectId)}/sessions`);
  if (!response.ok) throw new Error(`fetchTraceSessions failed: ${response.status}`);
  const payload = (await response.json()) as { sessions: TraceSessionSummary[] };
  return payload.sessions ?? [];
}

export async function fetchTraceSessionDetail(sessionId: string): Promise<TraceSessionDetail | null> {
  const response = await fetch(`/api/trace/sessions/${encodeURIComponent(sessionId)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`fetchTraceSessionDetail failed: ${response.status}`);
  return (await response.json()) as TraceSessionDetail;
}

export async function fetchGlobalCostReport(): Promise<GlobalCostReport> {
  const response = await fetch("/api/trace/costs");
  if (!response.ok) throw new Error(`fetchGlobalCostReport failed: ${response.status}`);
  return (await response.json()) as GlobalCostReport;
}

export async function fetchSubagentEntries(
  projectId: string,
  sessionId: string,
  agentId: string,
): Promise<Record<string, unknown>[] | null> {
  const encodedProjectId = encodeURIComponent(projectId);
  const encodedSessionId = encodeURIComponent(sessionId);
  const encodedAgentId = encodeURIComponent(agentId);
  const response = await fetch(
    `/api/trace/projects/${encodedProjectId}/sessions/${encodedSessionId}/subagents/${encodedAgentId}/entries`,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`fetchSubagentEntries failed: ${response.status}`);
  const payload = (await response.json()) as { entries: Record<string, unknown>[] };
  return payload.entries ?? [];
}
