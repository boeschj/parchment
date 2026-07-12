#!/usr/bin/env bun
// Metric (c): tokens-per-live-update.
//
//   bun run bench/live-update.ts
//
// Once a dashboard exists, what does it cost to reflect 10 new data points?
//   - parchment: ONE claude -p turn calls canvas_render (seeding chart state)
//     then canvas_live (registering a file-tail source against that state
//     path) — after that turn, the daemon applies every update with ZERO
//     further tool calls. This script proves the zero by appending real
//     lines to the tailed file directly and polling the daemon's own HTTP
//     state endpoint, never spawning another `claude -p`.
//   - html: one claude -p turn creates the file, then MEASURED_UPDATE_COUNT
//     more turns (--resume, same session) each patch it in place — a real,
//     billable call per update, priced from that call's own reported usage.
//
// See bench/scenarios/live-update-plan.ts for the shared interface
// (LIVE_UPDATE_STEPS, buildHtmlUpdatePrompt, isCanvasLiveToolRegistered) this
// script drives.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { BENCH_RESULTS_DIR, BENCH_RUNS_DIR, CanvasTool, DEFAULT_BENCH_PORT } from "./config.ts";
import { runClaudeHeadless } from "./claude-cli.ts";
import type { ClaudeInvocation } from "./claude-cli.ts";
import { startBenchDaemon } from "./daemon-harness.ts";
import type { BenchDaemon } from "./daemon-harness.ts";
import { writeCanvasMcpConfig } from "./mcp-config.ts";
import { liveLogDashboardScenario } from "./scenarios/live-log-dashboard.ts";
import { buildHtmlUpdatePrompt, isCanvasLiveToolRegistered, LIVE_UPDATE_STEPS } from "./scenarios/live-update-plan.ts";
import type { LiveUpdateStep } from "./scenarios/live-update-plan.ts";
import { computeStats } from "./stats.ts";
import { Arm, Model } from "./types.ts";
import { fetchSessionSlots } from "./validators/parchment-validator.ts";
import type { Slot } from "../src/shared/types.ts";

const MEASURED_UPDATE_COUNT = 10;
// file-tail polls every 1000ms (src/daemon/live/file-tail.ts); wait past that
// on every append before reading state back, with margin for scheduler jitter.
const LIVE_SOURCE_POLL_WAIT_MS = 1200;
const HTML_OUTPUT_FILENAME = "log-dashboard.html";
const SERIES_STATE_KEY = "series";
const SERIES_STATE_POINTER = `/${SERIES_STATE_KEY}`;
const LIVE_SOURCE_ID = "error-rate";
const SEED_SERIES_POINTS = [
  { t: 1, value: 2 },
  { t: 2, value: 3 },
  { t: 3, value: 1 },
  { t: 4, value: 4 },
  { t: 5, value: 2 },
];

async function main(): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultsDir = join(BENCH_RESULTS_DIR, `${timestamp}-live-update`);
  const runsRootDir = join(BENCH_RUNS_DIR, `${timestamp}-live-update`);
  mkdirSync(resultsDir, { recursive: true });

  process.stderr.write(
    `[live-update] canvas_live registered on this build: ${isCanvasLiveToolRegistered()}\n`,
  );

  process.stderr.write(`[live-update] html arm: 1 create call + ${MEASURED_UPDATE_COUNT} update calls...\n`);
  const htmlResult = await runHtmlArm(join(runsRootDir, "html"));
  saveJson(resultsDir, "html-result.json", htmlResult);
  process.stderr.write(`[live-update] html arm done\n`);

  const daemon = await startBenchDaemon({ port: DEFAULT_BENCH_PORT });
  try {
    process.stderr.write(`[live-update] parchment arm: 1 compose+stream call, then 0 further claude -p calls...\n`);
    const parchmentResult = await runParchmentArm(daemon, join(runsRootDir, "parchment"));
    saveJson(resultsDir, "parchment-result.json", parchmentResult);
    process.stderr.write(`[live-update] parchment arm done\n`);

    const reportPath = join(resultsDir, "report.md");
    writeFileSync(reportPath, buildLiveUpdateReportMarkdown(htmlResult, parchmentResult));
    process.stderr.write(`[live-update] wrote ${reportPath}\n`);
  } finally {
    await daemon.stop();
  }
}

// ---- HTML arm ----

