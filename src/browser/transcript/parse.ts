// Maps raw Claude Code transcript JSONL entries onto the view model the
// transcript surface renders. Line-level narrowing is delegated to the shared
// typed parser (parseTraceEntry); this module decides what shape each line
// takes on screen.
//
// Full-fidelity contract: every entry either produces at least one item or is
// explicitly ABSORBED into one — tool_result lines merge into their tool call,
// session-meta rewrites with an unchanged value merge into the previously
// rendered value, last-prompt lines duplicate the user bubble they trail, and
// redelivered lines (snapshot/append overlap) are already represented. The
// coverage counters exist so "absorbed" is provable, not assumed:
// droppedEntries must stay 0.

import type { TranscriptEntry } from "../../shared/types.ts";
import type {
  AssistantTraceEntry,
  AttachmentTraceEntry,
  PrLinkTraceEntry,
  SystemPayload,
  SystemTraceEntry,
  TokenUsage,
  ToolDenialKind,
  ToolResultBlock,
  TraceEntry,
  UserTraceEntry,
} from "@boeschj/claude-jsonl";
import {
  BlockKind,
  SessionMetaField,
  SystemSubtype,
  TraceEntryKind,
  UserOrigin,
  parseTraceEntry,
} from "@boeschj/claude-jsonl";

export const TranscriptItemKind = {
  User: "user",
  Assistant: "assistant",
  Thinking: "thinking",
  Bash: "bash",
  Tool: "tool",
  Compaction: "compaction",
  CompactSummary: "compact-summary",
  SlashCommand: "slash-command",
  ApiError: "api-error",
  ModelFallback: "model-fallback",
  Attachment: "attachment",
  SystemEvent: "system-event",
  QueueOp: "queue-op",
  SessionMeta: "session-meta",
  FileSnapshot: "file-snapshot",
  Unknown: "unknown",
} as const;

export type TranscriptItemKind = (typeof TranscriptItemKind)[keyof typeof TranscriptItemKind];

// system-event subtypes synthesized by this module (as opposed to the real
// system subtypes coming off the wire, see SystemSubtype).
export const InjectedEventSubtype = {
  InjectedContext: "injected-context",
  TaskNotification: "task-notification",
  PrLink: "pr-link",
} as const;

export type InjectedEventSubtype = (typeof InjectedEventSubtype)[keyof typeof InjectedEventSubtype];

type RawEntry = Record<string, unknown>;

export type TranscriptItem =
  | {
      kind: typeof TranscriptItemKind.User;
      id: string;
      text: string;
      images: string[];
      timestampMs: number | null;
      raw: RawEntry;
    }
  | {
      kind: typeof TranscriptItemKind.Assistant;
      id: string;
      markdown: string;
      timestampMs: number | null;
      model: string | null;
      contextTokens: number | null;
      raw: RawEntry;
    }
  | {
      kind: typeof TranscriptItemKind.Thinking;
      id: string;
      text: string;
      timestampMs: number | null;
      raw: RawEntry;
    }
  | {
      kind: typeof TranscriptItemKind.Bash;
      id: string;
      command: string;
      output: string;
      timestampMs: number | null;
      raw: RawEntry;
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
      raw: RawEntry;
      resultRaw: RawEntry | null;
      toolUseResult: RawEntry | null;
    }
  | {
      kind: typeof TranscriptItemKind.Compaction;
      id: string;
      timestampMs: number | null;
      trigger: string | null;
      preTokens: number | null;
      postTokens: number | null;
      raw: RawEntry;
    }
  | {
      kind: typeof TranscriptItemKind.CompactSummary;
      id: string;
      text: string;
      timestampMs: number | null;
      raw: RawEntry;
    }
  | {
      kind: typeof TranscriptItemKind.SlashCommand;
      id: string;
      command: string;
      args: string;
      timestampMs: number | null;
      raw: RawEntry;
    }
  | {
      kind: typeof TranscriptItemKind.ApiError;
      id: string;
      message: string | null;
      retryAttempt: number | null;
      maxRetries: number | null;
      timestampMs: number | null;
      raw: RawEntry;
    }
  | {
      kind: typeof TranscriptItemKind.ModelFallback;
      id: string;
      fromModel: string | null;
      toModel: string | null;
      timestampMs: number | null;
      raw: RawEntry;
    }
  | {
      kind: typeof TranscriptItemKind.Attachment;
      id: string;
      subtype: string;
      summary: string;
      payloadJson: string;
      timestampMs: number | null;
      raw: RawEntry;
    }
  | {
      kind: typeof TranscriptItemKind.SystemEvent;
      id: string;
      subtype: string;
      summary: string;
      detailJson: string | null;
      timestampMs: number | null;
      raw: RawEntry;
    }
  | {
      kind: typeof TranscriptItemKind.QueueOp;
      id: string;
      operation: string;
      content: string;
      timestampMs: number | null;
      raw: RawEntry;
    }
  | {
      kind: typeof TranscriptItemKind.SessionMeta;
      id: string;
      field: SessionMetaField;
      value: string;
      timestampMs: number | null;
      raw: RawEntry;
    }
  | {
      kind: typeof TranscriptItemKind.FileSnapshot;
      id: string;
      trackedFileCount: number;
      messageId: string | null;
      timestampMs: number | null;
      raw: RawEntry;
    }
  | {
      kind: typeof TranscriptItemKind.Unknown;
      id: string;
      rawType: string;
      timestampMs: number | null;
      raw: RawEntry;
    };

