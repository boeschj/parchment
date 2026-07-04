// Maps raw Claude Code transcript JSONL entries onto the view model the
// transcript surface renders. Line-level narrowing is delegated to the shared
// typed parser (parseTraceEntry); this module only decides what earns a place
// in the rendered transcript and in what shape.
//
// Shapes this relies on (verified against real session files):
//   - type:"assistant" → message.content[] of text | thinking | tool_use
//     | fallback, plus model + usage on every content-block line
//   - type:"user"      → prompts, images, tool_results (paired to an earlier
//     tool_use via tool_use_id), slash-command tags, compaction summaries;
//     isMeta entries are hook noise, not the human
//   - type:"system"    → subtyped; compact_boundary and api_error render
//   - subagent activity lives in separate agent-*.jsonl files, so Agent
//     tool calls here are ordinary tool calls

import type { TranscriptEntry } from "../../shared/types.ts";
import type {
  AssistantTraceEntry,
  SystemTraceEntry,
  TokenUsage,
  ToolDenialKind,
  ToolResultBlock,
  UserTraceEntry,
} from "../../shared/trace/entry-types.ts";
import {
  BlockKind,
  SystemSubtype,
  TraceEntryKind,
  UserOrigin,
} from "../../shared/trace/entry-types.ts";
import { parseTraceEntry } from "../../shared/trace/parse-entry.ts";

export const TranscriptItemKind = {
  User: "user",
  Assistant: "assistant",
  Thinking: "thinking",
  Tool: "tool",
  Compaction: "compaction",
  CompactSummary: "compact-summary",
  SlashCommand: "slash-command",
  ApiError: "api-error",
  ModelFallback: "model-fallback",
} as const;

export type TranscriptItemKind = (typeof TranscriptItemKind)[keyof typeof TranscriptItemKind];

export type TranscriptItem =
  | {
      kind: typeof TranscriptItemKind.User;
      id: string;
      text: string;
      images: string[];
      timestampMs: number | null;
    }
  | {
      kind: typeof TranscriptItemKind.Assistant;
      id: string;
      markdown: string;
      timestampMs: number | null;
      model: string | null;
      contextTokens: number | null;
    }
  | {
      kind: typeof TranscriptItemKind.Thinking;
      id: string;
      text: string;
      timestampMs: number | null;
    }
  | {
      kind: typeof TranscriptItemKind.Tool;
      id: string;
      name: string;
      input: Record<string, unknown>;
      output: string | null;
      images: string[];
      isError: boolean;
      denialKind: ToolDenialKind | null;
      timestampMs: number | null;
      endedAtMs: number | null;
    }
  | {
      kind: typeof TranscriptItemKind.Compaction;
      id: string;
      timestampMs: number | null;
      trigger: string | null;
      preTokens: number | null;
      postTokens: number | null;
    }
  | {
      kind: typeof TranscriptItemKind.CompactSummary;
      id: string;
      text: string;
      timestampMs: number | null;
    }
  | {
      kind: typeof TranscriptItemKind.SlashCommand;
      id: string;
      command: string;
      args: string;
      timestampMs: number | null;
    }
  | {
      kind: typeof TranscriptItemKind.ApiError;
      id: string;
      message: string | null;
      retryAttempt: number | null;
      maxRetries: number | null;
      timestampMs: number | null;
    }
  | {
      kind: typeof TranscriptItemKind.ModelFallback;
      id: string;
      fromModel: string | null;
      toModel: string | null;
      timestampMs: number | null;
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

  for (const rawEntry of entries) {
    const entry = parseTraceEntry(rawEntry);
    const isRenderableKind =
      entry.kind === TraceEntryKind.Assistant ||
      entry.kind === TraceEntryKind.User ||
      entry.kind === TraceEntryKind.System;
    if (!isRenderableKind) continue;

    const uuid = entry.envelope.uuid;
    if (uuid !== null) {
      if (seenEntryIds.has(uuid)) continue;
      seenEntryIds.add(uuid);
    }

    if (entry.kind === TraceEntryKind.Assistant) {
      appendAssistantItems(entry, items, toolItemIndexById);
    }
    if (entry.kind === TraceEntryKind.User) {
      appendUserItems(entry, items, toolItemIndexById);
    }
    if (entry.kind === TraceEntryKind.System) {
      appendSystemItems(entry, items);
    }
  }

  return { items, toolItemIndexById, seenEntryIds };
}

