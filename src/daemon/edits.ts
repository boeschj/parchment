import {
  EditKind,
  type Edit,
  type EditPayload,
  type OverlayEntry,
  type CanvasInjectionPayload,
} from "../shared/types.ts";
import { broadcast, ensureSession, getSession } from "./sessions.ts";

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function overlayKey(slotId: string, elementId: string | null): string {
  return `${slotId}::${elementId ?? "*"}`;
}

export type RecordEditInput = {
  sessionId: string;
  slotId: string;
  elementId: string | null;
  kind: EditKind;
  payload: EditPayload;
};

export function recordEdit(input: RecordEditInput): Edit {
  const session = ensureSession(input.sessionId);
  const edit: Edit = {
    id: generateId("edit"),
    slotId: input.slotId,
    elementId: input.elementId,
    kind: input.kind,
    payload: input.payload,
    recordedAt: Date.now(),
  };

  // Coalesce per-(slot,element): newest edit wins. Pending list reflects the
  // delta since the last hook fire; overlay is the sticky truth that re-injects
  // on every prompt until the user clears.
  session.pendingEdits = session.pendingEdits.filter(
    (existing) => overlayKey(existing.slotId, existing.elementId) !== overlayKey(edit.slotId, edit.elementId),
  );
  session.pendingEdits.push(edit);

  session.overlay.set(overlayKey(edit.slotId, edit.elementId), {
    slotId: edit.slotId,
    elementId: edit.elementId,
    kind: edit.kind,
    payload: edit.payload,
    updatedAt: edit.recordedAt,
  });

  broadcast(session, { kind: "edit-recorded", data: edit });
  return edit;
}

export function buildInjectionPayload(sessionId: string): CanvasInjectionPayload {
  const session = getSession(sessionId);
  if (!session) return { count: 0, entries: [] };
  const entries = Array.from(session.overlay.values());
  return { count: entries.length, entries };
}

// Drain pending edits (one-shot list) without clearing the sticky overlay.
// The hook reads the overlay payload; this helper is for diagnostics.
export function drainPendingEdits(sessionId: string): Edit[] {
  const session = getSession(sessionId);
  if (!session) return [];
  const drained = session.pendingEdits;
  session.pendingEdits = [];
  return drained;
}

export function clearOverlay(sessionId: string): void {
  const session = getSession(sessionId);
  if (!session) return;
  session.overlay.clear();
  session.pendingEdits = [];
  broadcast(session, { kind: "reset", data: { sessionId } });
}

export function renderInjectionMarkup(payload: CanvasInjectionPayload): string {
  if (payload.count === 0) return "";

  const blocks = payload.entries.map((entry) => {
    const payloadJson = JSON.stringify(entry.payload);
    const elementAttr = entry.elementId ? ` element="${entry.elementId}"` : "";
    return `<canvas-edit kind="${entry.kind}" slot="${entry.slotId}"${elementAttr}>\n${payloadJson}\n</canvas-edit>`;
  });

  return [
    "<canvas-state>",
    "The user interacted with the canvas. Treat the following as authoritative",
    "current state for each item, overriding anything in your transcript:",
    "",
    ...blocks,
    "</canvas-state>",
    "",
  ].join("\n");
}