export type TranscriptCoverage = {
  totalEntries: number;
  renderedEntries: number;
  droppedEntries: number;
  itemCounts: Record<string, number>;
};

export type TranscriptModel = {
  items: TranscriptItem[];
  toolItemIndexById: Record<string, number>;
  seenEntryIds: ReadonlySet<string>;
  // Last rendered value per session-meta field, so only real changes render
  // (permission-mode alone rewrites 1,000+ times per long session).
  sessionMetaLastValues: Readonly<Record<string, string>>;
  coverage: TranscriptCoverage;
};

export const emptyTranscript: TranscriptModel = {
  items: [],
  toolItemIndexById: {},
  seenEntryIds: new Set(),
  sessionMetaLastValues: {},
  coverage: { totalEntries: 0, renderedEntries: 0, droppedEntries: 0, itemCounts: {} },
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
  const sessionMetaLastValues: Record<string, string> = { ...model.sessionMetaLastValues };
  let renderedEntries = model.coverage.renderedEntries;

  for (const rawEntry of entries) {
    const entry = parseTraceEntry(rawEntry);

    const uuid = entry.envelope.uuid;
    if (uuid !== null && seenEntryIds.has(uuid)) {
      // Redelivered line: already represented, counts as rendered-by-merge.
      renderedEntries += 1;
      continue;
    }
    if (uuid !== null) seenEntryIds.add(uuid);

    const itemCountBefore = items.length;
    const absorbed = appendParsedEntry(entry, items, toolItemIndexById, sessionMetaLastValues);
    const producedItems = items.length > itemCountBefore;
    if (producedItems || absorbed) renderedEntries += 1;
  }

  const totalEntries = model.coverage.totalEntries + entries.length;
  const coverage: TranscriptCoverage = {
    totalEntries,
    renderedEntries,
    droppedEntries: totalEntries - renderedEntries,
    itemCounts: countItemKinds(items),
  };

  return { items, toolItemIndexById, seenEntryIds, sessionMetaLastValues, coverage };
}

