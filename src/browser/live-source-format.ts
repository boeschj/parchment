// Presentation helpers shared by the live-source panel and the command
// approval prompt. Pure string formatting — no fetching, no state.

import { LiveSourceKind, type LiveSourceView, type Slot } from "../shared/types.ts";

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

const KIND_LABELS: Record<LiveSourceKind, string> = {
  [LiveSourceKind.FileTail]: "file tail",
  [LiveSourceKind.CommandPoll]: "shell command",
  [LiveSourceKind.HttpPoll]: "http poll",
  [LiveSourceKind.ClaudeSessions]: "claude sessions",
  [LiveSourceKind.ReferenceRefresh]: "watched file reference",
};

export function kindLabel(kind: LiveSourceKind): string {
  return KIND_LABELS[kind];
}

// file-tail watches its file rather than polling, so it has no cadence.
export function formatInterval(intervalMs: number | null): string {
  if (intervalMs === null) return "on change";
  const totalSeconds = Math.round(intervalMs / MS_PER_SECOND);
  if (totalSeconds < SECONDS_PER_MINUTE) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

export function slotLabel(slotId: string, slots: Slot[]): string {
  const slot = slots.find((candidate) => candidate.id === slotId);
  if (!slot) return slotId;
  return slot.title;
}

export function isExecutingSource(source: LiveSourceView): boolean {
  return source.kind === LiveSourceKind.CommandPoll;
}