type HtmlCallRecord = {
  index: number; // 0 = initial create; 1..N = update
  costUsd: number;
  promptCompletionTokens: number;
  containsThisStepsLogLine: boolean | null; // null for the create call (no step to check yet)
};

type HtmlLiveUpdateResult = {
  sessionId: string;
  calls: HtmlCallRecord[];
  // Which of the N appended log lines survive in the FINAL file. Models
  // sometimes rewrite the whole file on a later update and silently drop
  // earlier rows — retention < N is real data loss, not a check artifact.
  retainedStepIndexes: number[];
  finalFileContainsAllLogLines: boolean;
};

async function runHtmlArm(runDir: string): Promise<HtmlLiveUpdateResult> {
  mkdirSync(runDir, { recursive: true });
  const sessionId = randomUUID();
  const filePath = join(runDir, HTML_OUTPUT_FILENAME);
  const steps = LIVE_UPDATE_STEPS.slice(0, MEASURED_UPDATE_COUNT);

  const createInvocation = await runClaudeHeadless({
    prompt: liveLogDashboardScenario.htmlPrompt,
    model: Model.Haiku,
    sessionId,
    cwd: runDir,
    arm: Arm.Html,
  });
  const calls: HtmlCallRecord[] = [callRecordFrom(0, createInvocation, null)];

  for (const step of steps) {
    const invocation = await runClaudeHeadless({
      prompt: buildHtmlUpdatePrompt(step, `./${HTML_OUTPUT_FILENAME}`),
      model: Model.Haiku,
      sessionId,
      cwd: runDir,
      arm: Arm.Html,
      resumeSessionId: sessionId,
    });
    calls.push(callRecordFrom(step.index, invocation, fileContainsLogLine(filePath, step)));
  }

  const retainedStepIndexes = steps.filter((step) => fileContainsLogLine(filePath, step)).map((step) => step.index);
  return {
    sessionId,
    calls,
    retainedStepIndexes,
    finalFileContainsAllLogLines: retainedStepIndexes.length === steps.length,
  };
}

function callRecordFrom(
  index: number,
  invocation: ClaudeInvocation,
  containsThisStepsLogLine: boolean | null,
): HtmlCallRecord {
  return {
    index,
    costUsd: invocation.result.totalCostUsd,
    promptCompletionTokens: promptCompletionTokensFromStdout(invocation.stdout),
    containsThisStepsLogLine,
  };
}

// Presence is checked with the log line's distinctive fragment, NOT the full
// "[INFO] heartbeat N — ..." string: models legitimately render the level as
// its own styled table cell (<td><span>INFO</span></td><td>heartbeat N — ...)
// so requiring the exact prefix flags correct output as missing. Verified in
// this harness's first pilot run: every per-step check reported NO on the
// full string while the fragment was actually present for 6 of 10 steps.
function fileContainsLogLine(filePath: string, step: LiveUpdateStep): boolean {
  const distinctiveFragment = step.logLine.replace(/^\[INFO\] /, "");
  return readFileSync(filePath, "utf8").includes(distinctiveFragment);
}

// Mirrors metrics/extract-metrics.ts's promptTokensOf: Anthropic's
// input_tokens alone is only the cache-miss delta, so the real per-call cost
// includes cache_read + cache_creation tokens too. Read directly off this
// call's own `claude -p --output-format json` result rather than the shared
// transcript-metrics path, because a --resume call appends to the SAME
// session JSONL as every prior call in this loop — re-deriving "this call's"
// tokens from the cumulative transcript would double-count earlier calls.
function promptCompletionTokensFromStdout(stdout: string): number {
  const parsed = JSON.parse(stdout.trim()) as {
    usage?: {
      input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
      output_tokens?: number;
    };
  };
  const usage = parsed.usage;
  if (!usage) return 0;
  const promptTokens = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  const completionTokens = usage.output_tokens ?? 0;
  return promptTokens + completionTokens;
}

// ---- Parchment arm ----

type LiveStateObservation = {
  afterAppendCount: number;
  elapsedMsSinceFirstAppend: number;
  seriesLength: number;
};

type ParchmentLiveUpdateResult = {
  sessionId: string;
  composeCostUsd: number;
  composePromptCompletionTokens: number;
  slotId: string;
  baselineSeriesLength: number;
  observations: LiveStateObservation[];
  finalSeriesLength: number;
  grewByExpectedAmount: boolean;
  claudeCallsDuringUpdates: number; // always 0 — the point of this metric
};

