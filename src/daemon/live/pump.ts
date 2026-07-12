// Per-slot state pump: sources hand it values, it batches them (≤10 flushes
// per second), applies them to the slot's state, broadcasts one slot-state
// delta per flush, and persists the slot at a slower cadence so disk writes
// never track a hot source.

import { getByPath, setByPath } from "@json-render/core";
import type { SlotStateChange } from "../../shared/types.ts";
import { broadcast, ensureSession } from "../sessions.ts";
import { persistSlot } from "../session-store.ts";
import { LiveApplyMode } from "./types.ts";

const FLUSH_MIN_INTERVAL_MS = 100;
const PERSIST_MIN_INTERVAL_MS = 2000;

export type SlotStatePump = {
  append: (statePath: string, records: Record<string, unknown>[], window: number) => void;
  replace: (statePath: string, value: unknown) => void;
  stop: () => void;
};

type PendingWrite =
  | { mode: typeof LiveApplyMode.Append; records: Record<string, unknown>[]; window: number }
  | { mode: typeof LiveApplyMode.Replace; value: unknown };

export function createSlotStatePump(
  sessionId: string,
  slotId: string,
  onSlotMissing: () => void,
): SlotStatePump {
  const pending = new Map<string, PendingWrite>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFlushAt = 0;
  let lastPersistAt = 0;
  let stopped = false;

  function append(statePath: string, records: Record<string, unknown>[], window: number): void {
    const existing = pending.get(statePath);
    const carried = existing?.mode === LiveApplyMode.Append ? existing.records : [];
    const combined = trimToWindow([...carried, ...records], window);
    pending.set(statePath, { mode: LiveApplyMode.Append, records: combined, window });
    scheduleFlush();
  }

  function replace(statePath: string, value: unknown): void {
    pending.set(statePath, { mode: LiveApplyMode.Replace, value });
    scheduleFlush();
  }

  function scheduleFlush(): void {
    if (stopped || flushTimer) return;
    const elapsed = Date.now() - lastFlushAt;
    const wait = Math.max(0, FLUSH_MIN_INTERVAL_MS - elapsed);
    flushTimer = setTimeout(flush, wait);
  }

  function flush(): void {
    flushTimer = null;
    lastFlushAt = Date.now();
    if (pending.size === 0) return;

    const session = ensureSession(sessionId);
    const slot = session.slots.find((candidate) => candidate.id === slotId);
    if (!slot) {
      pending.clear();
      if (!stopped) onSlotMissing();
      return;
    }

    const changes: SlotStateChange[] = [];
    for (const [statePath, write] of pending) {
      const nextValue = resolveNextValue(slot.state, statePath, write);
      setByPath(slot.state, statePath, nextValue);
      changes.push({ path: statePath, value: nextValue });
    }
    pending.clear();
    slot.updatedAt = Date.now();
    broadcast(session, { kind: "slot-state", data: { slotId, changes } });

    const persistDue = Date.now() - lastPersistAt >= PERSIST_MIN_INTERVAL_MS;
    if (persistDue) {
      lastPersistAt = Date.now();
      persistSlot(session.sessionId, slot);
    }
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flush();
    persistFinalState();
  }

  function persistFinalState(): void {
    const session = ensureSession(sessionId);
    const slot = session.slots.find((candidate) => candidate.id === slotId);
    if (slot) persistSlot(session.sessionId, slot);
  }

  return { append, replace, stop };
}

function resolveNextValue(
  state: Record<string, unknown>,
  statePath: string,
  write: PendingWrite,
): unknown {
  if (write.mode === LiveApplyMode.Replace) return write.value;
  return appendWithWindow(getByPath(state, statePath), write.records, write.window);
}

export function appendWithWindow(
  existing: unknown,
  records: Record<string, unknown>[],
  window: number,
): unknown[] {
  const base = Array.isArray(existing) ? existing : [];
  return trimToWindow([...base, ...records], window);
}

function trimToWindow<T>(points: T[], window: number): T[] {
  if (points.length <= window) return points;
  return points.slice(points.length - window);
}
