import type {
  Slot,
  OverlayEntry,
  Edit,
  WsEvent,
} from "../shared/types.ts";

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
  createdAt: number;
  lastPing: number;
};

const sessions = new Map<string, SessionRoom>();
let onEmptyMap: (() => void) | null = null;
let onSessionCreated: (() => void) | null = null;

export function configureSessionLifecycleHooks(hooks: {
  onEmptyMap: () => void;
  onSessionCreated: () => void;
}): void {
  onEmptyMap = hooks.onEmptyMap;
  onSessionCreated = hooks.onSessionCreated;
}

export function ensureSession(sessionId: string, cwd: string = ""): SessionRoom {
  const existing = sessions.get(sessionId);
  if (existing) {
    if (cwd !== "" && existing.cwd === "") existing.cwd = cwd;
    return existing;
  }
  const now = Date.now();
  const fresh: SessionRoom = {
    sessionId,
    cwd,
    slots: [],
    pendingEdits: [],
    overlay: new Map(),
    subscribers: new Set(),
    createdAt: now,
    lastPing: now,
  };
  sessions.set(sessionId, fresh);
  if (onSessionCreated) onSessionCreated();
  return fresh;
}

export function getSession(sessionId: string): SessionRoom | undefined {
  return sessions.get(sessionId);
}

export function listSessions(): SessionRoom[] {
  return Array.from(sessions.values());
}

export function pingSession(sessionId: string): SessionRoom {
  const session = ensureSession(sessionId);
  session.lastPing = Date.now();
  return session;
}

export function evictSession(sessionId: string): void {
  sessions.delete(sessionId);
  if (sessions.size === 0 && onEmptyMap) onEmptyMap();
}

export function totalSubscriberCount(): number {
  let count = 0;
  for (const session of sessions.values()) count += session.subscribers.size;
  return count;
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
  for (const sessionId of sessions.keys()) {
    if (shortAliasOf(sessionId) === normalized) return sessionId;
  }
  for (const sessionId of sessions.keys()) {
    if (sessionId.toLowerCase().startsWith(normalized)) return sessionId;
  }
  return null;
}

export function runIdleSweep(
  staleThresholdMs: number,
): { evicted: number; remaining: number } {
  const now = Date.now();
  let evicted = 0;
  for (const [sessionId, session] of sessions) {
    if (session.subscribers.size > 0) continue;
    if (now - session.lastPing < staleThresholdMs) continue;
    sessions.delete(sessionId);
    evicted += 1;
  }
  const remaining = sessions.size;
  if (remaining === 0 && evicted > 0 && onEmptyMap) onEmptyMap();
  return { evicted, remaining };
}
