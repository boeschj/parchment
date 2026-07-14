// The ledger's four load-bearing claims, each tested against a transcript whose
// correct answer is known by construction. If any of these regress, every number
// the eval publishes is wrong by a factor nobody would notice by eye — which is
// the entire reason they are pinned here.
//
// The fixtures are built as RAW JSONL LINES and pushed through the real parser
// (@boeschj/claude-jsonl's parseTraceEntry), not hand-assembled as TraceEntry
// objects. A test that skips the parser would keep passing after the on-disk
// schema drifted underneath it.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseTraceEntry, type TraceEntry } from "@boeschj/claude-jsonl";
import { readTranscriptEntries } from "../bench/metrics/read-transcript.ts";
import { CACHE_READ_PRICE_MULTIPLIER, ModelPricing } from "./config.ts";
import {
  buildAttemptRecord,
  collectMessageUsage,
  costOfRun,
  subtractHarnessConstant,
  summariseRun,
  summariseTranscript,
} from "./ledger.ts";
import { EvalModel } from "./types.ts";
import type { AuthoringMeasurement, EvalAttemptRecord } from "./ledger.ts";

const BENCH_FIXTURE = join(
  import.meta.dir,
  "..",
  "bench",
  "metrics",
  "fixtures",
  "parchment-two-attempts.jsonl",
);

type UsageFixture = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

// One JSONL line. Claude Code writes one per CONTENT BLOCK, so several lines can
// carry the same message id — and the same usage.
function assistantLine(input: {
  uuid: string;
  messageId: string;
  usage: UsageFixture;
  content: Record<string, unknown>[];
}): TraceEntry {
  return parseTraceEntry({
    type: "assistant",
    uuid: input.uuid,
    parentUuid: null,
    timestamp: "2026-07-12T00:00:00.000Z",
    sessionId: "ledger-fixture",
    message: {
      model: "claude-sonnet-4-6",
      id: input.messageId,
      role: "assistant",
      content: input.content,
      usage: input.usage,
    },
  });
}

function textBlock(text: string): Record<string, unknown> {
  return { type: "text", text };
}

function thinkingBlock(thinking: string): Record<string, unknown> {
  return { type: "thinking", thinking };
}

function attemptRecord(overrides: Partial<EvalAttemptRecord>): EvalAttemptRecord {
  return {
    attemptIndex: 0,
    outputTokens: 0,
    authoredOutputTokens: 0,
    authoredArtifactBytes: 0,
    renderCallCount: 0,
    usedReference: false,
    referenceKindsUsed: [],
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    assistantTurnCount: 1,
    wallClockMs: 1_000,
    reportedCostUsd: 0,
    artifact: null,
    accepted: false,
    failureReasons: [],
    ...overrides,
  };
}

function authoring(overrides: Partial<AuthoringMeasurement> = {}): AuthoringMeasurement {
  return {
    authoringMessageId: null,
    renderCallCount: 0,
    authoredArtifactBytes: 0,
    usedReference: false,
    referenceKindsUsed: [],
    ...overrides,
  };
}

// (a) THE messageId-DEDUP BUG ---------------------------------------------------

describe("one assistant message split across multiple JSONL lines", () => {
  // A thinking block and a text block from ONE message get one line each, and
  // the usage object is duplicated onto both. Counting lines would report 2
  // turns and double every token.
  const splitMessage: TraceEntry[] = [
    assistantLine({
      uuid: "a1",
      messageId: "msg_split",
      usage: { input_tokens: 100, output_tokens: 400, cache_read_input_tokens: 7_000 },
      content: [thinkingBlock("planning the render")],
    }),
    assistantLine({
      uuid: "a2",
      messageId: "msg_split",
      usage: { input_tokens: 100, output_tokens: 400, cache_read_input_tokens: 7_000 },
      content: [textBlock("done")],
    }),
  ];

  test("is counted ONCE, not once per line", () => {
    const usage = summariseTranscript(splitMessage);

    expect(usage.assistantTurnCount).toBe(1);
    expect(usage.outputTokens).toBe(400);
    expect(usage.inputTokens).toBe(100);
    expect(usage.cacheReadTokens).toBe(7_000);
  });

  test("dedup keys on the message id, so distinct messages still both count", () => {
    const twoMessages = [
      ...splitMessage,
      assistantLine({
        uuid: "a3",
        messageId: "msg_second",
        usage: { input_tokens: 50, output_tokens: 60 },
        content: [textBlock("second message")],
      }),
    ];

    const usage = summariseTranscript(twoMessages);

    expect(usage.assistantTurnCount).toBe(2);
    expect(usage.outputTokens).toBe(400 + 60);
  });

  test("the real bench fixture's duplicated message is counted once", () => {
    // parchment-two-attempts.jsonl: msg_1 (500/80), msg_2 (650/90), msg_3
    // (700/110) written across TWO lines. Three messages, not four.
    const entries = readTranscriptEntries(BENCH_FIXTURE);

    const usage = summariseTranscript(entries);

    expect(usage.assistantTurnCount).toBe(3);
    expect(usage.outputTokens).toBe(80 + 90 + 110);
    expect(usage.inputTokens).toBe(500 + 650 + 700);
  });
});