async function runParchmentArm(daemon: BenchDaemon, runDir: string): Promise<ParchmentLiveUpdateResult> {
  mkdirSync(runDir, { recursive: true });
  const logFilePath = join(runDir, "live-source.jsonl");
  writeFileSync(logFilePath, ""); // file-tail starts at current EOF — empty file tails from byte 0.

  const sessionId = randomUUID();
  const mcpConfigPath = writeCanvasMcpConfig({ runDir, sessionId, benchDaemonHomeDir: daemon.homeDir });

  const invocation = await runClaudeHeadless({
    prompt: buildComposeAndStreamPrompt(logFilePath),
    model: Model.Haiku,
    sessionId,
    cwd: runDir,
    arm: Arm.Parchment,
    allowedCanvasTools: [CanvasTool.Render, CanvasTool.Live],
    mcpConfigPath,
  });

  const slotsAfterCompose = await fetchSlots(daemon, sessionId);
  const slot = findSlotWithSeries(slotsAfterCompose);
  const baselineSeriesLength = seriesLengthOf(slot);

  const observations: LiveStateObservation[] = [];
  const firstAppendAt = Date.now();
  for (let position = 1; position <= MEASURED_UPDATE_COUNT; position += 1) {
    appendFileSync(logFilePath, `${JSON.stringify({ t: baselineSeriesLength + position, value: position })}\n`);
    await Bun.sleep(LIVE_SOURCE_POLL_WAIT_MS);
    const slots = await fetchSlots(daemon, sessionId);
    observations.push({
      afterAppendCount: position,
      elapsedMsSinceFirstAppend: Date.now() - firstAppendAt,
      seriesLength: seriesLengthOf(findSlotWithSeries(slots)),
    });
  }

  const finalSeriesLength = observations[observations.length - 1]?.seriesLength ?? baselineSeriesLength;
  return {
    sessionId,
    composeCostUsd: invocation.result.totalCostUsd,
    composePromptCompletionTokens: promptCompletionTokensFromStdout(invocation.stdout),
    slotId: slot.id,
    baselineSeriesLength,
    observations,
    finalSeriesLength,
    grewByExpectedAmount: finalSeriesLength === baselineSeriesLength + MEASURED_UPDATE_COUNT,
    claudeCallsDuringUpdates: 0,
  };
}

function buildComposeAndStreamPrompt(logFilePath: string): string {
  return [
    "Use canvas_render to build a live log monitoring dashboard, all in ONE call:",
    `- Seed the spec's initial state at "${SERIES_STATE_KEY}" with these 5 points: ${JSON.stringify(SEED_SERIES_POINTS)}.`,
    `- A line Chart bound to {"$state": "${SERIES_STATE_POINTER}"} with x: "t", y: "value".`,
    "- A DataTable of these 3 static log lines: [ERROR] db timeout, [WARN] slow query 800ms, [INFO] cache cleared.",
    "",
    "Then, in the SAME turn, call canvas_live once on that slot to register exactly one",
    `file-tail source: id "${LIVE_SOURCE_ID}", statePath "${SERIES_STATE_POINTER}", kind "file-tail",`,
    `path "${logFilePath}", parser "jsonl", mode "append". Call canvas_live exactly once.`,
  ].join("\n");
}

async function fetchSlots(daemon: BenchDaemon, sessionId: string): Promise<Slot[]> {
  return fetchSessionSlots({ daemonBaseUrl: daemon.baseUrl, daemonToken: daemon.token, sessionId });
}

function findSlotWithSeries(slots: Slot[]): Slot {
  const slot = slots.find((candidate) => Array.isArray(candidate.state[SERIES_STATE_KEY]));
  if (!slot) {
    throw new Error('no slot with a "series" state array found — canvas_render did not seed it as instructed');
  }
  return slot;
}

function seriesLengthOf(slot: Slot): number {
  const series = slot.state[SERIES_STATE_KEY];
  return Array.isArray(series) ? series.length : 0;
}

// ---- Report + persistence ----

function saveJson(resultsDir: string, filename: string, value: unknown): void {
  writeFileSync(join(resultsDir, filename), JSON.stringify(value, null, 2));
}

