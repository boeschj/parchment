// Turns a parsed session transcript into the token/turn numbers the report
// tables compare across arms. Pure function over TraceEntry[] — no filesystem
// access here, so it is directly unit-testable against a hand-built fixture.
//
// Two facts about the on-disk schema drive the design (confirmed against a
// real transcript, not assumed):
//   1. One assistant "turn" can span MULTIPLE JSONL lines that share one
//      message.id (e.g. a thinking block and a text block each get their own
//      line). Token usage is duplicated on every line for that message, so
//      messages MUST be deduped by messageId before summing — counting lines
//      instead of messages would double- or triple-count both turns and tokens.
//   2. A tool call's outcome (accepted vs rejected) lives on the tool_result
//      in a LATER user entry, matched back to the call by tool_use_id — never
//      on the assistant entry that made the call.

import {
  BlockKind,
  TraceEntryKind,
  type AssistantTraceEntry,
  type ContentBlock,
  type TraceEntry,
} from "@boeschj/claude-jsonl";
import type { TranscriptMetrics } from "../types.ts";

type ToolUseBlock = Extract<ContentBlock, { kind: typeof BlockKind.ToolUse }>;

// Decides whether a given tool call counts as an attempt at producing the
// scenario's UI — e.g. "toolName is a canvas_* render tool" for the parchment
// arm, or "toolName is Write/Edit targeting this run's output file" for the
// HTML arm. Supplied by the caller, who knows which arm and scenario this is;
// keeps this module arm-agnostic.
export type RenderAttemptPredicate = (toolUse: { toolName: string; input: Record<string, unknown> }) => boolean;

type AssistantMessage = {
  promptTokens: number;
  completionTokens: number;
  toolUseBlocks: ToolUseBlock[];
};

export function extractTranscriptMetrics(
  entries: TraceEntry[],
  isRenderAttempt: RenderAttemptPredicate,
): TranscriptMetrics {
  const messages = collectAssistantMessages(entries);
  const toolResultWasError = collectToolResultErrorsByToolUseId(entries);

  let renderAttempts = 0;
  let cumulativeTokens = 0;
  let tokensToFirstPaint: number | null = null;
  let turnsToFirstPaint: number | null = null;

  messages.forEach((message, messageIndex) => {
    cumulativeTokens += message.promptTokens + message.completionTokens;

    for (const toolUse of message.toolUseBlocks) {
      if (!isRenderAttempt({ toolName: toolUse.toolName, input: toolUse.input })) continue;
      renderAttempts += 1;

      const wasAccepted = toolResultWasError.get(toolUse.toolUseId) === false;
      const alreadyPainted = tokensToFirstPaint !== null;
      if (wasAccepted && !alreadyPainted) {
        tokensToFirstPaint = cumulativeTokens;
        turnsToFirstPaint = messageIndex + 1;
      }
    }
  });

  return {
    assistantTurnCount: messages.length,
    totalPromptTokens: sumBy(messages, (message) => message.promptTokens),
    totalCompletionTokens: sumBy(messages, (message) => message.completionTokens),
    renderAttempts,
    tokensToFirstPaint,
    turnsToFirstPaint,
  };
}

// Groups assistant entries by message.id, preserving first-seen order, and
// concatenates tool_use blocks contributed across that message's lines.
function collectAssistantMessages(entries: TraceEntry[]): AssistantMessage[] {
  const messages: AssistantMessage[] = [];
  const messageIndexById = new Map<string, number>();

  for (const entry of entries) {
    if (entry.kind !== TraceEntryKind.Assistant) continue;
    if (entry.messageId === null) continue;

    const toolUseBlocks = entry.blocks.filter(isToolUseBlock);
    const existingIndex = messageIndexById.get(entry.messageId);

    if (existingIndex === undefined) {
      messageIndexById.set(entry.messageId, messages.length);
      messages.push({
        promptTokens: promptTokensOf(entry.usage),
        completionTokens: entry.usage?.outputTokens ?? 0,
        toolUseBlocks,
      });
      continue;
    }

    messages[existingIndex]?.toolUseBlocks.push(...toolUseBlocks);
  }

  return messages;
}

function collectToolResultErrorsByToolUseId(entries: TraceEntry[]): Map<string, boolean> {
  const wasErrorByToolUseId = new Map<string, boolean>();
  for (const entry of entries) {
    if (entry.kind !== TraceEntryKind.User) continue;
    for (const toolResult of entry.toolResults) {
      wasErrorByToolUseId.set(toolResult.toolUseId, toolResult.isError);
    }
  }
  return wasErrorByToolUseId;
}

function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.kind === BlockKind.ToolUse;
}

// Anthropic's `usage.input_tokens` is only the cache-miss delta for that
// turn — almost the entire system prompt, tool schemas, and prior turns
// arrive as cache_read (or get written fresh as cache_creation) instead.
// Reporting input_tokens alone would show a handful of tokens on a turn that
// actually cost real money and processed thousands of tokens of context, so
// "prompt tokens" here is the full input the model processed: fresh +
// cache-read + cache-creation.
function promptTokensOf(usage: AssistantTraceEntry["usage"]): number {
  if (!usage) return 0;
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
}

function sumBy<T>(items: T[], selector: (item: T) => number): number {
  return items.reduce((total, item) => total + selector(item), 0);
}
