import type { BoardOpsResult, BoardScene, EditKind, SessionSummary } from "../shared/types.ts";

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
