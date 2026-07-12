// Reads a Claude Code session JSONL file into typed trace entries. I/O only —
// the actual metric math lives in extract-metrics.ts so it can be unit
// tested against an in-memory fixture without touching the filesystem.

import { readFileSync } from "node:fs";
import { parseTraceEntry, type TraceEntry } from "@boeschj/claude-jsonl";

export function readTranscriptEntries(jsonlPath: string): TraceEntry[] {
  const raw = readFileSync(jsonlPath, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => parseTraceEntry(JSON.parse(line) as Record<string, unknown>));
}
