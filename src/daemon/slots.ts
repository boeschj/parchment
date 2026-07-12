import {
  SlotKind,
  SlotStatus,
  SlotOrigin,
  type Slot,
  type JsonRenderSpec,
  type SlotOps,
  type SlotOpsResult,
  type WsEvent,
} from "../shared/types.ts";
import { persistSlot, removePersistedSlot } from "./session-store.ts";
import { generateId } from "./ids.ts";
import {
  broadcast,
  ensureSession,
  getSession,
  type SessionRoom,
  type WebSocketSubscriber,
} from "./sessions.ts";

// Slot ops hold the HTTP request open while one browser tab renders and
// snapshots the slot.
const SLOT_OPS_TIMEOUT_MS = 15_000;

export type UpsertSlotInput = {
  sessionId: string;
  cwd?: string;
  kind: SlotKind;
  title: string;
  spec: JsonRenderSpec;
  origin: SlotOrigin;
  slotId?: string;
  status?: SlotStatus;
  state?: Record<string, unknown>;
};

export function upsertSlot(input: UpsertSlotInput): Slot {
  const session = ensureSession(input.sessionId, input.cwd ?? "");
  const now = Date.now();
  const status = input.status ?? SlotStatus.Ready;

  const seededState = seedInitialState(input.spec, input.state);

  if (input.slotId) {
    const existing = session.slots.find((slot) => slot.id === input.slotId);
    if (existing) {
      existing.kind = input.kind;
      existing.title = input.title;
      existing.spec = input.spec;
      existing.status = status;
      existing.origin = input.origin;
      existing.updatedAt = now;
      if (seededState) existing.state = seededState;
      persistSlot(session.sessionId, existing);
      broadcast(session, { kind: "slot-updated", data: existing });
      return existing;
    }
  }

  const slot: Slot = {
    id: input.slotId ?? generateId("slot"),
    kind: input.kind,
    status,
    origin: input.origin,
    title: input.title,
    spec: input.spec,
    state: seededState ?? {},
    createdAt: now,
    updatedAt: now,
  };
  session.slots.push(slot);
  persistSlot(session.sessionId, slot);
  broadcast(session, { kind: "slot-added", data: slot });
  return slot;
}

export function markSlotError(sessionId: string, slotId: string, errorMessage: string): Slot | null {
  const session = getSession(sessionId);
  if (!session) return null;
  const slot = session.slots.find((candidate) => candidate.id === slotId);
  if (!slot) return null;
  slot.status = SlotStatus.Error;
  slot.errorMessage = errorMessage;
  slot.updatedAt = Date.now();
  persistSlot(session.sessionId, slot);
  broadcast(session, { kind: "slot-updated", data: slot });
  return slot;
}

export function removeSlot(sessionId: string, slotId: string): boolean {
  const session = getSession(sessionId);
  if (!session) return false;
  const before = session.slots.length;
  session.slots = session.slots.filter((slot) => slot.id !== slotId);
  if (session.slots.length === before) return false;
  removePersistedSlot(sessionId, slotId);
  broadcast(session, { kind: "slot-removed", data: { slotId } });
  return true;
}

export function listSlots(sessionId: string): Slot[] {
  const session = getSession(sessionId);
  return session ? session.slots : [];
}

// Explicit state from the request body wins; otherwise the spec's own
// declared initial state seeds the slot. Deep copy so later state mutations
// never write back into the stored spec.
function seedInitialState(
  spec: JsonRenderSpec,
  explicitState?: Record<string, unknown>,
): Record<string, unknown> | null {
  if (explicitState) return explicitState;
  if (spec.state) return structuredClone(spec.state);
  return null;
}

// ---------------------------------------------------------------------------
// Slot ops round-trip.
// ---------------------------------------------------------------------------

type PendingSlotOps = {
  resolve: (result: SlotOpsResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pendingSlotOps = new Map<string, PendingSlotOps>();

// Per-session serialization: overlapping ops in the executing tab would race
// each other. The chain never rejects (results are values), so one failure
// doesn't wedge the queue.
const slotOpsQueues = new Map<string, Promise<SlotOpsResult>>();

// Relay ops to EVERY connected tab and hold the request until the first one
// reports back under the same requestId. Broadcast, not unicast: subscriber
// iteration order is connection age, and a stale tab (pre-reload bundle, no
// slot-ops listener) that happens to be oldest would swallow a unicast
// forever. Redundant offscreen renders in other tabs are wasted but harmless —
// resolveSlotOps takes the first result and acknowledges the rest as false.
export function requestSlotOps(
  session: SessionRoom,
  ops: SlotOps,
  canvasUrl: string,
): Promise<SlotOpsResult> {
  const previous = slotOpsQueues.get(session.sessionId) ?? Promise.resolve({ ok: true });
  const run = previous.then(() => dispatchSlotOps(session, ops, canvasUrl));
  slotOpsQueues.set(session.sessionId, run);
  return run;
}

function dispatchSlotOps(
  session: SessionRoom,
  ops: SlotOps,
  canvasUrl: string,
): Promise<SlotOpsResult> {
  if (session.subscribers.size === 0) {
    return Promise.resolve({
      ok: false,
      error: `no canvas tab is connected — ask the user to open ${canvasUrl}, then retry`,
    });
  }

  const requestId = generateId("slotops");
  return new Promise<SlotOpsResult>((resolve) => {
    const timer = setTimeout(() => {
      pendingSlotOps.delete(requestId);
      resolve({ ok: false, error: "slot ops timed out — the canvas tab may be unresponsive" });
    }, SLOT_OPS_TIMEOUT_MS);
    pendingSlotOps.set(requestId, { resolve, timer });
    const event: WsEvent = { kind: "slot-ops", data: { requestId, ops } };
    const frame = JSON.stringify(event);
    for (const subscriber of session.subscribers) {
      subscriber.send(frame);
    }
  });
}

// First result wins: resolving deletes the pending entry, so a duplicate or
// late post for the same requestId is acknowledged as false and ignored.
export function resolveSlotOps(requestId: string, result: SlotOpsResult): boolean {
  const pending = pendingSlotOps.get(requestId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pendingSlotOps.delete(requestId);
  pending.resolve(result);
  return true;
}
