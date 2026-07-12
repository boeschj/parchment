import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseTraceEntry, type TraceEntry } from "@boeschj/claude-jsonl";
import { extractTranscriptMetrics } from "./extract-metrics.ts";
import { readTranscriptEntries } from "./read-transcript.ts";

const FIXTURES_DIR = join(import.meta.dir, "fixtures");
const isCanvasRenderCall = (toolUse: { toolName: string }): boolean =>
  toolUse.toolName === "mcp__canvas__canvas_render";

describe("extractTranscriptMetrics", () => {
  test("dedupes a message split across lines and finds first paint on the accepted attempt", () => {
    const entries = readTranscriptEntries(join(FIXTURES_DIR, "parchment-two-attempts.jsonl"));

    const metrics = extractTranscriptMetrics(entries, isCanvasRenderCall);

    // Three assistant turns: the rejected attempt, the accepted attempt, and
    // a final wrap-up message — even though that wrap-up spans two JSONL
    // lines (thinking + text) sharing one message.id.
    expect(metrics.assistantTurnCount).toBe(3);
    expect(metrics.totalPromptTokens).toBe(500 + 650 + 700);
    expect(metrics.totalCompletionTokens).toBe(80 + 90 + 110);

    // Both canvas_render calls count as attempts, even the rejected one.
    expect(metrics.renderAttempts).toBe(2);

    // First paint lands on the SECOND attempt (the first was rejected), so
    // the cumulative token count includes both the rejected and accepted turns.
    expect(metrics.turnsToFirstPaint).toBe(2);
    expect(metrics.tokensToFirstPaint).toBe(500 + 80 + 650 + 90);
  });

  test("reports no first paint when every render attempt was rejected", () => {
    const entries: TraceEntry[] = [
      assistantMessage("msg_1", "tool_1", 400, 60),
      toolResult("tool_1", true),
    ];

    const metrics = extractTranscriptMetrics(entries, isCanvasRenderCall);

    expect(metrics.renderAttempts).toBe(1);
    expect(metrics.tokensToFirstPaint).toBeNull();
    expect(metrics.turnsToFirstPaint).toBeNull();
  });

  test("counts cache-read and cache-creation tokens as prompt tokens, not just the fresh delta", () => {
    const entries: TraceEntry[] = [
      parseTraceEntry({
        type: "assistant",
        uuid: "a1",
        timestamp: "2026-07-12T00:00:00.000Z",
        message: {
          model: "claude-haiku-4-5",
          id: "msg_1",
          role: "assistant",
          content: [{ type: "text", text: "hi" }],
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_read_input_tokens: 5000,
            cache_creation_input_tokens: 300,
          },
        },
      }),
    ];

    const metrics = extractTranscriptMetrics(entries, isCanvasRenderCall);

    expect(metrics.totalPromptTokens).toBe(10 + 5000 + 300);
    expect(metrics.totalCompletionTokens).toBe(20);
  });

  test("reports zero render attempts when the transcript never calls the predicate's tool", () => {
    const entries: TraceEntry[] = [textOnlyAssistantMessage("msg_1", 300, 40)];

    const metrics = extractTranscriptMetrics(entries, isCanvasRenderCall);

    expect(metrics.assistantTurnCount).toBe(1);
    expect(metrics.renderAttempts).toBe(0);
    expect(metrics.tokensToFirstPaint).toBeNull();
    expect(metrics.turnsToFirstPaint).toBeNull();
  });
});

function assistantMessage(
  messageId: string,
  toolUseId: string,
  inputTokens: number,
  outputTokens: number,
): TraceEntry {
  return parseTraceEntry({
    type: "assistant",
    uuid: `${messageId}-line`,
    timestamp: "2026-07-12T00:00:00.000Z",
    message: {
      model: "claude-haiku-4-5",
      id: messageId,
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: toolUseId,
          name: "mcp__canvas__canvas_render",
          input: {},
        },
      ],
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    },
  });
}

function textOnlyAssistantMessage(messageId: string, inputTokens: number, outputTokens: number): TraceEntry {
  return parseTraceEntry({
    type: "assistant",
    uuid: `${messageId}-line`,
    timestamp: "2026-07-12T00:00:00.000Z",
    message: {
      model: "claude-haiku-4-5",
      id: messageId,
      role: "assistant",
      content: [{ type: "text", text: "All done." }],
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    },
  });
}

function toolResult(toolUseId: string, isError: boolean): TraceEntry {
  return parseTraceEntry({
    type: "user",
    uuid: `${toolUseId}-result`,
    timestamp: "2026-07-12T00:00:01.000Z",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          is_error: isError,
          content: [{ type: "text", text: isError ? "rejected" : "accepted" }],
        },
      ],
    },
  });
}
