import type { Slot } from "../shared/types.ts";
import { EditKind } from "../shared/types.ts";
import { postEdit } from "./api.ts";

// Build the action handler map for the active slot. Each handler is invoked
// by json-render's ActionProvider when a component emits the matching action
// from its `on.<event>` binding. Single egress point — components stay pure;
// the daemon-POST contract lives only here.
//
// Continuous edits (PlanFile markdown, DiffViewer after, MermaidEditor
// source, DataTable cell) flow via state binding + onStateChange, NOT via
// these handlers. Use actions only for discrete events.
export function buildCanvasActionHandlers(
  sessionId: string,
  slot: Slot,
): Record<string, (params: Record<string, unknown>) => Promise<void>> {
  return {
    // json-render deep-resolves {$state:"/path"} expressions in action params
    // against a live state snapshot before invoking handlers, so a binding
    // like { payload: { $state: "/form" } } arrives here as concrete data.
    "canvas.submit": async (params) => {
      const elementId = typeof params.id === "string" ? params.id : null;
      await postEdit(sessionId, {
        slotId: slot.id,
        elementId,
        kind: EditKind.FormSubmit,
        payload: params,
      });
    },
    // SECURITY: only the opaque id crosses the wire. The daemon resolves it
    // against the intent menu it recorded when the spec was pushed and
    // rejects ids the agent never offered — the page cannot author or alter
    // intent payloads.
    "canvas.intent": async (params) => {
      const intentId = typeof params.id === "string" ? params.id : "";
      if (!intentId) return;
      await postEdit(sessionId, {
        slotId: slot.id,
        elementId: intentId,
        kind: EditKind.Intent,
        payload: { id: intentId },
      });
    },
    "canvas.commentMermaid": async (params) => {
      const nodeId = String(params.nodeId ?? "");
      const body = String(params.body ?? "");
      if (!nodeId || !body) return;
      await postEdit(sessionId, {
        slotId: slot.id,
        elementId: `node:${nodeId}`,
        kind: EditKind.MermaidComment,
        payload: { nodeId, body },
      });
    },
    "canvas.flushPending": async () => {
      // No-op for now: state-binding edits flush via the debounced
      // onStateChange handler in App.tsx. Future use: trigger an
      // immediate WebSocket "flush" frame so the daemon knows to ack
      // and clear pending overlay early. Wired so Buttons that bind to
      // this don't trigger "No handler registered" warnings.
    },
  };
}

// Map a (slot, state-change) tuple to the appropriate canvas-edit POST.
// Called from the JSONUIProvider onStateChange callback at the App level —
// one place owns the wire format for all continuous edits.
export type StateChange = { path: string; value: unknown };

export async function postStateChanges(
  sessionId: string,
  slot: Slot,
  changes: StateChange[],
): Promise<void> {
  // Each component writes to a known state path. We map the path to the edit
  // kind so the daemon can route to the right overlay key.
  for (const change of changes) {
    const kind = editKindForPath(slot.kind, change.path);
    if (!kind) continue;
    const elementId = elementIdForPath(change.path);
    try {
      await postEdit(sessionId, {
        slotId: slot.id,
        elementId,
        kind,
        payload: { path: change.path, value: change.value },
      });
    } catch (error) {
      console.error("[canvas-actions] postEdit failed", { path: change.path, error });
    }
  }
}

function editKindForPath(slotKind: Slot["kind"], path: string): EditKind | null {
  // Path conventions used by our extension specs:
  //   /plan/markdown     → PlanEdit
  //   /diff/after        → DiffEdit
  //   /mermaid/source    → MermaidEdit
  //   /table/cells/...   → TableEdit
  // Fallback: use the slot kind as a heuristic for ambiguous paths.
  if (path.startsWith("/plan/")) return EditKind.PlanEdit;
  if (path.startsWith("/diff/")) return EditKind.DiffEdit;
  if (path.startsWith("/mermaid/")) return EditKind.MermaidEdit;
  if (path.startsWith("/table/")) return EditKind.TableEdit;
  switch (slotKind) {
    case "plan":
      return EditKind.PlanEdit;
    case "diff":
      return EditKind.DiffEdit;
    case "diagram":
      return EditKind.MermaidEdit;
    case "table":
      return EditKind.TableEdit;
    default:
      return EditKind.GenericEdit;
  }
}

function elementIdForPath(path: string): string {
  // Strip leading slash; collapse to a stable id token.
  return path.replace(/^\//, "").replace(/\//g, ".");
}