// (b) PROMPT TOKENS INCLUDE THE CACHE --------------------------------------------

describe("prompt tokens", () => {
  const cachedTurn = [
    assistantLine({
      uuid: "a1",
      messageId: "msg_cached",
      usage: {
        input_tokens: 12,
        output_tokens: 300,
        cache_read_input_tokens: 6_500,
        cache_creation_input_tokens: 1_200,
      },
      content: [textBlock("rendered")],
    }),
  ];

  test("are input + cacheRead + cacheCreation, not usage.input_tokens alone", () => {
    const usage = summariseTranscript(cachedTurn);

    // Reporting the bare 12 would claim this turn read twelve tokens of context.
    // It read 7,712.
    expect(usage.promptTokens).toBe(12 + 6_500 + 1_200);
    expect(usage.promptTokens).not.toBe(usage.inputTokens);
  });

  test("keep the three components separate, because they are priced differently", () => {
    const [message] = collectMessageUsage(cachedTurn);

    expect(message?.inputTokens).toBe(12);
    expect(message?.cacheReadTokens).toBe(6_500);
    expect(message?.cacheCreationTokens).toBe(1_200);
  });
});

// (c) REPAIR TURNS ADD, THEY DO NOT REPLACE ---------------------------------------

describe("a repair turn on a resumed session", () => {
  // --resume appends to the SAME transcript file, so the repair turn's JSONL
  // still contains the authoring turn's messages. Attempt 2 must count only what
  // attempt 2 spent — but the RUN must count both.
  const authoringTurn = assistantLine({
    uuid: "a1",
    messageId: "msg_author",
    usage: { input_tokens: 100, output_tokens: 1_000, cache_creation_input_tokens: 7_000 },
    content: [textBlock("first render")],
  });
  const repairTurn = assistantLine({
    uuid: "a2",
    messageId: "msg_repair",
    usage: { input_tokens: 40, output_tokens: 250, cache_read_input_tokens: 7_100 },
    content: [textBlock("fixed render")],
  });

  const transcriptAfterAuthoring = [authoringTurn];
  const transcriptAfterRepair = [authoringTurn, repairTurn];

  test("counts only the repair's own messages for the repair attempt", () => {
    const first = buildAttemptRecord({
      attemptIndex: 0,
      entries: transcriptAfterAuthoring,
      excludedMessageIds: new Set(),
      wallClockMs: 5_000,
      reportedCostUsd: 0.02,
      artifact: null,
      authoring: authoring({ authoringMessageId: "msg_author", renderCallCount: 1 }),
      accepted: false,
      failureReasons: ["table-rows: missing rows"],
    });

    const second = buildAttemptRecord({
      attemptIndex: 1,
      entries: transcriptAfterRepair,
      excludedMessageIds: new Set(first.messageIds),
      wallClockMs: 3_000,
      reportedCostUsd: 0.01,
      artifact: null,
      authoring: authoring({ authoringMessageId: "msg_repair", renderCallCount: 1 }),
      accepted: true,
      failureReasons: [],
    });

    expect(first.record.outputTokens).toBe(1_000);
    // Without the exclusion this would be 1,250 — the authoring turn billed twice.
    expect(second.record.outputTokens).toBe(250);
    expect(second.record.assistantTurnCount).toBe(1);
  });

  test("the RUN total is the sum of every attempt, repairs included", () => {
    const attempts = [
      attemptRecord({ attemptIndex: 0, outputTokens: 1_000, inputTokens: 100, cacheCreationTokens: 7_000 }),
      attemptRecord({
        attemptIndex: 1,
        outputTokens: 250,
        inputTokens: 40,
        cacheReadTokens: 7_100,
        accepted: true,
      }),
    ];

    const totals = summariseRun(attempts, 900);

    // The objective function: a format that needed a repair pays for the repair.
    expect(totals.totalOutputTokens).toBe(1_250);
    expect(totals.totalPromptTokens).toBe(100 + 7_000 + 40 + 7_100);
    expect(totals.attemptCount).toBe(2);
    expect(totals.passed).toBe(true);
    expect(totals.attemptsToPass).toBe(2);
    expect(totals.systemPromptTokens).toBe(900);
  });

  test("a run nobody passed reports attemptsToPass null, never a silent zero", () => {
    const totals = summariseRun([attemptRecord({ attemptIndex: 0, outputTokens: 500 })], 0);

    expect(totals.passed).toBe(false);
    expect(totals.attemptsToPass).toBeNull();
    expect(totals.totalOutputTokens).toBe(500);
  });

  test("a first-attempt pass is attemptsToPass 1, not 0", () => {
    const totals = summariseRun([attemptRecord({ attemptIndex: 0, accepted: true })], 0);

    expect(totals.attemptsToPass).toBe(1);
  });
});

