// Replays archived runs through the new browser rubric.
//
// The integrity question this answers: the old harness reported 24/24 archived
// parchment runs as "passing". Its validator only counted component TYPES — it
// never looked at props, data, bindings, or a single painted pixel. So: of those
// 24 declared passes, how many actually rendered the data a user asked for?
//
// Method, per archived run:
//   1. Pull the spec the model authored out of the run's own session transcript
//      (the last canvas_* authoring call the daemon accepted).
//   2. Render it exactly as the product did — prepareSpec, then POST /slots —
//      into a disposable bench daemon. This reproduces what the USER SAW, which
//      is why today's (since hardened) validation issues do not block the render;
//      they are recorded in a separate column instead.
//   3. Judge it in a real browser against the scenario's acceptance spec — the
//      identical rubric the HTML arm faces.
//
// Usage:
//   bun run bench/acceptance/replay.ts                       # the two archived 22-* suites
//   bun run bench/acceptance/replay.ts <results-dir> [more…]
//
// Costs $0: no model is called. Every artifact is reconstructed from transcripts.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createServer } from "node:net";
import { BlockKind, TraceEntryKind, type ContentBlock } from "@boeschj/claude-jsonl";
import { startBenchDaemon } from "../daemon-harness.ts";
import { readTranscriptEntries } from "../metrics/read-transcript.ts";
import { BENCH_RESULTS_DIR } from "../config.ts";
import { acceptArtifact, createAcceptanceBrowser } from "./index.ts";
import { renderSpecToDaemon, RenderOutcome } from "./render-spec.ts";
import { ArtifactKind, type AcceptanceResult } from "./types.ts";

// The two suites whose numbers this repo published as "24/24 first-pass".
const DEFAULT_ARCHIVED_SUITES = [
  join(BENCH_RESULTS_DIR, "2026-07-12T22-28-37-337Z"),
  join(BENCH_RESULTS_DIR, "2026-07-12T22-32-01-708Z"),
];

const CANVAS_TOOL_PREFIX = "mcp__canvas__canvas_";
const FIRST_BENCH_PORT = 7826;

// The library exports the union, not the narrowed member (same derivation as
// bench/metrics/extract-metrics.ts).
type ToolUseBlock = Extract<ContentBlock, { kind: typeof BlockKind.ToolUse }>;

type ArchivedRun = {
  recordPath: string;
  scenarioId: string;
  arm: string;
  model: string;
  repetition: number;
  oldValidatorPassed: boolean;
  title: string;
  spec: Record<string, unknown>;
  toolName: string;
};

type ReplayRow = {
  scenarioId: string;
  model: string;
  repetition: number;
  oldValidatorPassed: boolean;
  renderOutcome: string;
  // What today's (hardened) prepareSpec thinks of the spec the model wrote back
  // then. Reported, never used to decide the rubric verdict.
  todaysValidationIssueCount: number;
  newRubricPassed: boolean;
  reasons: string[];
  screenshotPath: string;
};

async function main(): Promise<void> {
  const suiteDirs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_ARCHIVED_SUITES;
  const runs = suiteDirs.flatMap(loadArchivedRuns);
  if (runs.length === 0) {
    throw new Error(`no archived parchment runs found under: ${suiteDirs.join(", ")}`);
  }

  const startedAt = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = join(BENCH_RESULTS_DIR, `${startedAt}-rubric-replay`);
  mkdirSync(join(outputDir, "screenshots"), { recursive: true });

  console.log(`replaying ${runs.length} archived parchment runs through the browser rubric…\n`);

  const port = await findFreePort(FIRST_BENCH_PORT);
  const daemon = await startBenchDaemon({ port });
  const browser = await createAcceptanceBrowser();
  const rows: ReplayRow[] = [];

  try {
    for (const [index, run] of runs.entries()) {
      const label = `${run.scenarioId}/${run.model}/rep${run.repetition}`;
      const sessionId = `replay-${index}-${run.scenarioId}-${run.model}-${run.repetition}`;
      const screenshotPath = join(outputDir, "screenshots", `${label.replace(/\//g, "-")}.png`);

      const rendered = await renderSpecToDaemon({
        daemonBaseUrl: daemon.baseUrl,
        daemonToken: daemon.token,
        sessionId,
        title: run.title,
        spec: run.spec as never,
        // Render what the user actually saw. Today's validation is stricter than
        // the validation these runs were accepted under; blocking on it now
        // would hide a broken render behind a validation error.
        honourValidationIssues: false,
      });

      const row = await judgeRenderedRun(run, rendered, screenshotPath, sessionId, browser);
      rows.push(row);

      const verdict = row.newRubricPassed ? "PASS" : "FAIL";
      console.log(`  ${verdict}  ${label}`);
      for (const reason of row.reasons) console.log(`          ↳ ${reason}`);
    }
  } finally {
    await browser.close();
    await daemon.stop();
  }

  const reportMarkdown = buildReplayReport(rows, suiteDirs);
  writeFileSync(join(outputDir, "report.md"), reportMarkdown);
  writeFileSync(join(outputDir, "rows.json"), JSON.stringify(rows, null, 2));

  console.log(`\n${summaryLine(rows)}`);
  console.log(`report: ${join(outputDir, "report.md")}`);
}

