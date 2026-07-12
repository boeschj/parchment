// Live source engine: owns every running source, keyed by (session, slot).
// The contract that keeps lifecycles simple: a slot's sources are set
// wholesale (replacing whatever ran before), die with their slot, and are
// persisted so a daemon restart resumes streaming without any agent involvement.

import { ensureSession } from "../sessions.ts";
import {
  listPersistedSessionIds,
  loadPersistedLiveSources,
  persistLiveSources,
} from "../session-store.ts";
import { startClaudeSessionsSource } from "./claude-sessions.ts";
import { startCommandPoll } from "./command-poll.ts";
import { startFileTail } from "./file-tail.ts";
import { startHttpPoll } from "./http-poll.ts";
import { createSlotStatePump, type SlotStatePump } from "./pump.ts";
import { LiveSourceKind, type LiveSourceConfig } from "./types.ts";

const REHYDRATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type RunningSourceView = {
  slotId: string;
  config: LiveSourceConfig;
  startedAt: number;
  lastError: string | null;
};

type RunningSource = {
  config: LiveSourceConfig;
  stop: () => void;
  startedAt: number;
  lastError: string | null;
};

type SlotSources = {
  sessionId: string;
  slotId: string;
  pump: SlotStatePump;
  sources: Map<string, RunningSource>;
};

const runningSlots = new Map<string, SlotSources>();

function slotKey(sessionId: string, slotId: string): string {
  return `${sessionId}::${slotId}`;
}

export function setSlotLiveSources(
  sessionId: string,
  slotId: string,
  configs: LiveSourceConfig[],
): void {
  startSlotSources(sessionId, slotId, configs);
  persistSessionLiveState(sessionId);
}

function startSlotSources(sessionId: string, slotId: string, configs: LiveSourceConfig[]): void {
  stopSlotSources(sessionId, slotId);
  if (configs.length === 0) return;

  const pump = createSlotStatePump(sessionId, slotId, () =>
    stopSlotLiveSources(sessionId, slotId),
  );
  const sources = new Map<string, RunningSource>();
  for (const config of configs) {
    sources.set(config.id, startSource(config, pump));
  }
  runningSlots.set(slotKey(sessionId, slotId), { sessionId, slotId, pump, sources });
}

function startSource(config: LiveSourceConfig, pump: SlotStatePump): RunningSource {
  const running: RunningSource = {
    config,
    stop: () => {},
    startedAt: Date.now(),
    lastError: null,
  };
  const reportError = (message: string | null): void => {
    running.lastError = message;
  };

  switch (config.kind) {
    case LiveSourceKind.FileTail:
      running.stop = startFileTail(config, pump);
      break;
    case LiveSourceKind.CommandPoll:
      running.stop = startCommandPoll(config, pump, reportError);
      break;
    case LiveSourceKind.HttpPoll:
      running.stop = startHttpPoll(config, pump, reportError);
      break;
    case LiveSourceKind.ClaudeSessions:
      running.stop = startClaudeSessionsSource(config, pump);
      break;
  }
  return running;
}

export function stopSlotLiveSources(sessionId: string, slotId: string): void {
  const hadSources = stopSlotSources(sessionId, slotId);
  if (hadSources) persistSessionLiveState(sessionId);
}

function stopSlotSources(sessionId: string, slotId: string): boolean {
  const key = slotKey(sessionId, slotId);
  const slot = runningSlots.get(key);
  if (!slot) return false;
  runningSlots.delete(key);
  for (const source of slot.sources.values()) {
    source.stop();
  }
  slot.pump.stop();
  return true;
}

export function stopSessionLiveSources(sessionId: string): void {
  for (const slot of slotsOfSession(sessionId)) {
    stopSlotSources(slot.sessionId, slot.slotId);
  }
  persistSessionLiveState(sessionId);
}

export function stopAllLiveSources(): void {
  for (const slot of Array.from(runningSlots.values())) {
    stopSlotSources(slot.sessionId, slot.slotId);
  }
}

export function listSessionLiveSources(sessionId: string): RunningSourceView[] {
  const views: RunningSourceView[] = [];
  for (const slot of slotsOfSession(sessionId)) {
    for (const source of slot.sources.values()) {
      views.push({
        slotId: slot.slotId,
        config: source.config,
        startedAt: source.startedAt,
        lastError: source.lastError,
      });
    }
  }
  return views;
}

// Daemon boot: resume streaming for every recently-touched session whose
// slots still exist. Restarts happen routinely (plugin updates at session
// start), and a dashboard that silently dies on restart breaks the promise
// that the daemon keeps it alive.
export function rehydratePersistedLiveSources(): void {
  for (const sessionId of listPersistedSessionIds()) {
    const persisted = loadPersistedLiveSources(sessionId);
    const isStale = Date.now() - persisted.savedAt > REHYDRATE_MAX_AGE_MS;
    if (isStale) continue;

    const session = ensureSession(sessionId);
    for (const [slotId, configs] of Object.entries(persisted.slots)) {
      const slotExists = session.slots.some((slot) => slot.id === slotId);
      if (!slotExists || configs.length === 0) continue;
      startSlotSources(sessionId, slotId, configs);
    }
  }
}

function slotsOfSession(sessionId: string): SlotSources[] {
  return Array.from(runningSlots.values()).filter((slot) => slot.sessionId === sessionId);
}

function persistSessionLiveState(sessionId: string): void {
  const bindings: Record<string, LiveSourceConfig[]> = {};
  for (const slot of slotsOfSession(sessionId)) {
    bindings[slot.slotId] = Array.from(slot.sources.values()).map((source) => source.config);
  }
  persistLiveSources(sessionId, bindings);
}
