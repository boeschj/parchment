// Live source engine: owns every running source, keyed by (session, slot).
// The contract that keeps lifecycles simple: a slot's sources are set
// wholesale (replacing whatever ran before), die with their slot, and are
// persisted so a daemon restart resumes streaming without any agent involvement.
//
// SECURITY: command-poll is the one kind that executes something. It starts in
// PendingApproval unless the user has already approved that exact command text,
// and that holds on the rehydration path too — a persisted command-poll source
// whose command is not in the approval store comes back pending, never running.
// A restart can therefore never resurrect a shell loop the user did not approve.

import { broadcast, ensureSession } from "../sessions.ts";
import {
  listPersistedSessionIds,
  loadPersistedLiveSources,
  persistLiveSources,
} from "../session-store.ts";
import { LiveSourceStatus, type LiveSourceView } from "../../shared/types.ts";
import { approveCommand, isCommandApproved, type CommandApprovalScope } from "./approved-commands.ts";
import { startClaudeSessionsSource } from "./claude-sessions.ts";
import { startCommandPoll } from "./command-poll.ts";
import { startFileTail } from "./file-tail.ts";
import { startHttpPoll } from "./http-poll.ts";
import { createSlotStatePump, type SlotStatePump } from "./pump.ts";
import {
  LiveSourceKind,
  liveSourceIntervalMs,
  liveSourceTarget,
  type LiveSourceConfig,
} from "./types.ts";

const REHYDRATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type RunningSource = {
  config: LiveSourceConfig;
  stop: () => void;
  status: LiveSourceStatus;
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
  publishLiveSources(sessionId);
}

function startSlotSources(sessionId: string, slotId: string, configs: LiveSourceConfig[]): void {
  stopSlotSources(sessionId, slotId);
  if (configs.length === 0) return;

  const pump = createSlotStatePump(sessionId, slotId, () =>
    stopSlotLiveSources(sessionId, slotId),
  );
  const sources = new Map<string, RunningSource>();
  for (const config of configs) {
    sources.set(config.id, startSource(sessionId, config, pump));
  }
  runningSlots.set(slotKey(sessionId, slotId), { sessionId, slotId, pump, sources });
}

function startSource(
  sessionId: string,
  config: LiveSourceConfig,
  pump: SlotStatePump,
): RunningSource {
  const running: RunningSource = {
    config,
    stop: () => {},
    status: LiveSourceStatus.Running,
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
      if (!isCommandApproved(sessionId, config.command)) {
        running.status = LiveSourceStatus.PendingApproval;
        break;
      }
      running.stop = startCommandPoll(sessionId, config, pump, reportError);
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

// Approve the command behind one pending source and start it. Approval is
// recorded against the command TEXT, so every other pending source running the
// same command (in this session, and — for a persistent approval — in any
// future one) becomes runnable too; they are all started here rather than left
// stranded in a state the user believes they cleared.
export function approveSlotSource(
  sessionId: string,
  slotId: string,
  sourceId: string,
  scope: CommandApprovalScope,
): LiveSourceView | null {
  const pending = findSource(sessionId, slotId, sourceId);
  if (!pending || pending.source.config.kind !== LiveSourceKind.CommandPoll) return null;

  approveCommand(sessionId, pending.source.config.command, scope);
  startApprovedSources(sessionId);
  publishLiveSources(sessionId);

  const started = findSource(sessionId, slotId, sourceId);
  if (!started) return null;
  return sourceView(slotId, started.source);
}

function startApprovedSources(sessionId: string): void {
  for (const slot of slotsOfSession(sessionId)) {
    for (const [sourceId, source] of slot.sources) {
      const isPending = source.status === LiveSourceStatus.PendingApproval;
      if (!isPending) continue;
      slot.sources.set(sourceId, startSource(sessionId, source.config, slot.pump));
    }
  }
}

// Stop and forget one source. This is what both "Stop" (a running source) and
// "Deny" (a pending one) call: a denied command must not linger in live.json
// waiting to prompt again on the next boot.
export function stopSlotSource(sessionId: string, slotId: string, sourceId: string): boolean {
  const found = findSource(sessionId, slotId, sourceId);
  if (!found) return false;

  found.source.stop();
  found.slot.sources.delete(sourceId);
  const slotIsEmpty = found.slot.sources.size === 0;
  if (slotIsEmpty) {
    runningSlots.delete(slotKey(sessionId, slotId));
    found.slot.pump.stop();
  }
  persistSessionLiveState(sessionId);
  publishLiveSources(sessionId);
  return true;
}

export function stopSlotLiveSources(sessionId: string, slotId: string): void {
  const hadSources = stopSlotSources(sessionId, slotId);
  if (!hadSources) return;
  persistSessionLiveState(sessionId);
  publishLiveSources(sessionId);
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
  publishLiveSources(sessionId);
}

// Process exit: kill every child before the daemon goes away. No broadcast and
// no persistence rewrite — the bindings on disk must survive to rehydrate.
export function stopAllLiveSources(): void {
  for (const slot of Array.from(runningSlots.values())) {
    stopSlotSources(slot.sessionId, slot.slotId);
  }
}

export function listSessionLiveSources(sessionId: string): LiveSourceView[] {
  const views: LiveSourceView[] = [];
  for (const slot of slotsOfSession(sessionId)) {
    for (const source of slot.sources.values()) {
      views.push(sourceView(slot.slotId, source));
    }
  }
  return views;
}

export function listPendingApprovalSourceIds(sessionId: string, slotId: string): string[] {
  const slot = runningSlots.get(slotKey(sessionId, slotId));
  if (!slot) return [];
  return Array.from(slot.sources.values())
    .filter((source) => source.status === LiveSourceStatus.PendingApproval)
    .map((source) => source.config.id);
}

// Daemon boot: resume streaming for every recently-touched session whose
// slots still exist. Restarts happen routinely (plugin updates at session
// start), and a dashboard that silently dies on restart breaks the promise
// that the daemon keeps it alive. Unapproved command-poll sources come back
// pending — see the security note at the top of this file.
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

type FoundSource = { slot: SlotSources; source: RunningSource };

function findSource(sessionId: string, slotId: string, sourceId: string): FoundSource | null {
  const slot = runningSlots.get(slotKey(sessionId, slotId));
  if (!slot) return null;
  const source = slot.sources.get(sourceId);
  if (!source) return null;
  return { slot, source };
}

function sourceView(slotId: string, source: RunningSource): LiveSourceView {
  return {
    slotId,
    sourceId: source.config.id,
    kind: source.config.kind,
    target: liveSourceTarget(source.config),
    statePath: source.config.statePath,
    intervalMs: liveSourceIntervalMs(source.config),
    status: source.status,
    startedAt: source.startedAt,
    lastError: source.lastError,
  };
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

// The browser's live-source panel and its approval prompt are driven by this —
// a source that starts, stops, or goes pending shows up without a poll.
function publishLiveSources(sessionId: string): void {
  const session = ensureSession(sessionId);
  broadcast(session, {
    kind: "live-sources",
    data: { sources: listSessionLiveSources(sessionId) },
  });
}
