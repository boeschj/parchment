// Provenance for every hydrated value. A plain reference is a SNAPSHOT: it
// captured the bytes at push time and will not change until the slot is
// re-pushed. {watch:true} is the explicit opt-in to LIVE, where a daemon-side
// watcher re-resolves on each file change. Recording the mode, a content hash,
// and the capture time beside the value is what makes a stale snapshot VISIBLE
// rather than silently wrong — so both the push-time hydrator and the live
// refresher stamp their writes through here.

import { createHash } from "node:crypto";

const HASH_LENGTH = 16;

export const HydrationMode = {
  Snapshot: "snapshot",
  Live: "live",
} as const;

export type HydrationMode = (typeof HydrationMode)[keyof typeof HydrationMode];

export type HydratedMeta = {
  mode: HydrationMode;
  hash: string;
  hydratedAt: number;
  bytes: number;
};

export function buildHydratedMeta(value: unknown, mode: HydrationMode): HydratedMeta {
  return {
    mode,
    hash: contentHash(value),
    hydratedAt: Date.now(),
    bytes: hydrationByteSize(value),
  };
}

export function hydrationByteSize(value: unknown): number {
  return Buffer.byteLength(serializeForHashing(value), "utf8");
}

function contentHash(value: unknown): string {
  return createHash("sha256").update(serializeForHashing(value)).digest("hex").slice(0, HASH_LENGTH);
}

function serializeForHashing(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "";
}
