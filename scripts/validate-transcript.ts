// Parser-coverage harness: run the transcript reducer over a real session
// JSONL file and report what it consumed vs. what it dropped, so schema
// drift surfaces as data instead of as a blank transcript surface.
//
// Usage: bun run scripts/validate-transcript.ts <path-to-session.jsonl>

import { readFileSync } from "node:fs";
import { appendEntries, emptyTranscript } from "../src/browser/transcript/parse.ts";
import type { TranscriptEntry } from "../src/shared/types.ts";

const path = process.argv[2];
if (!path) {
  console.error("usage: bun run scripts/validate-transcript.ts <session.jsonl>");
  process.exit(1);
}

const entries: TranscriptEntry[] = [];
let malformedLines = 0;
for (const line of readFileSync(path, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (trimmed.length === 0) continue;
  try {
    entries.push(JSON.parse(trimmed) as TranscriptEntry);
  } catch {
    malformedLines += 1;
  }
}

const rawEntryTypes: Record<string, number> = {};
const assistantBlockTypes: Record<string, number> = {};
const userBlockTypes: Record<string, number> = {};
const toolResultIds = new Set<string>();
const toolUseIds = new Set<string>();

for (const entry of entries) {
  const type = String(entry["type"]);
  rawEntryTypes[type] = (rawEntryTypes[type] ?? 0) + 1;

  const message = entry["message"] as Record<string, unknown> | undefined;
  const content = message?.["content"];
  if (!Array.isArray(content)) continue;

  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const blockRecord = block as Record<string, unknown>;
    const blockType = String(blockRecord["type"]);
    if (type === "assistant") {
      assistantBlockTypes[blockType] = (assistantBlockTypes[blockType] ?? 0) + 1;
      if (blockType === "tool_use") toolUseIds.add(String(blockRecord["id"]));
    }
    if (type === "user") {
      userBlockTypes[blockType] = (userBlockTypes[blockType] ?? 0) + 1;
      if (blockType === "tool_result") toolResultIds.add(String(blockRecord["tool_use_id"]));
    }
  }
}

const model = appendEntries(emptyTranscript, entries);
const itemCounts: Record<string, number> = {};
let unpairedToolItems = 0;
for (const item of model.items) {
  itemCounts[item.kind] = (itemCounts[item.kind] ?? 0) + 1;
  if (item.kind === "tool" && item.output === null) unpairedToolItems += 1;
}

const orphanResults = [...toolResultIds].filter((id) => !toolUseIds.has(id));
const handledAssistantBlocks = new Set(["text", "thinking", "tool_use"]);
const unknownAssistantBlocks = Object.keys(assistantBlockTypes).filter(
  (blockType) => !handledAssistantBlocks.has(blockType),
);
const handledUserBlocks = new Set(["text", "image", "tool_result"]);
const unknownUserBlocks = Object.keys(userBlockTypes).filter(
  (blockType) => !handledUserBlocks.has(blockType),
);

console.log(
  JSON.stringify({
    file: path,
    entryCount: entries.length,
    malformedLines,
    rawEntryTypes,
    assistantBlockTypes,
    userBlockTypes,
    itemCounts,
    unpairedToolItems,
    orphanToolResults: orphanResults.length,
    unknownAssistantBlocks,
    unknownUserBlocks,
  }),
);
