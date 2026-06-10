import {
  SlotKind,
  SlotStatus,
  SlotOrigin,
  type Slot,
  type JsonRenderSpec,
} from "../shared/types.ts";
import { persistSlot, removePersistedSlot } from "./session-store.ts";
import { generateId } from "./ids.ts";
import { broadcast, ensureSession, getSession } from "./sessions.ts";

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

  if (input.slotId) {
    const existing = session.slots.find((slot) => slot.id === input.slotId);
    if (existing) {
      existing.kind = input.kind;
      existing.title = input.title;
      existing.spec = input.spec;
      existing.status = status;
      existing.origin = input.origin;
      existing.updatedAt = now;
      if (input.state) existing.state = input.state;
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
    state: input.state ?? {},
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
