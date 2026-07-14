// The token ledger. Every published number comes from here, so every claim in
// here is one a hostile reader can check against an archived transcript.
//
// FOUR FACTS ABOUT THE ON-DISK SCHEMA DRIVE THIS FILE. Each was confirmed
// against a real transcript, and each is a bug that would silently invalidate
// the whole eval if got wrong:
//
//   1. ONE ASSISTANT MESSAGE SPANS MULTIPLE JSONL LINES. A thinking block and a
//      text block from the same message each get their own line, and the usage
//      object is DUPLICATED onto every one of them. Summing lines instead of
//      messages double- or triple-counts both turns and tokens. Messages are
//      therefore deduped by messageId before anything is added up.
//   2. "PROMPT TOKENS" IS NOT usage.input_tokens. That field is only the
//      cache-miss delta; the system prompt, the tool schemas, and the prior
//      turns arrive as cache_read (or are written fresh as cache_creation). The
//      three fields PARTITION the input, so the tokens the model actually read
//      are input + cacheRead + cacheCreation, and that sum is what
//      totalPromptTokens reports. The three components are kept separately
//      because they are PRICED differently, never because one of them is "the"
//      input.
//   3. A RESUMED SESSION APPENDS TO ONE TRANSCRIPT FILE. The repair turn's JSONL
//      contains the authoring turn's messages too. Attributing a transcript to
//      an attempt therefore means excluding the messages already attributed to
//      earlier attempts — otherwise a 3-attempt run reports its first attempt's
//      tokens three times, and repairs look free.
//   4. THE HARNESS CONSTANT IS MEASURED, NOT ASSUMED. Claude Code sends ~7-10k
//      tokens of system prompt and tool schemas on every call regardless of arm.
//      It is identical across arms and therefore cannot bias an OUTPUT
//      comparison — but it is never quietly subtracted. Both the raw input and
//      the harness-subtracted input are published, with the arithmetic shown.

import { TraceEntryKind, type AssistantTraceEntry, type TraceEntry } from "@boeschj/claude-jsonl";
import { CACHE_READ_PRICE_MULTIPLIER, EvalPaths, ModelPricing } from "./config.ts";
import { runClaudeProbe } from "./driver.ts";
import type { EvalDaemon } from "./daemon.ts";
import {
  ArmId,
  AuthoringSurface,
  type Arm,
  type AttemptRecord,
  type AuthoredArtifact,
  type EvalModel,
  type RunRecord,
} from "./types.ts";

const TOKENS_PER_MILLION = 1_000_000;

// The cheapest prompt that still pays the full harness cost: one word in, one
// word out. Whatever input this run reports IS the constant, since the arm
// contributes no system prompt and the task contributes nine tokens.
const HARNESS_PROBE_PROMPT = "reply with the single word: ok";
const HARNESS_PROBE_SYSTEM_PROMPT = "";

// The probe only needs an arm id to satisfy the canvas server's --mcp-config env;
// the canvas tool SCHEMA — which is the thing a probe measures — is identical for
// every arm, so which one is named here cannot change the measurement.
const HARNESS_PROBE_ARM_ID: ArmId = ArmId.ParchmentMarkupHigh;

// ---- Assistant messages, deduped ---------------------------------------------