// Returns true when the entry was absorbed into existing items instead of
// producing its own (see the coverage contract in the module header).
function appendParsedEntry(
  entry: TraceEntry,
  items: TranscriptItem[],
  toolItemIndexById: Record<string, number>,
  sessionMetaLastValues: Record<string, string>,
): boolean {
  switch (entry.kind) {
    case TraceEntryKind.Assistant:
      return appendAssistantItems(entry, items, toolItemIndexById);
    case TraceEntryKind.User:
      return appendUserItems(entry, items, toolItemIndexById);
    case TraceEntryKind.System:
      appendSystemItems(entry, items);
      return false;
    case TraceEntryKind.Attachment:
      appendAttachmentItem(entry, items);
      return false;
    case TraceEntryKind.FileHistorySnapshot:
      items.push({
        kind: TranscriptItemKind.FileSnapshot,
        id: itemId(entry.envelope.uuid, items),
        trackedFileCount: entry.trackedFilePaths.length,
        messageId: entry.messageId,
        timestampMs: entry.envelope.timestampMs,
        raw: entry.raw,
      });
      return false;
    case TraceEntryKind.QueueOperation:
      items.push({
        kind: TranscriptItemKind.QueueOp,
        id: itemId(entry.envelope.uuid, items),
        operation: entry.operation,
        content: entry.content,
        timestampMs: entry.envelope.timestampMs,
        raw: entry.raw,
      });
      return false;
    case TraceEntryKind.PrLink:
      appendPrLinkItem(entry, items);
      return false;
    case TraceEntryKind.SessionMeta:
      return appendSessionMetaItem(entry, items, sessionMetaLastValues);
    case TraceEntryKind.Unknown:
      items.push({
        kind: TranscriptItemKind.Unknown,
        id: itemId(entry.envelope.uuid, items),
        rawType: entry.rawType,
        timestampMs: entry.envelope.timestampMs,
        raw: entry.raw,
      });
      return false;
  }
}

function appendAssistantItems(
  entry: AssistantTraceEntry,
  items: TranscriptItem[],
  toolItemIndexById: Record<string, number>,
): boolean {
  const entryId = itemId(entry.envelope.uuid, items);
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
        raw: entry.raw,
      });
    }
    if (block.kind === BlockKind.Thinking && block.text.trim().length > 0) {
      items.push({
        kind: TranscriptItemKind.Thinking,
        id: blockId,
        text: block.text,
        timestampMs,
        raw: entry.raw,
      });
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
        raw: entry.raw,
        resultRaw: null,
        toolUseResult: null,
      });
    }
    if (block.kind === BlockKind.ModelFallback) {
      items.push({
        kind: TranscriptItemKind.ModelFallback,
        id: blockId,
        fromModel: block.fromModel,
        toModel: block.toModel,
        timestampMs,
        raw: entry.raw,
      });
    }
    if (block.kind === BlockKind.Unknown) {
      items.push({
        kind: TranscriptItemKind.Unknown,
        id: blockId,
        rawType: `${block.rawType} block`,
        timestampMs,
        raw: entry.raw,
      });
    }
  }

  // Lines whose blocks are all empty (whitespace-only text/thinking) carry
  // only usage metadata already surfaced on sibling blocks of the same
  // message — absorbed, not dropped.
  return true;
}