// THE HEADLINE METRIC: THE COST OF EMITTING THE ARTIFACT ------------------------------

describe("authored output tokens", () => {
  // A session's total output is dominated by agentic exploration — reading files,
  // running git, thinking. That is real cost, but it is not the FORMAT's cost.
  // The format's cost is the output tokens of the message that carried the render
  // call, and nothing else.
  const exploration = assistantLine({
    uuid: "a1",
    messageId: "msg_explore",
    usage: { input_tokens: 100, output_tokens: 9_000 },
    content: [textBlock("let me read the file and run git diff")],
  });
  const authoringTurn = assistantLine({
    uuid: "a2",
    messageId: "msg_author",
    usage: { input_tokens: 200, output_tokens: 350 },
    content: [textBlock("rendering now")],
  });

  test("counts ONLY the message that carried the render call", () => {
    const entry = buildAttemptRecord({
      attemptIndex: 0,
      entries: [exploration, authoringTurn],
      excludedMessageIds: new Set(),
      wallClockMs: 30_000,
      reportedCostUsd: 0.1,
      artifact: null,
      authoring: authoring({
        authoringMessageId: "msg_author",
        renderCallCount: 1,
        authoredArtifactBytes: 412,
      }),
      accepted: true,
      failureReasons: [],
    });

    // The 9,000 exploration tokens are real, and they are still reported...
    expect(entry.record.outputTokens).toBe(9_350);
    // ...but the artifact cost 350 tokens to emit, and THAT is the format's cost.
    expect(entry.record.authoredOutputTokens).toBe(350);
    expect(entry.record.authoredArtifactBytes).toBe(412);
  });

  test("an attempt that never authored anything reports 0, not the session total", () => {
    const entry = buildAttemptRecord({
      attemptIndex: 0,
      entries: [exploration],
      excludedMessageIds: new Set(),
      wallClockMs: 30_000,
      reportedCostUsd: 0.1,
      artifact: null,
      authoring: authoring(),
      accepted: false,
      failureReasons: ["nothing authored"],
    });

    expect(entry.record.outputTokens).toBe(9_000);
    expect(entry.record.authoredOutputTokens).toBe(0);
  });

  test("the run's headline total sums the authored tokens of every attempt, repairs included", () => {
    const totals = summariseRun(
      [
        attemptRecord({ attemptIndex: 0, outputTokens: 9_350, authoredOutputTokens: 350 }),
        attemptRecord({
          attemptIndex: 1,
          outputTokens: 1_200,
          authoredOutputTokens: 300,
          authoredArtifactBytes: 400,
          accepted: true,
        }),
      ],
      0,
    );

    expect(totals.totalAuthoredOutputTokens).toBe(650);
    expect(totals.passingAuthoredOutputTokens).toBe(300);
    expect(totals.passingAuthoredArtifactBytes).toBe(400);
    // The secondary metric survives alongside it — both are published.
    expect(totals.totalOutputTokens).toBe(10_550);
  });
});

// DID THE MODEL CLIMB THE LADDER? -------------------------------------------------------