function appendAssistantItems(
  entry: AssistantTraceEntry,
  items: TranscriptItem[],
  toolItemIndexById: Record<string, number>,
): void {
  const entryId = entry.envelope.uuid ?? `entry-${items.length}`;
  const timestampMs = entry.envelope.timestampMs;
  const model = entry.isSynthetic ? null : entry.model;
  const contextTokens = contextTokensFromUsage(entry.usage);

  for (const [blockIndex, block] of entry.blocks.entries()) {
    const blockId = `${entryId}-${blockIndex}`;

    if (block.kind === BlockKind.Text && block.text.trim().length > 0) {
      items.push({
        kind: TranscriptItemKind.Assistant,
        id: blockId,
        markdown: block.text,
        timestampMs,
        model,
        contextTokens,
      });
    }
    if (block.kind === BlockKind.Thinking && block.text.trim().length > 0) {
      items.push({ kind: TranscriptItemKind.Thinking, id: blockId, text: block.text, timestampMs });
    }
    if (block.kind === BlockKind.ToolUse) {
      const toolUseId = block.toolUseId.length > 0 ? block.toolUseId : blockId;
      toolItemIndexById[toolUseId] = items.length;
      items.push({
        kind: TranscriptItemKind.Tool,
        id: toolUseId,
        name: block.toolName,
        input: block.input,
        output: null,
        images: [],
        isError: false,
        denialKind: null,
        timestampMs,
        endedAtMs: null,
      });
    }
    if (block.kind === BlockKind.ModelFallback) {
      items.push({
        kind: TranscriptItemKind.ModelFallback,
        id: blockId,
        fromModel: block.fromModel,
        toModel: block.toModel,
        timestampMs,
      });
    }
  }
}

function appendUserItems(
  entry: UserTraceEntry,
  items: TranscriptItem[],
  toolItemIndexById: Record<string, number>,
): void {
  if (entry.isMeta) return;

  for (const result of entry.toolResults) {
    attachToolResult(entry, result, items, toolItemIndexById);
  }

  const entryId = entry.envelope.uuid ?? `entry-${items.length}`;
  const timestampMs = entry.envelope.timestampMs;

  if (entry.isCompactSummary) {
    items.push({ kind: TranscriptItemKind.CompactSummary, id: entryId, text: entry.text.trim(), timestampMs });
    return;
  }

  const slashCommand = parseSlashCommand(entry.text);
  if (slashCommand !== null) {
    items.push({
      kind: TranscriptItemKind.SlashCommand,
      id: entryId,
      command: slashCommand.command,
      args: slashCommand.args,
      timestampMs,
    });
    return;
  }

  if (entry.origin !== UserOrigin.Human) return;

  const text = entry.text.trim();
  if (text.length === 0 && entry.images.length === 0) return;
  items.push({ kind: TranscriptItemKind.User, id: entryId, text, images: entry.images, timestampMs });
}

function appendSystemItems(entry: SystemTraceEntry, items: TranscriptItem[]): void {
  const entryId = entry.envelope.uuid ?? `entry-${items.length}`;
  const timestampMs = entry.envelope.timestampMs;
  const payload = entry.payload;

  if (payload.subtype === SystemSubtype.CompactBoundary) {
    items.push({
      kind: TranscriptItemKind.Compaction,
      id: entryId,
      timestampMs,
      trigger: payload.compaction.trigger,
      preTokens: payload.compaction.preTokens,
      postTokens: payload.compaction.postTokens,
    });
  }
  if (payload.subtype === SystemSubtype.ApiError) {
    items.push({
      kind: TranscriptItemKind.ApiError,
      id: entryId,
      message: payload.message,
      retryAttempt: payload.retryAttempt,
      maxRetries: payload.maxRetries,
      timestampMs,
    });
  }
}

function attachToolResult(
  entry: UserTraceEntry,
  result: ToolResultBlock,
  items: TranscriptItem[],
  toolItemIndexById: Record<string, number>,
): void {
  const index = toolItemIndexById[result.toolUseId];
  if (index === undefined) return;
  const item = items[index];
  if (!item || item.kind !== TranscriptItemKind.Tool) return;

  // Denied calls carry the refusal reason in toolUseResult as a bare string;
  // the tool_result content sometimes duplicates it and sometimes doesn't.
  const denialReason = typeof entry.toolUseResult === "string" ? entry.toolUseResult : null;
  const output = result.text.length > 0 ? result.text : (denialReason ?? "");

  items[index] = {
    ...item,
    output,
    images: [...item.images, ...result.images],
    isError: result.isError,
    denialKind: entry.toolDenialKind,
    endedAtMs: entry.envelope.timestampMs,
  };
}

function contextTokensFromUsage(usage: TokenUsage | null): number | null {
  if (usage === null) return null;
  const total = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
  return total > 0 ? total : null;
}

const COMMAND_NAME_PATTERN = /<command-name>([\s\S]*?)<\/command-name>/;
const COMMAND_ARGS_PATTERN = /<command-args>([\s\S]*?)<\/command-args>/;

function parseSlashCommand(text: string): { command: string; args: string } | null {
  const nameMatch = COMMAND_NAME_PATTERN.exec(text);
  if (nameMatch === null) return null;

  const command = (nameMatch[1] ?? "").trim();
  if (command.length === 0) return null;

  const argsMatch = COMMAND_ARGS_PATTERN.exec(text);
  const args = (argsMatch?.[1] ?? "").trim();
  return { command, args };
}
