import { mkdirSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  SlotKind,
  SlotStatus,
  SlotOrigin,
  type Slot,
  type JsonRenderSpec,
} from "../shared/types.ts";
import { sessionSlotDir } from "./state.ts";
import { broadcast, ensureSession, getSession, type SessionRoom } from "./sessions.ts";

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function writeSlotStatusFile(session: SessionRoom, slot: Slot): void {
  const dir = sessionSlotDir(session.sessionId);
  mkdirSync(dir, { recursive: true });
  const payload = {
    id: slot.id,
    kind: slot.kind,
    status: slot.status,
    origin: slot.origin,
    title: slot.title,
    createdAt: slot.createdAt,
    updatedAt: slot.updatedAt,
  };
  writeFileSync(join(dir, `${slot.id}.json`), JSON.stringify(payload));
}

function removeSlotStatusFile(session: SessionRoom, slotId: string): void {
  const dir = sessionSlotDir(session.sessionId);
  const path = join(dir, `${slotId}.json`);
  if (existsSync(path)) unlinkSync(path);
}

export function clearSessionSlotDir(sessionId: string): void {
  const dir = sessionSlotDir(sessionId);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".json")) unlinkSync(join(dir, name));
  }
}

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
      writeSlotStatusFile(session, existing);
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
  writeSlotStatusFile(session, slot);
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
  writeSlotStatusFile(session, slot);
  broadcast(session, { kind: "slot-updated", data: slot });
  return slot;
}

export function removeSlot(sessionId: string, slotId: string): boolean {
  const session = getSession(sessionId);
  if (!session) return false;
  const before = session.slots.length;
  session.slots = session.slots.filter((slot) => slot.id !== slotId);
  if (session.slots.length === before) return false;
  removeSlotStatusFile(session, slotId);
  broadcast(session, { kind: "slot-removed", data: { slotId } });
  return true;
}

export function listSlots(sessionId: string): Slot[] {
  const session = getSession(sessionId);
  return session ? session.slots : [];
}
