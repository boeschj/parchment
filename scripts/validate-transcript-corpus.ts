// Run the transcript parser over every real session JSONL on this machine
// and aggregate coverage stats. Surfaces schema drift across Claude Code
// versions as data: unknown block types, orphaned tool results, entries
// the parser silently drops.
//
// Usage: bun run scripts/validate-transcript-corpus.ts

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { appendEntries, emptyTranscript } from "../src/browser/transcript/parse.ts";
import type { TranscriptEntry } from "../src/shared/types.ts";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const MIN_FILE_BYTES = 50_000;

function sessionFiles(): string[] {
  const files: string[] = [];
  for (const project of readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const projectDir = join(PROJECTS_DIR, project.name);
    for (const name of readdirSync(projectDir)) {
      if (!name.endsWith(".jsonl") || name.startsWith("agent-")) continue;
      const path = join(projectDir, name);
      if (statSync(path).size >= MIN_FILE_BYTES) files.push(path);
    }
  }
  return files;
}

function parseLines(path: string): { entries: TranscriptEntry[]; malformed: number } {
  const entries: TranscriptEntry[] = [];
  let malformed = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      entries.push(JSON.parse(trimmed) as TranscriptEntry);
    } catch {
      malformed += 1;
    }
  }
  return { entries, malformed };
}

const HANDLED_ASSISTANT_BLOCKS = new Set(["text", "thinking", "tool_use"]);
const HANDLED_USER_BLOCKS = new Set(["text", "image", "tool_result"]);

const totals = {
  files: 0,
  entries: 0,
  malformed: 0,
  orphanToolResults: 0,
  unpairedToolItems: 0,
  items: {} as Record<string, number>,
  rawTypes: {} as Record<string, number>,
  unknownAssistantBlocks: {} as Record<string, number>,
  unknownUserBlocks: {} as Record<string, number>,
};

for (const path of sessionFiles()) {
  const { entries, malformed } = parseLines(path);
  totals.files += 1;
  totals.entries += entries.length;
  totals.malformed += malformed;

  const toolUseIds = new Set<string>();
  const toolResultIds = new Set<string>();
  for (const entry of entries) {
    const type = String(entry["type"]);
    totals.rawTypes[type] = (totals.rawTypes[type] ?? 0) + 1;

    const message = entry["message"] as Record<string, unknown> | undefined;
    const content = message?.["content"];
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      const blockRecord = block as Record<string, unknown>;
      const blockType = String(blockRecord["type"]);
      if (type === "assistant") {
        if (blockType === "tool_use") toolUseIds.add(String(blockRecord["id"]));
        if (!HANDLED_ASSISTANT_BLOCKS.has(blockType)) {
          totals.unknownAssistantBlocks[blockType] =
            (totals.unknownAssistantBlocks[blockType] ?? 0) + 1;
        }
      }
      if (type === "user") {
        if (blockType === "tool_result") toolResultIds.add(String(blockRecord["tool_use_id"]));
        if (!HANDLED_USER_BLOCKS.has(blockType)) {
          totals.unknownUserBlocks[blockType] = (totals.unknownUserBlocks[blockType] ?? 0) + 1;
        }
      }
    }
  }

  totals.orphanToolResults += [...toolResultIds].filter((id) => !toolUseIds.has(id)).length;

  const model = appendEntries(emptyTranscript, entries);
  for (const item of model.items) {
    totals.items[item.kind] = (totals.items[item.kind] ?? 0) + 1;
    if (item.kind === "tool" && item.output === null) totals.unpairedToolItems += 1;
  }
}

console.log(JSON.stringify(totals, null, 2));
