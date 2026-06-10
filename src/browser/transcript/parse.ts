// Maps raw Claude Code transcript JSONL entries onto the view model the
// transcript surface renders. The JSONL schema is undocumented and drifts
// across versions, so every accessor here is defensive: unknown entry
// types are skipped, never thrown on.
//
// Shapes this relies on (verified against real session files):
//   - type:"assistant" → message.content[] of text | thinking | tool_use
//   - type:"user"      → message.content as string, or [] of text | image
//     | tool_result; isMeta entries are hook noise, not the human
//   - tool_result pairs to an earlier tool_use via tool_use_id
//   - subagent activity lives in separate agent-*.jsonl files, so Agent
//     tool calls here are ordinary tool calls

import type { TranscriptEntry } from "../../shared/types.ts";

export type TranscriptItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; markdown: string }
  | { kind: "thinking"; id: string; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: Record<string, unknown>;
      output: string | null;
      isError: boolean;
    };

export type TranscriptModel = {
  items: TranscriptItem[];
  toolItemIndexById: Record<string, number>;
  seenEntryIds: ReadonlySet<string>;
};

export const emptyTranscript: TranscriptModel = {
  items: [],
  toolItemIndexById: {},
  seenEntryIds: new Set(),
};

// Entries can legitimately arrive more than once (a WS-open snapshot can
// overlap an in-flight append; file truncation replays the whole file), so
// dedupe by entry uuid makes redelivery harmless by construction.
export function appendEntries(
  model: TranscriptModel,
  entries: TranscriptEntry[],
): TranscriptModel {
  const items = [...model.items];
  const toolItemIndexById = { ...model.toolItemIndexById };
  const seenEntryIds = new Set(model.seenEntryIds);

  for (const entry of entries) {
    const entryType = entry["type"];
    if (entryType !== "assistant" && entryType !== "user") continue;

    const uuid = stringField(entry, "uuid");
    if (uuid !== null) {
      if (seenEntryIds.has(uuid)) continue;
      seenEntryIds.add(uuid);
    }

    if (entryType === "assistant") {
      appendAssistantBlocks(entry, items, toolItemIndexById);
    }
    if (entryType === "user") {
      appendUserContent(entry, items, toolItemIndexById);
    }
  }

  return { items, toolItemIndexById, seenEntryIds };
}

function appendAssistantBlocks(
  entry: TranscriptEntry,
  items: TranscriptItem[],
  toolItemIndexById: Record<string, number>,
): void {
  const entryId = stringField(entry, "uuid") ?? `entry-${items.length}`;
  for (const [blockIndex, block] of contentBlocks(entry).entries()) {
    const blockId = `${entryId}-${blockIndex}`;
    const blockType = block["type"];

    if (blockType === "text") {
      const text = stringField(block, "text") ?? "";
      if (text.trim().length > 0) items.push({ kind: "assistant", id: blockId, markdown: text });
    }
    if (blockType === "thinking") {
      const text = stringField(block, "thinking") ?? "";
      if (text.trim().length > 0) items.push({ kind: "thinking", id: blockId, text });
    }
    if (blockType === "tool_use") {
      const toolUseId = stringField(block, "id") ?? blockId;
      toolItemIndexById[toolUseId] = items.length;
      items.push({
        kind: "tool",
        id: toolUseId,
        name: stringField(block, "name") ?? "unknown",
        input: recordField(block, "input"),
        output: null,
        isError: false,
      });
    }
  }
}

function appendUserContent(
  entry: TranscriptEntry,
  items: TranscriptItem[],
  toolItemIndexById: Record<string, number>,
): void {
  if (entry["isMeta"] === true) return;

  const message = recordField(entry, "message");
  const content = message["content"];
  const entryId = stringField(entry, "uuid") ?? `entry-${items.length}`;

  if (typeof content === "string") {
    if (content.trim().length > 0) items.push({ kind: "user", id: entryId, text: content });
    return;
  }
  if (!Array.isArray(content)) return;

  const textParts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block["type"] === "text") {
      const text = stringField(block, "text");
      if (text) textParts.push(text);
    }
    if (block["type"] === "image") {
      textParts.push("[image]");
    }
    if (block["type"] === "tool_result") {
      attachToolResult(block, items, toolItemIndexById);
    }
  }

  const combined = textParts.join("\n\n").trim();
  if (combined.length > 0) items.push({ kind: "user", id: entryId, text: combined });
}

function attachToolResult(
  block: Record<string, unknown>,
  items: TranscriptItem[],
  toolItemIndexById: Record<string, number>,
): void {
  const toolUseId = stringField(block, "tool_use_id");
  if (!toolUseId) return;
  const index = toolItemIndexById[toolUseId];
  if (index === undefined) return;
  const item = items[index];
  if (!item || item.kind !== "tool") return;

  items[index] = {
    ...item,
    output: toolResultText(block["content"]),
    isError: block["is_error"] === true,
  };
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part["type"] === "text") {
      const text = stringField(part, "text");
      if (text) parts.push(text);
    }
    if (part["type"] === "image") {
      parts.push("[image]");
    }
  }
  return parts.join("\n");
}

function contentBlocks(entry: TranscriptEntry): Record<string, unknown>[] {
  const message = recordField(entry, "message");
  const content = message["content"];
  if (!Array.isArray(content)) return [];
  return content.filter(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return isRecord(value) ? value : {};
}
