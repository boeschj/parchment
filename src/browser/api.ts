import type {
  CommandApprovalScope,
  EditKind,
  LibraryEntry,
  LibraryListing,
  LiveSourceView,
  SessionSummary,
  Slot,
  SlotOpsResult,
} from "../shared/types.ts";
import { SlotOrigin } from "../shared/types.ts";

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

// Relay a whitelisted JSON-RPC call from an app iframe to its app server.
// This function is a dumb pipe: it names the SLOT the iframe belongs to and the
// daemon does the rest — it resolves the server from that slot's grant and
// rejects any tool the server did not declare app-visible. The page never gets
// to say which server a call reaches, so a compromised iframe cannot argue its
// way onto another app's server.
export async function postAppBridgeCall(
  sessionId: string,
  slotId: string,
  call: { method: string; params: Record<string, unknown> },
): Promise<unknown> {
  const headers = await authorizedHeaders();
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/apps/${encodeURIComponent(slotId)}/bridge`,
    { method: "POST", headers, body: JSON.stringify(call) },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`app bridge call failed (${response.status}): ${text}`);
  }
  const payload = (await response.json()) as { result: unknown };
  return payload.result;
}

export async function fetchLiveSources(sessionId: string): Promise<LiveSourceView[]> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/live`);
  if (!response.ok) throw new Error(`fetchLiveSources failed: ${response.status}`);
  const payload = (await response.json()) as { sources?: LiveSourceView[] };
  return payload.sources ?? [];
}

// The user consenting to a command-poll source: this is the ONLY way a
// recurring shell command starts running.
export async function approveLiveSource(
  sessionId: string,
  slotId: string,
  sourceId: string,
  scope: CommandApprovalScope,
): Promise<void> {
  const headers = await authorizedHeaders();
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/live/approve`, {
    method: "POST",
    headers,
    body: JSON.stringify({ slotId, sourceId, scope }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`approveLiveSource failed (${response.status}): ${text}`);
  }
}

// Stop a running source, or deny a pending one — the same operation either way.
export async function stopLiveSource(
  sessionId: string,
  slotId: string,
  sourceId: string,
): Promise<void> {
  const headers = await authorizedHeaders();
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/live/stop`, {
    method: "POST",
    headers,
    body: JSON.stringify({ slotId, sourceId }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`stopLiveSource failed (${response.status}): ${text}`);
  }
}

// Ship file bytes to the daemon, which stores them under ~/.parchment/uploads
// and records a file-upload edit carrying the PATH (never the contents).
export async function uploadCanvasFile(
  sessionId: string,
  slotId: string,
  elementId: string | null,
  file: File,
): Promise<{ savedPath: string }> {
  const token = await ensureToken();
  const formData = new FormData();
  formData.set("file", file);
  formData.set("slotId", slotId);
  if (elementId) formData.set("elementId", elementId);
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/uploads`, {
    method: "POST",
    headers: { [TOKEN_HEADER]: token },
    body: formData,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`upload failed (${response.status}): ${text}`);
  }
  return (await response.json()) as { savedPath: string };
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

export async function fetchLibraryEntries(): Promise<LibraryListing[]> {
  const response = await fetch("/api/library");
  if (!response.ok) throw new Error(`fetchLibraryEntries failed: ${response.status}`);
  const payload = (await response.json()) as { entries?: LibraryListing[] };
  return payload.entries ?? [];
}

export async function deleteLibraryEntry(name: string): Promise<void> {
  const headers = await authorizedHeaders();
  const response = await fetch(`/api/library/${encodeURIComponent(name)}`, { method: "DELETE", headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`deleteLibraryEntry failed (${response.status}): ${text}`);
  }
}

// Loads a saved entry's full spec and pushes it into a new slot in the given
// session — the browser-panel equivalent of canvas_library (action "load").
export async function openLibraryEntryInSlot(sessionId: string, name: string): Promise<Slot> {
  const entryResponse = await fetch(`/api/library/${encodeURIComponent(name)}`);
  if (!entryResponse.ok) {
    const text = await entryResponse.text();
    throw new Error(`fetchLibraryEntry failed (${entryResponse.status}): ${text}`);
  }
  const { entry } = (await entryResponse.json()) as { entry: LibraryEntry };

  const headers = await authorizedHeaders();
  const slotResponse = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/slots`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      kind: entry.kind,
      title: entry.title,
      spec: entry.spec,
      origin: SlotOrigin.SlashCommand,
      ...(entry.state ? { state: entry.state } : {}),
    }),
  });
  if (!slotResponse.ok) {
    const text = await slotResponse.text();
    throw new Error(`openLibraryEntryInSlot failed (${slotResponse.status}): ${text}`);
  }
  const payload = (await slotResponse.json()) as { slot: Slot };
  return payload.slot;
}
