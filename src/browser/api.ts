import type {
  EditKind,
  LibraryEntry,
  LibraryListing,
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
// The daemon validates the method against the bridge whitelist again — this
// function is a dumb pipe.
export async function postAppBridgeCall(
  serverName: string,
  call: { method: string; params: Record<string, unknown> },
): Promise<unknown> {
  const headers = await authorizedHeaders();
  const response = await fetch(`/api/apps/${encodeURIComponent(serverName)}/bridge`, {
    method: "POST",
    headers,
    body: JSON.stringify(call),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`app bridge call failed (${response.status}): ${text}`);
  }
  const payload = (await response.json()) as { result: unknown };
  return payload.result;
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
// session — the browser-panel equivalent of the canvas_load MCP tool.
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