function buildLiveUpdateReportMarkdown(html: HtmlLiveUpdateResult, parchment: ParchmentLiveUpdateResult): string {
  const updateCalls = html.calls.filter((call) => call.index > 0);
  const updateCostStats = computeStats(updateCalls.map((call) => call.costUsd));
  const updateTokenStats = computeStats(updateCalls.map((call) => call.promptCompletionTokens));
  const htmlTotalCost = html.calls.reduce((total, call) => total + call.costUsd, 0);

  return [
    "# Metric (c): tokens-per-live-update",
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Updates measured per arm: ${MEASURED_UPDATE_COUNT}`,
    "",
    "## HTML arm — one billable `claude -p` call per update",
    "",
    `- Create call: $${html.calls[0]?.costUsd.toFixed(4)} (${html.calls[0]?.promptCompletionTokens} tokens)`,
    `- ${MEASURED_UPDATE_COUNT} update calls (--resume, same session): mean $${updateCostStats.mean.toFixed(4)}, ` +
      `median $${updateCostStats.median.toFixed(4)}, min $${updateCostStats.min.toFixed(4)}, max $${updateCostStats.max.toFixed(4)}`,
    `- Mean tokens per update: ${updateTokenStats.mean.toFixed(0)} (min ${updateTokenStats.min.toFixed(0)}, max ${updateTokenStats.max.toFixed(0)})`,
    `- Total cost for setup + ${MEASURED_UPDATE_COUNT} updates: $${htmlTotalCost.toFixed(4)}`,
    `- Log lines still in the FINAL file: ${html.retainedStepIndexes.length}/${MEASURED_UPDATE_COUNT}` +
      `${html.finalFileContainsAllLogLines ? "" : ` (absent: ${missingStepIndexes(html).join(", ")})`}. ` +
      `NOTE: the dashboard's original spec shows only the 3 MOST RECENT log lines, so a final count of 3 ` +
      `with all per-step checks passing means every update landed and the table rolled forward correctly — ` +
      `it is NOT data loss. Treat the per-step column as the correctness signal.`,
    "",
    "| Call | Cost $ | Tokens | This step's log line present |",
    "|---|---|---|---|",
    ...html.calls.map(
      (call) =>
        `| ${call.index === 0 ? "create" : `update ${call.index}`} | $${call.costUsd.toFixed(4)} | ${call.promptCompletionTokens} | ${formatMaybeBool(call.containsThisStepsLogLine)} |`,
    ),
    "",
    "## Parchment arm — one call composes and streams, then zero further calls",
    "",
    `- Compose+stream call: $${parchment.composeCostUsd.toFixed(4)} (${parchment.composePromptCompletionTokens} tokens) — this is the ONLY cost the user ever pays for this dashboard's updates.`,
    `- Baseline series length after compose: ${parchment.baselineSeriesLength}`,
    `- \`claude -p\` calls made while driving ${MEASURED_UPDATE_COUNT} updates: ${parchment.claudeCallsDuringUpdates} (updates were driven by appending lines directly to the tailed file — no LLM involved)`,
    `- Final series length: ${parchment.finalSeriesLength} (expected ${parchment.baselineSeriesLength + MEASURED_UPDATE_COUNT}: ${parchment.grewByExpectedAmount ? "matches" : "MISMATCH"})`,
    "",
    "Observed state growth after each direct file append (zero claude -p calls in this loop):",
    "",
    "| Append # | Elapsed ms since first append | Series length observed |",
    "|---|---|---|",
    ...parchment.observations.map(
      (observation) => `| ${observation.afterAppendCount} | ${observation.elapsedMsSinceFirstAppend} | ${observation.seriesLength} |`,
    ),
    "",
    "## Headline comparison",
    "",
    `- HTML: ~${updateTokenStats.mean.toFixed(0)} tokens and ~$${updateCostStats.mean.toFixed(4)} per update (${MEASURED_UPDATE_COUNT} real \`claude -p\` calls).`,
    `- Parchment: 0 tokens and $0 per update (${parchment.claudeCallsDuringUpdates} \`claude -p\` calls for ${MEASURED_UPDATE_COUNT} updates) — cost is paid once, at compose time.`,
  ].join("\n");
}

function formatMaybeBool(value: boolean | null): string {
  if (value === null) return "n/a (create call)";
  return value ? "yes" : "NO";
}

function missingStepIndexes(html: HtmlLiveUpdateResult): number[] {
  const retained = new Set(html.retainedStepIndexes);
  return LIVE_UPDATE_STEPS.slice(0, MEASURED_UPDATE_COUNT)
    .map((step) => step.index)
    .filter((index) => !retained.has(index));
}

await main();