describe("reference usage", () => {
  // The ladder only pays off if the model REACHES for the reference. If it pastes
  // the file anyway, the compression is available and unused — a major negative
  // result, and one the harness must be able to report rather than hide.
  test("a run that pasted the file reports usedReference false", () => {
    const totals = summariseRun([attemptRecord({ usedReference: false, accepted: true })], 0);

    expect(totals.usedReference).toBe(false);
    expect(totals.referenceKindsUsed).toEqual([]);
  });

  test("a run that reached for the reference on ANY attempt reports it, with the kinds", () => {
    const totals = summariseRun(
      [
        attemptRecord({ attemptIndex: 0, usedReference: false }),
        attemptRecord({
          attemptIndex: 1,
          usedReference: true,
          referenceKindsUsed: ["GitDiff"],
          accepted: true,
        }),
      ],
      0,
    );

    expect(totals.usedReference).toBe(true);
    expect(totals.referenceKindsUsed).toEqual(["GitDiff"]);
  });
});

// (d) COLD VS WARM CACHE COST -------------------------------------------------------

describe("cost", () => {
  const attempts = [
    attemptRecord({
      attemptIndex: 0,
      outputTokens: 1_000,
      inputTokens: 100,
      cacheReadTokens: 10_000,
      cacheCreationTokens: 500,
    }),
  ];
  const totals = summariseRun(attempts, 0);

  test("warm is cheaper than cold whenever anything was read from cache", () => {
    const cost = costOfRun(EvalModel.Sonnet, totals);

    expect(cost.warmCacheUsd).toBeLessThan(cost.coldCacheUsd);
  });

  test("cold bills cache reads as fresh input; warm bills them at the cache multiplier", () => {
    const pricing = ModelPricing[EvalModel.Sonnet];
    const perInputToken = pricing.inputPerMillionUsd / 1_000_000;
    const perOutputToken = pricing.outputPerMillionUsd / 1_000_000;

    const cost = costOfRun(EvalModel.Sonnet, totals);

    const expectedOutput = 1_000 * perOutputToken;
    const expectedFreshInput = (100 + 500) * perInputToken;
    const expectedCacheReadCold = 10_000 * perInputToken;
    const expectedCacheReadWarm = expectedCacheReadCold * CACHE_READ_PRICE_MULTIPLIER;

    expect(cost.outputUsd).toBeCloseTo(expectedOutput, 10);
    expect(cost.coldCacheUsd).toBeCloseTo(expectedOutput + expectedFreshInput + expectedCacheReadCold, 10);
    expect(cost.warmCacheUsd).toBeCloseTo(expectedOutput + expectedFreshInput + expectedCacheReadWarm, 10);
  });

  test("the two agree exactly when nothing was cached — the multiplier has nothing to bite on", () => {
    const uncached = summariseRun([attemptRecord({ outputTokens: 100, inputTokens: 200 })], 0);

    const cost = costOfRun(EvalModel.Haiku, uncached);

    expect(cost.warmCacheUsd).toBeCloseTo(cost.coldCacheUsd, 10);
  });

  test("output dominates: the same token count costs 5x more as output than as input", () => {
    const asOutput = costOfRun(EvalModel.Sonnet, summariseRun([attemptRecord({ outputTokens: 10_000 })], 0));
    const asInput = costOfRun(EvalModel.Sonnet, summariseRun([attemptRecord({ inputTokens: 10_000 })], 0));

    expect(asOutput.coldCacheUsd).toBeCloseTo(asInput.coldCacheUsd * 5, 10);
  });
});

// THE HARNESS CONSTANT, SUBTRACTED IN THE OPEN ----------------------------------------

describe("harness-subtracted input", () => {
  test("shows its arithmetic and never publishes a bare adjusted number", () => {
    const subtracted = subtractHarnessConstant({
      rawPromptTokens: 20_000,
      assistantTurnCount: 2,
      harnessConstantTokens: 7_000,
    });

    expect(subtracted.rawPromptTokens).toBe(20_000);
    expect(subtracted.harnessTokens).toBe(14_000);
    expect(subtracted.adjustedPromptTokens).toBe(6_000);
    expect(subtracted.workings).toBe("20000 raw prompt tokens - (7000 harness constant x 2 assistant turns) = 6000");
  });

  test("floors at zero rather than reporting a negative input", () => {
    const subtracted = subtractHarnessConstant({
      rawPromptTokens: 5_000,
      assistantTurnCount: 1,
      harnessConstantTokens: 7_000,
    });

    expect(subtracted.adjustedPromptTokens).toBe(0);
  });
});
