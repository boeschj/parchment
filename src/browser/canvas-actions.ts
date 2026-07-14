import type { Slot } from "../shared/types.ts";
import { EditKind } from "../shared/types.ts";
import { postEdit } from "./api.ts";

export const CANVAS_SUBMIT_ACTION = "canvas.submit";

export type CanvasActionHandler = (params: Record<string, unknown>) => Promise<void>;

// Build the action handler map for the active slot. Each handler is invoked
// by json-render's ActionProvider when a component emits the matching action
// from its `on.<event>` binding. Single egress point — components stay pure;
// the daemon-POST contract lives only here.
//
// canvas.submit is deliberately NOT in this map: delivering a form submit
// requires running the form's validation checks first, and those live in
// json-render's ValidationProvider, which is mounted INSIDE JSONUIProvider —
// below the level this map is built at. It is registered from inside the
// provider tree instead (useValidatedCanvasSubmit.ts), which is the only place
// that can reach validateAll(). Handlers here must stay validation-free.
//
// Continuous edits (PlanFile markdown, DiffViewer after, MermaidEditor
// source, DataTable cell) flow via state binding + onStateChange, NOT via
// these handlers. Use actions only for discrete events.
export function buildCanvasActionHandlers(
  sessionId: string,
  slot: Slot,
): Record<string, CanvasActionHandler> {
  return {
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

// ---- Form submit -----------------------------------------------------------

// A form submit is delivered only when every registered check passes.
//
// A field carrying `checks` registers them with json-render's ValidationProvider
// and then re-runs them ITSELF on change or on blur — that, and only that, is
// what `validateOn` selects. No field ever validates because a submit happened:
// validateAll() is the sole trigger for the registered checks, and before this
// handler existed its only caller was json-render's built-in `validateForm`
// action, which a Button wired to canvas.submit never dispatches. So the checks
// on a validateOn:"submit" field were registered and never run, and an empty
// required field submitted clean.
//
// Running validateAll() here fixes that for every mode at once, and is the
// stronger contract regardless of mode: a blur-mode required field the user
// never focused has also never validated, and must not submit empty either.
// validateAll() writes each failing field's result into validation state, which
// is what makes the fields render their own error text — so a refusal is
// visible per field, not just silent.
export function createFormSubmitHandler(
  sessionId: string,
  slot: Slot,
  validateAll: () => boolean,
): CanvasActionHandler {
  return async (params) => {
    const isFormValid = validateAll();
    if (!isFormValid) return;
    await postFormSubmit(sessionId, slot, params);
  };
}

// json-render deep-resolves {$state:"/path"} expressions in action params
// against a live state snapshot before invoking handlers, so a binding like
// { payload: { $state: "/form" } } arrives here as concrete data.
export async function postFormSubmit(
  sessionId: string,
  slot: Slot,
  params: Record<string, unknown>,
): Promise<void> {
  const elementId = typeof params.id === "string" ? params.id : null;
  await postEdit(sessionId, {
    slotId: slot.id,
    elementId,
    kind: EditKind.FormSubmit,
    payload: params,
  });
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
