import type {
  Slot,
  OverlayEntry,
  Edit,
  WsEvent,
} from "../shared/types.ts";
import {
  loadPersistedSlots,
  loadPersistedEdits,
  loadSessionMeta,
  listPersistedSessionIds,
  overlayKey,
} from "./session-store.ts";

export type WebSocketSubscriber = {
  send: (data: string) => void;
  sessionId: string;
};

export type WebSocketAttachment = {
  sessionId: string;
  subscriber?: WebSocketSubscriber;
};

export type SessionRoom = {
  sessionId: string;
  cwd: string;
  slots: Slot[];
  pendingEdits: Edit[];
  overlay: Map<string, OverlayEntry>;
  subscribers: Set<WebSocketSubscriber>;
  transcriptPath: string | null;
  createdAt: number;
  lastPing: number;
};

const sessions = new Map<string, SessionRoom>();

// Disk persistence makes eviction lossless, so the in-memory map stays
// bounded no matter how many session ids requests invent.
const MAX_RESIDENT_SESSIONS = 50;

// A room missing from the map is either brand new or predates a daemon
// restart — hydrating from disk covers both, so restarts are lossless.
export function ensureSession(sessionId: string, cwd: string = ""): SessionRoom {
  const existing = sessions.get(sessionId);
  if (existing) {
    if (cwd !== "" && existing.cwd !== cwd) existing.cwd = cwd;
    return existing;
  }
  evictStalestIfFull();
  const persisted = loadPersistedEdits(sessionId);
  const overlay = new Map(
    persisted.overlayEntries.map((entry) => [overlayKey(entry.slotId, entry.elementId), entry]),
  );
  const now = Date.now();
  const fresh: SessionRoom = {
    sessionId,
    cwd,
    slots: loadPersistedSlots(sessionId),
    pendingEdits: persisted.pendingEdits,
    overlay,
    subscribers: new Set(),
    transcriptPath: loadSessionMeta(sessionId).transcriptPath,
    createdAt: now,
    lastPing: now,
  };
  sessions.set(sessionId, fresh);
  return fresh;
}

function evictStalestIfFull(): void {
  if (sessions.size < MAX_RESIDENT_SESSIONS) return;
  let stalest: SessionRoom | null = null;
  for (const session of sessions.values()) {
    if (session.subscribers.size > 0) continue;
    if (stalest === null || session.lastPing < stalest.lastPing) stalest = session;
  }
  if (stalest) sessions.delete(stalest.sessionId);
}

export function getSession(sessionId: string): SessionRoom | undefined {
  return sessions.get(sessionId);
}

// Heartbeats arrive without a token (statusline GET), so they only revive
// sessions that legitimately exist — in memory, or persisted on disk by a
// token-bearing hook. Unknown ids are ignored rather than allocated.
export function pingKnownSession(sessionId: string): SessionRoom | null {
  const existing = sessions.get(sessionId);
  if (existing) {
    existing.lastPing = Date.now();
    return existing;
  }
  const persistedIds = new Set(listPersistedSessionIds());
  if (!persistedIds.has(sanitizeForSessionDir(sessionId))) return null;
  return pingSession(sessionId);
}

function sanitizeForSessionDir(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function listSessions(): SessionRoom[] {
  return Array.from(sessions.values());
}

export function pingSession(sessionId: string): SessionRoom {
  const session = ensureSession(sessionId);
  session.lastPing = Date.now();
  return session;
}

export function broadcast(session: SessionRoom, event: WsEvent): void {
  const serialized = JSON.stringify(event);
  for (const subscriber of session.subscribers) {
    subscriber.send(serialized);
  }
}

export function sessionSnapshot(session: SessionRoom): { sessionId: string; slots: Slot[] } {
  return {
    sessionId: session.sessionId,
    slots: session.slots,
  };
}

// Compact session id for short-URL aliasing: lowercase hex slice.
// Statusline emits "localhost:PORT/s/<6 hex>"; resolve back via prefix match.
export function shortAliasOf(sessionId: string): string {
  return sessionId.toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 6);
}

export function resolveSessionByShortAlias(alias: string): string | null {
  const normalized = alias.toLowerCase();
  const knownIds = [...sessions.keys(), ...listPersistedSessionIds()];
  for (const sessionId of knownIds) {
    if (shortAliasOf(sessionId) === normalized) return sessionId;
  }
  for (const sessionId of knownIds) {
    if (sessionId.toLowerCase().startsWith(normalized)) return sessionId;
  }
  return null;
}