async function judgeRenderedRun(
  run: ArchivedRun,
  rendered: Awaited<ReturnType<typeof renderSpecToDaemon>>,
  screenshotPath: string,
  _sessionId: string,
  browser: Awaited<ReturnType<typeof createAcceptanceBrowser>>,
): Promise<ReplayRow> {
  const base = {
    scenarioId: run.scenarioId,
    model: run.model,
    repetition: run.repetition,
    oldValidatorPassed: run.oldValidatorPassed,
    renderOutcome: rendered.outcome,
    todaysValidationIssueCount: rendered.validationIssues.length,
    screenshotPath,
  };

  if (!rendered.canvasUrl) {
    return {
      ...base,
      newRubricPassed: false,
      reasons: [`the daemon refused to render this spec: ${rendered.error ?? "unknown error"}`],
    };
  }

  const result: AcceptanceResult = await acceptArtifact({
    scenarioId: run.scenarioId,
    artifact: { kind: ArtifactKind.ParchmentCanvas, canvasUrl: rendered.canvasUrl },
    screenshotPath,
    browser,
  });

  return { ...base, newRubricPassed: result.passed, reasons: result.reasons };
}

// ---- Reading the archive -----------------------------------------------------

function loadArchivedRuns(suiteDir: string): ArchivedRun[] {
  const rawDir = join(suiteDir, "raw");
  if (!existsSync(rawDir)) {
    throw new Error(`archived suite has no raw/ directory: ${suiteDir}`);
  }

  return readdirSync(rawDir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => loadArchivedRun(join(rawDir, entry)))
    .filter((run): run is ArchivedRun => run !== null);
}

function loadArchivedRun(recordPath: string): ArchivedRun | null {
  const record = JSON.parse(readFileSync(recordPath, "utf8")) as {
    scenarioId: string;
    arm: string;
    model: string;
    repetition: number;
    validation: { passed: boolean };
  };
  if (record.arm !== "parchment") return null;

  // Prefer the transcript copy archived NEXT TO the record: the absolute
  // jsonlPath inside the record points into ~/.claude/projects and may have been
  // rotated away.
  const transcriptPath = join(
    recordPath, "..", "jsonl", `${basename(recordPath, ".json")}.jsonl`,
  );
  if (!existsSync(transcriptPath)) {
    throw new Error(`archived run has no transcript beside it: ${transcriptPath}`);
  }

  const authoringCall = lastAcceptedAuthoringCall(transcriptPath);
  if (!authoringCall) {
    throw new Error(`no accepted canvas_* authoring call found in ${transcriptPath}`);
  }

  const input = authoringCall.input as { title?: string; spec?: Record<string, unknown> };
  if (!input.spec) {
    throw new Error(`the accepted ${authoringCall.toolName} call in ${transcriptPath} carries no spec`);
  }

  return {
    recordPath,
    scenarioId: record.scenarioId,
    arm: record.arm,
    model: record.model,
    repetition: record.repetition,
    oldValidatorPassed: record.validation.passed,
    title: input.title ?? record.scenarioId,
    spec: input.spec,
    toolName: authoringCall.toolName,
  };
}

