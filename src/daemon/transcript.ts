// Live transcript streaming: tail a Claude Code session JSONL file and
// broadcast new entries to the session's WebSocket subscribers.
//
// The hooks register the transcript path (Claude Code hands it to every
// hook as transcript_path). On WS subscribe the server sends the full
// backlog as one transcript-snapshot, then this module streams increments
// as transcript-append — one ordered channel, no backlog/live race.

import { closeSync, existsSync, openSync, readSync, statSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import type { TranscriptEntry } from "../shared/types.ts";
import { persistSessionMeta } from "./session-store.ts";
import { broadcast, ensureSession, type SessionRoom } from "./sessions.ts";

// fs.watch occasionally drops events on macOS; a slow poll guarantees the
// transcript never silently stalls.
const POLL_INTERVAL_MS = 2000;

type TailState = {
  offset: number;
  remainder: string;
  watcher: FSWatcher | null;
  pollTimer: ReturnType<typeof setInterval>;
};

const tails = new Map<string, TailState>();

export function registerTranscriptPath(sessionId: string, path: string): void {
  const session = ensureSession(sessionId);
  if (session.transcriptPath !== path) {
    session.transcriptPath = path;
    persistSessionMeta(sessionId, { transcriptPath: path });
  }
  ensureTailing(session);
}

// Full-file read for one socket's WS-open snapshot. Deliberately does NOT
// touch the shared tail state: other tabs are mid-stream on that offset,
// and re-priming it would skip or replay entries for them. The new tab may
// receive a few entries twice (snapshot + an in-flight append) — the
// browser dedupes by entry uuid, so overlap is harmless and gaps are the
// only unforgivable failure.
export function readTranscriptBacklog(session: SessionRoom): TranscriptEntry[] {
  if (!session.transcriptPath || !existsSync(session.transcriptPath)) return [];
  ensureTailing(session);
  return readEntriesFrom(session.transcriptPath, 0).entries;
}

function ensureTailing(session: SessionRoom): TailState | null {
  if (!session.transcriptPath) return null;
  const existing = tails.get(session.sessionId);
  if (existing) return existing;

  const path = session.transcriptPath;
  const state: TailState = {
    offset: existsSync(path) ? statSync(path).size : 0,
    remainder: "",
    watcher: null,
    pollTimer: setInterval(() => pump(session, state), POLL_INTERVAL_MS),
  };
  state.watcher = tryWatch(path, () => pump(session, state));
  tails.set(session.sessionId, state);
  return state;
}

function tryWatch(path: string, onChange: () => void): FSWatcher | null {
  if (!existsSync(path)) return null;
  try {
    return watch(path, onChange);
  } catch {
    return null;
  }
}

function pump(session: SessionRoom, state: TailState): void {
  const path = session.transcriptPath;
  if (!path || !existsSync(path)) return;
  if (state.watcher === null) {
    state.watcher = tryWatch(path, () => pump(session, state));
  }

  const size = statSync(path).size;
  if (size < state.offset) {
    // File truncated/rotated — start over from the top.
    state.offset = 0;
    state.remainder = "";
  }
  if (size === state.offset) return;

  const { entries, bytesConsumed, remainder } = readEntriesFrom(path, state.offset, state.remainder);
  state.offset = bytesConsumed;
  state.remainder = remainder;
  if (entries.length > 0) {
    broadcast(session, { kind: "transcript-append", data: { entries } });
  }
}

function readEntriesFrom(
  path: string,
  offset: number,
  carriedRemainder: string = "",
): { entries: TranscriptEntry[]; bytesConsumed: number; remainder: string } {
  const size = statSync(path).size;
  if (size <= offset) return { entries: [], bytesConsumed: offset, remainder: carriedRemainder };

  const descriptor = openSync(path, "r");
  const buffer = Buffer.alloc(size - offset);
  try {
    readSync(descriptor, buffer, 0, buffer.length, offset);
  } finally {
    closeSync(descriptor);
  }

  const text = carriedRemainder + buffer.toString("utf8");
  const lines = text.split("\n");
  // The final segment is either "" (text ended in a newline) or a partial
  // line still being written — carry it to the next read either way.
  const remainder = lines.pop() ?? "";

  const entries: TranscriptEntry[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      entries.push(JSON.parse(trimmed) as TranscriptEntry);
    } catch {
      // Skip malformed lines rather than stalling the stream.
    }
  }
  return { entries, bytesConsumed: size, remainder };
}