function appendUserItems(
  entry: UserTraceEntry,
  items: TranscriptItem[],
  toolItemIndexById: Record<string, number>,
): boolean {
  // Results merge into the tool item they answer. Orphans (result arrives in
  // a partial snapshot before its tool_use) still count as absorbed: the
  // full-file replay that follows re-pairs them.
  const carriesToolResults = entry.toolResults.length > 0;
  for (const result of entry.toolResults) {
    attachToolResult(entry, result, items, toolItemIndexById);
  }

  const entryId = itemId(entry.envelope.uuid, items);
  const timestampMs = entry.envelope.timestampMs;
  const text = entry.text.trim();

  if (entry.isCompactSummary) {
    items.push({
      kind: TranscriptItemKind.CompactSummary,
      id: entryId,
      text,
      timestampMs,
      raw: entry.raw,
    });
    return carriesToolResults;
  }

  if (entry.isMeta) {
    return appendInjectedContextItem(entry, items, entryId, InjectedEventSubtype.InjectedContext) || carriesToolResults;
  }

  const slashCommand = parseSlashCommand(entry.text);
  if (slashCommand !== null) {
    items.push({
      kind: TranscriptItemKind.SlashCommand,
      id: entryId,
      command: slashCommand.command,
      args: slashCommand.args,
      timestampMs,
      raw: entry.raw,
    });
    return carriesToolResults;
  }

  // Inline `!command` bash carries its input/output in bash-* envelopes. Left
  // as plain text they render as a giant bubble with visible tags, so route
  // them to a terminal block (command + captured output) instead.
  const bashCommand = parseBashCommand(entry.text);
  if (bashCommand !== null) {
    items.push({
      kind: TranscriptItemKind.Bash,
      id: entryId,
      command: bashCommand.command,
      output: bashCommand.output,
      timestampMs,
      raw: entry.raw,
    });
    return carriesToolResults;
  }

  if (entry.origin !== UserOrigin.Human) {
    const subtype = injectedSubtypeForOrigin(entry.origin);
    return appendInjectedContextItem(entry, items, entryId, subtype) || carriesToolResults;
  }

  if (text.length === 0 && entry.images.length === 0) {
    // Nothing renderable exists on the line (typically a pure tool_result
    // carrier) — absorbed.
    return true;
  }

  items.push({
    kind: TranscriptItemKind.User,
    id: entryId,
    text,
    images: entry.images,
    timestampMs,
    raw: entry.raw,
  });
  return carriesToolResults;
}

// Harness-injected user lines (isMeta hooks, task notifications, system
// reminders) render as quiet system events instead of vanishing.
function appendInjectedContextItem(
  entry: UserTraceEntry,
  items: TranscriptItem[],
  entryId: string,
  subtype: string,
): boolean {
  const text = entry.text.trim();
  if (text.length === 0) return true;

  items.push({
    kind: TranscriptItemKind.SystemEvent,
    id: entryId,
    subtype,
    summary: summarizeText(text),
    detailJson: text,
    timestampMs: entry.envelope.timestampMs,
    raw: entry.raw,
  });
  return false;
}

function injectedSubtypeForOrigin(origin: UserTraceEntry["origin"]): string {
  if (origin === UserOrigin.TaskNotification) return InjectedEventSubtype.TaskNotification;
  return InjectedEventSubtype.InjectedContext;
}

function appendSystemItems(entry: SystemTraceEntry, items: TranscriptItem[]): void {
  const entryId = itemId(entry.envelope.uuid, items);
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
      raw: entry.raw,
    });
    return;
  }
  if (payload.subtype === SystemSubtype.ApiError) {
    items.push({
      kind: TranscriptItemKind.ApiError,
      id: entryId,
      message: payload.message,
      retryAttempt: payload.retryAttempt,
      maxRetries: payload.maxRetries,
      timestampMs,
      raw: entry.raw,
    });
    return;
  }
  if (payload.subtype === SystemSubtype.ModelRefusalFallback) {
    items.push({
      kind: TranscriptItemKind.ModelFallback,
      id: entryId,
      fromModel: payload.originalModel,
      toModel: payload.fallbackModel,
      timestampMs,
      raw: entry.raw,
    });
    return;
  }

  const fields = systemEventFields(payload, entry.raw);
  items.push({
    kind: TranscriptItemKind.SystemEvent,
    id: entryId,
    subtype: fields.subtype,
    summary: fields.summary,
    detailJson: fields.detailJson,
    timestampMs,
    raw: entry.raw,
  });
}

type SystemEventFields = { subtype: string; summary: string; detailJson: string | null };

