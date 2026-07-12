// Disk persistence for session content so a daemon restart is lossless.
//
// Layout under ~/.parchment/sessions/<id>/:
//   slots/<slotId>.json — one full Slot per file (spec + state included).
//     The statusline reads these for its kind glyphs, so the top-level
//     fields (id, kind, status, title) must stay stable.
//   edits.json — pending edits + the sticky overlay, rewritten on change.
//
// Pure disk I/O: imports only state paths and shared types, so both
// sessions.ts (hydration) and slots.ts/edits.ts (writes) can depend on it
// without a cycle.

import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { sessionSlotDir, SESSIONS_DIR } from "./state.ts";
import type { Edit, OverlayEntry, Slot } from "../shared/types.ts";
import type { LiveSourceConfig } from "./live/types.ts";

export function persistSlot(sessionId: string, slot: Slot): void {
  const dir = sessionSlotDir(sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${slot.id}.json`), JSON.stringify(slot));
}

export function removePersistedSlot(sessionId: string, slotId: string): void {
  const path = join(sessionSlotDir(sessionId), `${slotId}.json`);
  if (existsSync(path)) unlinkSync(path);
}

export function clearPersistedSlots(sessionId: string): void {
  const dir = sessionSlotDir(sessionId);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".json")) unlinkSync(join(dir, name));
  }
}

export function loadPersistedSlots(sessionId: string): Slot[] {
  const dir = sessionSlotDir(sessionId);
  if (!existsSync(dir)) return [];
  const slots: Slot[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const parsed = readSlotFile(join(dir, name));
    if (parsed) slots.push(parsed);
  }
  return slots.sort((a, b) => a.createdAt - b.createdAt);
}

// Pre-persistence slot files held only status metadata (no spec) — they
// cannot render, so hydration skips them.
function readSlotFile(path: string): Slot | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Slot;
    const hasRenderableSpec = Boolean(parsed.spec?.root) && Boolean(parsed.spec?.elements);
    if (!parsed.id || !parsed.kind || !hasRenderableSpec) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Overlay entries coalesce per-(slot, element); this key defines "per".
// Lives here so both edits.ts (writes) and sessions.ts (hydration) share it.
export function overlayKey(slotId: string, elementId: string | null): string {
  return `${slotId}::${elementId ?? "*"}`;
}

type PersistedEdits = {
  pendingEdits: Edit[];
  overlayEntries: OverlayEntry[];
};

function editsFilePath(sessionId: string): string {
  return join(dirname(sessionSlotDir(sessionId)), "edits.json");
}

export function persistEdits(
  sessionId: string,
  pendingEdits: Edit[],
  overlayEntries: OverlayEntry[],
): void {
  const path = editsFilePath(sessionId);
  mkdirSync(dirname(path), { recursive: true });
  const payload: PersistedEdits = { pendingEdits, overlayEntries };
  writeFileSync(path, JSON.stringify(payload));
}

export function loadPersistedEdits(sessionId: string): PersistedEdits {
  const path = editsFilePath(sessionId);
  if (!existsSync(path)) return { pendingEdits: [], overlayEntries: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PersistedEdits;
    return {
      pendingEdits: parsed.pendingEdits ?? [],
      overlayEntries: parsed.overlayEntries ?? [],
    };
  } catch {
    return { pendingEdits: [], overlayEntries: [] };
  }
}

type SessionMeta = {
  transcriptPath: string | null;
};

function metaFilePath(sessionId: string): string {
  return join(dirname(sessionSlotDir(sessionId)), "meta.json");
}

export function persistSessionMeta(sessionId: string, meta: SessionMeta): void {
  const path = metaFilePath(sessionId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(meta));
}

export function loadSessionMeta(sessionId: string): SessionMeta {
  const path = metaFilePath(sessionId);
  if (!existsSync(path)) return { transcriptPath: null };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as SessionMeta;
    return { transcriptPath: parsed.transcriptPath ?? null };
  } catch {
    return { transcriptPath: null };
  }
}

// Live data source bindings survive daemon restarts so a dashboard composed
// once keeps streaming across plugin updates. savedAt records when the agent
// last touched the bindings; rehydration ignores stale files.
export type PersistedLiveSources = {
  savedAt: number;
  slots: Record<string, LiveSourceConfig[]>;
};

const EMPTY_LIVE_SOURCES: PersistedLiveSources = { savedAt: 0, slots: {} };

function liveSourcesFilePath(sessionId: string): string {
  return join(dirname(sessionSlotDir(sessionId)), "live.json");
}

export function persistLiveSources(
  sessionId: string,
  slots: Record<string, LiveSourceConfig[]>,
): void {
  const path = liveSourcesFilePath(sessionId);
  const hasBindings = Object.values(slots).some((configs) => configs.length > 0);
  if (!hasBindings) {
    if (existsSync(path)) unlinkSync(path);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  const payload: PersistedLiveSources = { savedAt: Date.now(), slots };
  writeFileSync(path, JSON.stringify(payload));
}

export function loadPersistedLiveSources(sessionId: string): PersistedLiveSources {
  const path = liveSourcesFilePath(sessionId);
  if (!existsSync(path)) return EMPTY_LIVE_SOURCES;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PersistedLiveSources;
    return { savedAt: parsed.savedAt ?? 0, slots: parsed.slots ?? {} };
  } catch {
    return EMPTY_LIVE_SOURCES;
  }
}

// Session ids whose content survives on disk — lets short-alias links keep
// resolving after a daemon restart empties the in-memory session map.
export function listPersistedSessionIds(): string[] {
  if (!existsSync(SESSIONS_DIR)) return [];
  return readdirSync(SESSIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}