export type MessageUsage = {
  messageId: string;
  // The primary axis. Output bills ~5x input and ~50x cached input.
  outputTokens: number;
  // The input partition. These three sum to what the model read.
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

export function promptTokensOf(usage: {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}): number {
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
}

// Fact 1 and fact 3, in one place: one entry per MESSAGE (not per line), and
// never a message an earlier attempt already paid for.
export function collectMessageUsage(
  entries: readonly TraceEntry[],
  excludedMessageIds: ReadonlySet<string> = new Set(),
): MessageUsage[] {
  const messages: MessageUsage[] = [];
  const seenMessageIds = new Set<string>();

  for (const entry of entries) {
    if (entry.kind !== TraceEntryKind.Assistant) continue;
    if (entry.messageId === null) continue;
    if (excludedMessageIds.has(entry.messageId)) continue;
    if (seenMessageIds.has(entry.messageId)) continue;

    seenMessageIds.add(entry.messageId);
    messages.push(usageOf(entry));
  }

  return messages;
}

function usageOf(entry: AssistantTraceEntry): MessageUsage {
  const messageId = entry.messageId ?? "";
  const usage = entry.usage;
  if (usage === null) {
    return {
      messageId,
      outputTokens: 0,
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
  }

  return {
    messageId,
    outputTokens: usage.outputTokens,
    inputTokens: usage.inputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
  };
}

// ---- One attempt --------------------------------------------------------------

export type TranscriptUsage = {
  outputTokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  // input + cacheRead + cacheCreation. The honest "what did the model read".
  promptTokens: number;
  assistantTurnCount: number;
  // Exactly the messages this usage was computed from, so the caller can exclude
  // them from the next attempt on the same (resumed) transcript.
  messageIds: string[];
};

export function summariseTranscript(
  entries: readonly TraceEntry[],
  excludedMessageIds: ReadonlySet<string> = new Set(),
): TranscriptUsage {
  const messages = collectMessageUsage(entries, excludedMessageIds);

  const outputTokens = sumBy(messages, (message) => message.outputTokens);
  const inputTokens = sumBy(messages, (message) => message.inputTokens);
  const cacheReadTokens = sumBy(messages, (message) => message.cacheReadTokens);
  const cacheCreationTokens = sumBy(messages, (message) => message.cacheCreationTokens);

  return {
    outputTokens,
    inputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    promptTokens: inputTokens + cacheReadTokens + cacheCreationTokens,
    assistantTurnCount: messages.length,
    messageIds: messages.map((message) => message.messageId),
  };
}

// THE HEADLINE METRIC AND THE SECONDARY ONE — the distinction is the thesis.
//
// A session's total output tokens include the model reading files, running git,
// and thinking. That is real cost and it is reported (`outputTokens`), but it is
// dominated by AGENTIC EXPLORATION, which is a property of the task and the
// harness, not of the FORMAT. Measured on its own it would have us comparing
// session behaviour and calling it a format comparison.
//
// The format's cost is the cost of EMITTING the artifact: the output tokens of
// the single assistant message that carried the render call
// (`authoredOutputTokens`). That is an exact number read from the transcript —
// not a character proxy, not an estimate — and it is computed by the SAME rule
// for every arm (the canvas_render call, or the Write call).
export type AuthoringMeasurement = {
  // Which assistant message carried the render call, from driver.ts.
  authoringMessageId: string | null;
  renderCallCount: number;
  // Exact byte length of what the model emitted into the tool call.
  authoredArtifactBytes: number;
  // Did the model CLIMB the ladder, or paste the file anyway?
  usedReference: boolean;
  referenceKindsUsed: readonly string[];
};

// evals/types.ts is owned elsewhere and its AttemptRecord/RunRecord cannot be
// edited from here, so the eval's measurements extend them structurally. Any
// consumer typed against AttemptRecord keeps working unchanged.
export type EvalAttemptRecord = AttemptRecord & {
  authoredOutputTokens: number;
  authoredArtifactBytes: number;
  renderCallCount: number;
  usedReference: boolean;
  referenceKindsUsed: readonly string[];
};

export type EvalRunRecord = Omit<RunRecord, "attempts"> & {
  attempts: readonly EvalAttemptRecord[];
};

export type AttemptInput = {
  attemptIndex: number;
  entries: readonly TraceEntry[];
  // Messages already attributed to earlier attempts of this run (fact 3).
  excludedMessageIds: ReadonlySet<string>;
  wallClockMs: number;
  // Claude Code's own cost figure. Reported next to ours; never used as ours.
  reportedCostUsd: number;
  artifact: AuthoredArtifact | null;
  authoring: AuthoringMeasurement;
  accepted: boolean;
  failureReasons: readonly string[];
};

export type AttemptLedgerEntry = {
  record: EvalAttemptRecord;
  // Feed straight back into the next attempt's excludedMessageIds.
  messageIds: readonly string[];
};

export function buildAttemptRecord(input: AttemptInput): AttemptLedgerEntry {
  const messages = collectMessageUsage(input.entries, input.excludedMessageIds);
  const usage = summariseTranscript(input.entries, input.excludedMessageIds);

  const record: EvalAttemptRecord = {
    attemptIndex: input.attemptIndex,
    // Secondary: the whole session, exploration included.
    outputTokens: usage.outputTokens,
    // HEADLINE: the cost of emitting the artifact itself.
    authoredOutputTokens: authoredOutputTokensOf(messages, input.authoring.authoringMessageId),
    authoredArtifactBytes: input.authoring.authoredArtifactBytes,
    renderCallCount: input.authoring.renderCallCount,
    usedReference: input.authoring.usedReference,
    referenceKindsUsed: input.authoring.referenceKindsUsed,
    inputTokens: usage.inputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    assistantTurnCount: usage.assistantTurnCount,
    wallClockMs: input.wallClockMs,
    reportedCostUsd: input.reportedCostUsd,
    artifact: input.artifact,
    accepted: input.accepted,
    failureReasons: input.failureReasons,
  };

  return { record, messageIds: usage.messageIds };
}

// An attempt that never authored anything spent zero tokens EMITTING an artifact.
// That reads as 0, not as the session total — it did not pay the format's cost
// because it never produced the format.
function authoredOutputTokensOf(
  messages: readonly MessageUsage[],
  authoringMessageId: string | null,
): number {
  if (authoringMessageId === null) return 0;

  const authoringMessage = messages.find((message) => message.messageId === authoringMessageId);
  return authoringMessage?.outputTokens ?? 0;
}

// ---- One run (authoring turn + every repair) ----------------------------------

export type RunTotals = {
  // THE HEADLINE: every output token spent EMITTING an artifact, repairs
  // included. A format that needed three attempts pays for three artifacts.
  totalAuthoredOutputTokens: number;
  // The authored size of the artifact that finally passed (null if none did).
  passingAuthoredOutputTokens: number | null;
  passingAuthoredArtifactBytes: number | null;
  // Did the model reach for the reference on ANY attempt? The ladder only pays
  // off if it does, so this is a headline finding in its own right.
  usedReference: boolean;
  referenceKindsUsed: readonly string[];
  // SECONDARY: every output token the run spent, agentic exploration included.
  // Real cost, honestly reported — but not the format's cost.
  totalOutputTokens: number;
  totalInputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  // input + cacheRead + cacheCreation, summed over every attempt.
  totalPromptTokens: number;
  totalAssistantTurns: number;
  totalWallClockMs: number;
  totalReportedCostUsd: number;
  attemptCount: number;
  attemptsToPass: number | null;
  passed: boolean;
  // The arm's protocol cost, paid once per run as actually sent. MEASURED (see
  // measureSystemPromptTokens), not estimated from a character count.
  systemPromptTokens: number;
};

export function summariseRun(
  attempts: readonly EvalAttemptRecord[],
  systemPromptTokens: number,
): RunTotals {
  const passingAttempt = attempts.find((attempt) => attempt.accepted);
  const referenceKindsUsed = [
    ...new Set(attempts.flatMap((attempt) => [...attempt.referenceKindsUsed])),
  ];

  return {
    totalAuthoredOutputTokens: sumBy(attempts, (attempt) => attempt.authoredOutputTokens),
    passingAuthoredOutputTokens: passingAttempt?.authoredOutputTokens ?? null,
    passingAuthoredArtifactBytes: passingAttempt?.authoredArtifactBytes ?? null,
    usedReference: attempts.some((attempt) => attempt.usedReference),
    referenceKindsUsed,
    totalOutputTokens: sumBy(attempts, (attempt) => attempt.outputTokens),
    totalInputTokens: sumBy(attempts, (attempt) => attempt.inputTokens),
    totalCacheReadTokens: sumBy(attempts, (attempt) => attempt.cacheReadTokens),
    totalCacheCreationTokens: sumBy(attempts, (attempt) => attempt.cacheCreationTokens),
    totalPromptTokens: sumBy(attempts, promptTokensOf),
    totalAssistantTurns: sumBy(attempts, (attempt) => attempt.assistantTurnCount),
    totalWallClockMs: sumBy(attempts, (attempt) => attempt.wallClockMs),
    totalReportedCostUsd: sumBy(attempts, (attempt) => attempt.reportedCostUsd),
    attemptCount: attempts.length,
    // attemptIndex is 0-based; "attempts to pass" is a count, so a first-attempt
    // pass is 1.
    attemptsToPass: passingAttempt === undefined ? null : passingAttempt.attemptIndex + 1,
    passed: passingAttempt !== undefined,
    systemPromptTokens,
  };
}

export type BuildRunRecordInput = {
  runId: string;
  armId: ArmId;
  scenarioId: string;
  model: EvalModel;
  replicate: number;
  attempts: readonly EvalAttemptRecord[];
  systemPromptTokens: number;
  archivePath: string;
};

export function buildRunRecord(input: BuildRunRecordInput): EvalRunRecord {
  const totals = summariseRun(input.attempts, input.systemPromptTokens);

  return {
    runId: input.runId,
    armId: input.armId,
    scenarioId: input.scenarioId,
    model: input.model,
    replicate: input.replicate,
    attempts: input.attempts,
    passed: totals.passed,
    attemptsToPass: totals.attemptsToPass,
    systemPromptTokens: input.systemPromptTokens,
    archivePath: input.archivePath,
  };
}

// ---- Cost ---------------------------------------------------------------------

// BOTH numbers are true, so both are published.
//
// Cold: nobody's cache is warm on the first call of the day — every cache-read
// token was, at some point, paid for as fresh input. Billing cache reads as
// fresh input is the honest UPPER bound.
// Warm: a real user, mid-session, reads from a cache someone already paid to
// write, at CACHE_READ_PRICE_MULTIPLIER of the fresh price. This is the honest
// LOWER bound, and it is the one the arms' relative ordering is least sensitive
// to — which is the point of showing both.
export type RunCost = {
  coldCacheUsd: number;
  warmCacheUsd: number;
  outputUsd: number;
};

export function costOfRun(model: EvalModel, totals: RunTotals): RunCost {
  const pricing = ModelPricing[model];
  const inputPricePerToken = pricing.inputPerMillionUsd / TOKENS_PER_MILLION;
  const outputPricePerToken = pricing.outputPerMillionUsd / TOKENS_PER_MILLION;

  const outputUsd = totals.totalOutputTokens * outputPricePerToken;
  const freshInputTokens = totals.totalInputTokens + totals.totalCacheCreationTokens;
  const freshInputUsd = freshInputTokens * inputPricePerToken;

  const cacheReadAsFreshUsd = totals.totalCacheReadTokens * inputPricePerToken;
  const cacheReadAtCachePriceUsd = cacheReadAsFreshUsd * CACHE_READ_PRICE_MULTIPLIER;

  return {
    coldCacheUsd: outputUsd + freshInputUsd + cacheReadAsFreshUsd,
    warmCacheUsd: outputUsd + freshInputUsd + cacheReadAtCachePriceUsd,
    outputUsd,
  };
}

// ---- The harness constant ------------------------------------------------------

export type HarnessProbe = {
  surface: AuthoringSurface;
  // The fixed input a Claude Code call pays before the arm says anything:
  // system prompt + tool schemas, as input + cacheRead + cacheCreation.
  promptTokens: number;
  outputTokens: number;
  sessionId: string;
  transcriptPath: string | null;
};

export type HarnessConstant = {
  model: EvalModel;
  probes: readonly HarnessProbe[];
  promptTokensBySurface: Readonly<Record<AuthoringSurface, number>>;
};

// Measured per surface, because the tool schemas differ between them: the canvas
// arm is sent the canvas_render schema, the file arm is sent Write's. If the two
// constants differ, the report says so — an unremarked difference here would be
// a thumb on the scale in the input column.
export async function measureHarnessConstant(options: {
  model: EvalModel;
  daemon: EvalDaemon;
}): Promise<HarnessConstant> {
  const surfaces = Object.values(AuthoringSurface);
  const probes: HarnessProbe[] = [];

  for (const surface of surfaces) {
    probes.push(await probeSurface(surface, options));
  }

  return {
    model: options.model,
    probes,
    promptTokensBySurface: promptTokensBySurfaceOf(probes),
  };
}

async function probeSurface(
  surface: AuthoringSurface,
  options: { model: EvalModel; daemon: EvalDaemon },
): Promise<HarnessProbe> {
  const probe = await runClaudeProbe({
    surface,
    armId: HARNESS_PROBE_ARM_ID,
    model: options.model,
    systemPrompt: HARNESS_PROBE_SYSTEM_PROMPT,
    prompt: HARNESS_PROBE_PROMPT,
    daemon: options.daemon,
    probeDir: harnessProbeDir(),
  });

  const usage = summariseTranscript(probe.entries);
  return {
    surface,
    // The FIRST assistant message's prompt is the constant: it is everything the
    // model read before it had written anything. Later messages in a probe would
    // include the probe's own reply.
    promptTokens: firstMessagePromptTokens(probe.entries),
    outputTokens: usage.outputTokens,
    sessionId: probe.sessionId,
    transcriptPath: probe.transcriptPath,
  };
}

function firstMessagePromptTokens(entries: readonly TraceEntry[]): number {
  const [firstMessage] = collectMessageUsage(entries);
  if (firstMessage === undefined) return 0;
  return promptTokensOf(firstMessage);
}

function promptTokensBySurfaceOf(probes: readonly HarnessProbe[]): Record<AuthoringSurface, number> {
  const bySurface: Record<AuthoringSurface, number> = {
    [AuthoringSurface.CanvasTool]: 0,
    [AuthoringSurface.WrittenFile]: 0,
  };
  for (const probe of probes) {
    bySurface[probe.surface] = probe.promptTokens;
  }
  return bySurface;
}

function harnessProbeDir(): string {
  return `${EvalPaths.runs}/harness-probe`;
}

// The arm's protocol cost, measured the same way: run the same trivial probe
// WITH the arm's system prompt appended, and take the difference. No tokenizer
// is involved and no character-count heuristic is trusted — the number is what
// the API actually billed for sending that prompt on this surface.
export async function measureSystemPromptTokens(options: {
  arm: Arm;
  model: EvalModel;
  daemon: EvalDaemon;
  harnessConstant: HarnessConstant;
}): Promise<number> {
  const probe = await runClaudeProbe({
    surface: options.arm.surface,
    armId: options.arm.id,
    model: options.model,
    systemPrompt: options.arm.systemPrompt,
    prompt: HARNESS_PROBE_PROMPT,
    daemon: options.daemon,
    probeDir: harnessProbeDir(),
  });

  const withArmPrompt = firstMessagePromptTokens(probe.entries);
  const withoutArmPrompt = options.harnessConstant.promptTokensBySurface[options.arm.surface];
  return Math.max(withArmPrompt - withoutArmPrompt, 0);
}

// ---- Reporting input honestly ---------------------------------------------------

export type HarnessSubtractedInput = {
  // What the transcript says, unmodified. This is the number that gets published
  // first, every time.
  rawPromptTokens: number;
  // The constant, times the number of assistant turns that each paid it.
  harnessTokens: number;
  // rawPromptTokens - harnessTokens, floored at zero.
  adjustedPromptTokens: number;
  // The arithmetic, spelled out, so the subtraction is auditable in the report
  // rather than asserted.
  workings: string;
};

// The harness constant is paid on EVERY assistant turn (as cache_creation on the
// first, as cache_read after), so the subtraction scales with turns. It is
// floored at zero rather than allowed to go negative: a negative "adjusted"
// input would be a sign the constant was mismeasured, and silently publishing it
// would hide that.
export function subtractHarnessConstant(input: {
  rawPromptTokens: number;
  assistantTurnCount: number;
  harnessConstantTokens: number;
}): HarnessSubtractedInput {
  const harnessTokens = input.harnessConstantTokens * input.assistantTurnCount;
  const adjustedPromptTokens = Math.max(input.rawPromptTokens - harnessTokens, 0);

  return {
    rawPromptTokens: input.rawPromptTokens,
    harnessTokens,
    adjustedPromptTokens,
    workings:
      `${input.rawPromptTokens} raw prompt tokens - ` +
      `(${input.harnessConstantTokens} harness constant x ${input.assistantTurnCount} assistant turns) = ` +
      `${adjustedPromptTokens}`,
  };
}

// ---- utilities -------------------------------------------------------------------

function sumBy<T>(items: readonly T[], selector: (item: T) => number): number {
  return items.reduce((total, item) => total + selector(item), 0);
}