function systemEventFields(payload: SystemPayload, raw: RawEntry): SystemEventFields {
  if (payload.subtype === SystemSubtype.AwaySummary) {
    // The full narrative is the summary — the view renders it as prose.
    return { subtype: payload.subtype, summary: payload.content, detailJson: null };
  }
  if (payload.subtype === SystemSubtype.TurnDuration) {
    return { subtype: payload.subtype, summary: turnDurationSummary(payload), detailJson: null };
  }
  if (payload.subtype === SystemSubtype.StopHookSummary) {
    return { subtype: payload.subtype, summary: stopHookSummary(payload), detailJson: prettyJson(raw) };
  }
  if (
    payload.subtype === SystemSubtype.LocalCommand ||
    payload.subtype === SystemSubtype.ScheduledTaskFire ||
    payload.subtype === SystemSubtype.Informational
  ) {
    const summary = summarizeText(payload.content);
    if (summary.length === 0) {
      return { subtype: payload.subtype, summary: payload.subtype, detailJson: prettyJson(raw) };
    }
    return { subtype: payload.subtype, summary, detailJson: expandedDetail(payload.content) };
  }
  if (payload.subtype === "unknown") {
    const subtype = payload.rawSubtype.length > 0 ? payload.rawSubtype : "system";
    const summary = summarizeText(payload.content);
    if (summary.length === 0) {
      return { subtype, summary: "system event", detailJson: prettyJson(raw) };
    }
    return { subtype, summary, detailJson: prettyJson(raw) };
  }

  // Unreachable in practice: the remaining variants are handled by the
  // caller before delegating here.
  return { subtype: payload.subtype, summary: payload.subtype, detailJson: prettyJson(raw) };
}

function turnDurationSummary(
  payload: Extract<SystemPayload, { subtype: typeof SystemSubtype.TurnDuration }>,
): string {
  const parts: string[] = [];
  if (payload.durationMs !== null) parts.push(`turn took ${formatSeconds(payload.durationMs)}`);
  if (payload.messageCount !== null) parts.push(pluralize(payload.messageCount, "message"));
  if (parts.length === 0) return "turn finished";
  return parts.join(" · ");
}

function stopHookSummary(
  payload: Extract<SystemPayload, { subtype: typeof SystemSubtype.StopHookSummary }>,
): string {
  const hookCount = payload.hookCount ?? payload.hooks.length;
  const parts: string[] = [pluralize(hookCount, "stop hook")];

  const totalDurationMs = payload.hooks.reduce((total, hook) => total + (hook.durationMs ?? 0), 0);
  if (totalDurationMs > 0) parts.push(formatSeconds(totalDurationMs));
  if (payload.hookErrors !== null && payload.hookErrors > 0) {
    parts.push(pluralize(payload.hookErrors, "error"));
  }
  if (payload.preventedContinuation) parts.push("blocked continuation");
  return parts.join(" · ");
}

function appendAttachmentItem(entry: AttachmentTraceEntry, items: TranscriptItem[]): void {
  items.push({
    kind: TranscriptItemKind.Attachment,
    id: itemId(entry.envelope.uuid, items),
    subtype: entry.subtype,
    summary: summarizeAttachment(entry),
    payloadJson: prettyJson(entry.attachment),
    timestampMs: entry.envelope.timestampMs,
    raw: entry.raw,
  });
}

const ATTACHMENT_SUMMARY_KEYS = [
  "filename",
  "path",
  "file_path",
  "command",
  "content",
  "text",
] as const;

function summarizeAttachment(entry: AttachmentTraceEntry): string {
  if (entry.hook !== null) {
    const hookParts: string[] = [];
    if (entry.hook.hookName !== null) hookParts.push(entry.hook.hookName);
    if (entry.hook.command !== null) hookParts.push(entry.hook.command);
    if (hookParts.length > 0) return summarizeText(hookParts.join(" · "));
  }

  for (const key of ATTACHMENT_SUMMARY_KEYS) {
    const value = entry.attachment[key];
    if (typeof value === "string" && value.trim().length > 0) return summarizeText(value);
  }
  return "injected context";
}

function appendPrLinkItem(entry: PrLinkTraceEntry, items: TranscriptItem[]): void {
  const parts: string[] = [];
  if (entry.prNumber !== null) parts.push(`PR #${entry.prNumber}`);
  if (entry.prRepository !== null) parts.push(entry.prRepository);
  if (parts.length === 0 && entry.prUrl !== null) parts.push(entry.prUrl);

  let summary = "pull request linked";
  if (parts.length > 0) summary = parts.join(" · ");

  items.push({
    kind: TranscriptItemKind.SystemEvent,
    id: itemId(entry.envelope.uuid, items),
    subtype: InjectedEventSubtype.PrLink,
    summary,
    detailJson: null,
    timestampMs: entry.envelope.timestampMs,
    raw: entry.raw,
  });
}