// The artifact a run ended with = the last canvas_* authoring call the daemon
// ACCEPTED (a rejected call never became a slot, so it is not what the user saw).
function lastAcceptedAuthoringCall(transcriptPath: string): ToolUseBlock | null {
  const entries = readTranscriptEntries(transcriptPath);

  const wasErrorByToolUseId = new Map<string, boolean>();
  for (const entry of entries) {
    if (entry.kind !== TraceEntryKind.User) continue;
    for (const toolResult of entry.toolResults) {
      wasErrorByToolUseId.set(toolResult.toolUseId, toolResult.isError);
    }
  }

  let accepted: ToolUseBlock | null = null;
  for (const entry of entries) {
    if (entry.kind !== TraceEntryKind.Assistant) continue;
    for (const block of entry.blocks) {
      if (block.kind !== BlockKind.ToolUse) continue;
      if (!block.toolName.startsWith(CANVAS_TOOL_PREFIX)) continue;
      if (wasErrorByToolUseId.get(block.toolUseId) !== false) continue;
      accepted = block;
    }
  }
  return accepted;
}

// ---- Reporting ---------------------------------------------------------------

function summaryLine(rows: ReplayRow[]): string {
  const declaredPasses = rows.filter((row) => row.oldValidatorPassed);
  const stillPass = declaredPasses.filter((row) => row.newRubricPassed);
  const percent = declaredPasses.length === 0 ? 0 : Math.round((stillPass.length / declaredPasses.length) * 100);
  return (
    `INTEGRITY NUMBER: ${stillPass.length}/${declaredPasses.length} (${percent}%) of the archived runs the old ` +
    `validator passed actually render correctly under the browser rubric.`
  );
}

function buildReplayReport(rows: ReplayRow[], suiteDirs: string[]): string {
  const declaredPasses = rows.filter((row) => row.oldValidatorPassed);
  const stillPass = declaredPasses.filter((row) => row.newRubricPassed);
  const nowFail = declaredPasses.filter((row) => !row.newRubricPassed);

  const scenarioIds = [...new Set(rows.map((row) => row.scenarioId))].sort();
  const perScenario = scenarioIds.map((scenarioId) => {
    const scenarioRows = rows.filter((row) => row.scenarioId === scenarioId);
    const passed = scenarioRows.filter((row) => row.newRubricPassed).length;
    return `| ${scenarioId} | ${scenarioRows.length} | ${passed} | ${scenarioRows.length - passed} |`;
  });

  return [
    "# Archived runs, re-scored under the browser rubric",
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Suites replayed: ${suiteDirs.map((dir) => `\`${basename(dir)}\``).join(", ")}`,
    `- Model calls made: **0** (every artifact is reconstructed from its archived transcript)`,
    "",
    "## The integrity number",
    "",
    `The old validator passed **${declaredPasses.length}/${rows.length}** of these runs. It only counted component`,
    "types — never props, data, bindings, or a painted pixel.",
    "",
    `Re-rendered in a real browser and judged on whether the DATA reached the screen:`,
    "",
    `- **${stillPass.length}/${declaredPasses.length}** still pass.`,
    `- **${nowFail.length}/${declaredPasses.length}** do not.`,
    "",
    "## Per scenario",
    "",
    "| Scenario | Runs | Pass (browser rubric) | Fail |",
    "|---|---|---|---|",
    ...perScenario,
    "",
    "## Every run",
    "",
    "| Scenario | Model | Rep | Old validator | Browser rubric | Today's validation issues | Why it fails now |",
    "|---|---|---|---|---|---|---|",
    ...rows.map(
      (row) =>
        `| ${row.scenarioId} | ${row.model} | ${row.repetition} | ${row.oldValidatorPassed ? "pass" : "fail"} | ` +
        `${row.newRubricPassed ? "**pass**" : "**FAIL**"} | ${row.todaysValidationIssueCount} | ` +
        `${row.reasons.map((reason) => reason.replace(/\|/g, "\\|")).join("<br>") || "—"} |`,
    ),
    "",
    "The **today's validation issues** column is informational: it is what the CURRENT (since hardened) spec",
    "validation says about the spec the model wrote back then. It plays no part in the rubric verdict — the",
    "browser does. A run can have zero validation issues and still paint an empty chart, which is the entire",
    "reason this rubric exists.",
    "",
  ].join("\n");
}

async function findFreePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 40; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`no free port found in [${startPort}, ${startPort + 40})`);
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

await main();