function appendSessionMetaItem(
  entry: Extract<TraceEntry, { kind: typeof TraceEntryKind.SessionMeta }>,
  items: TranscriptItem[],
  sessionMetaLastValues: Record<string, string>,
): boolean {
  // last-prompt is rewritten every turn and duplicates the user bubble it
  // trails — absorbed by the bubble, never rendered.
  if (entry.field === SessionMetaField.LastPrompt) return true;

  const previousValue = sessionMetaLastValues[entry.field];
  if (previousValue === entry.value) return true;

  sessionMetaLastValues[entry.field] = entry.value;
  items.push({
    kind: TranscriptItemKind.SessionMeta,
    id: itemId(entry.envelope.uuid, items),
    field: entry.field,
    value: entry.value,
    timestampMs: entry.envelope.timestampMs,
    raw: entry.raw,
  });
  return false;
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
  const structuredResult = typeof entry.toolUseResult === "string" ? null : entry.toolUseResult;

  items[index] = {
    ...item,
    output,
    images: [...item.images, ...result.images],
    isError: result.isError,
    denialKind: entry.toolDenialKind,
    endedAtMs: entry.envelope.timestampMs,
    resultRaw: entry.raw,
    toolUseResult: structuredResult,
  };
}

function contextTokensFromUsage(usage: TokenUsage | null): number | null {
  if (usage === null) return null;
  const total = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
  return total > 0 ? total : null;
}

function countItemKinds(items: TranscriptItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  }
  return counts;
}

function itemId(uuid: string | null, items: TranscriptItem[]): string {
  // items.length only grows, so positional fallback ids stay unique across
  // successive appendEntries calls.
  return uuid ?? `entry-${items.length}`;
}

const SUMMARY_MAX_CHARS = 140;
const ELLIPSIS = "…";

function summarizeText(text: string): string {
  const firstLine = (text.trim().split("\n")[0] ?? "").trim();
  if (firstLine.length <= SUMMARY_MAX_CHARS) return firstLine;
  return `${firstLine.slice(0, SUMMARY_MAX_CHARS)}${ELLIPSIS}`;
}

function expandedDetail(content: string): string | null {
  const trimmed = content.trim();
  if (trimmed.length === 0) return null;
  const fitsInSummary = !trimmed.includes("\n") && trimmed.length <= SUMMARY_MAX_CHARS;
  if (fitsInSummary) return null;
  return trimmed;
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "null";
}

const MS_PER_SECOND = 1000;

function formatSeconds(durationMs: number): string {
  return `${(durationMs / MS_PER_SECOND).toFixed(1)}s`;
}

function pluralize(count: number, singular: string): string {
  if (count === 1) return `${count} ${singular}`;
  return `${count} ${singular}s`;
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

const BASH_INPUT_PATTERN = /<bash-input>([\s\S]*?)<\/bash-input>/;
const BASH_STDOUT_PATTERN = /<bash-stdout>([\s\S]*?)<\/bash-stdout>/;
const BASH_STDERR_PATTERN = /<bash-stderr>([\s\S]*?)<\/bash-stderr>/;

function parseBashCommand(text: string): { command: string; output: string } | null {
  const inputMatch = BASH_INPUT_PATTERN.exec(text);
  if (inputMatch === null) return null;

  const command = (inputMatch[1] ?? "").trim();
  if (command.length === 0) return null;

  const stdout = (BASH_STDOUT_PATTERN.exec(text)?.[1] ?? "").trim();
  const stderr = (BASH_STDERR_PATTERN.exec(text)?.[1] ?? "").trim();
  const output = [stdout, stderr].filter((part) => part.length > 0).join("\n");
  return { command, output };
}
