// Orchestrates one benchmark repetition end to end: spawn `claude -p` under
// the right tool restrictions, locate the transcript it wrote, extract token/
// turn metrics from it, and check the resulting artifact against the
// scenario's requirements. Each step is its own module (claude-cli,
// session-locator, extract-metrics, validators/*) — this file only composes
// them in the right order.

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RenderAttemptPredicate } from "./metrics/extract-metrics.ts";
import { extractTranscriptMetrics } from "./metrics/extract-metrics.ts";
import { readTranscriptEntries } from "./metrics/read-transcript.ts";
import { runClaudeHeadless } from "./claude-cli.ts";
import { MARKUP_ARM_INSTRUCTION } from "./config.ts";
import { writeCanvasMcpConfig } from "./mcp-config.ts";
import { locateSessionJsonl } from "./session-locator.ts";
import { fetchSessionSlots, validateParchmentSlots } from "./validators/parchment-validator.ts";
import { validateHtmlFile } from "./validators/html-validator.ts";
import type { ScenarioDefinition } from "./scenarios/types.ts";
import { Arm, isParchmentArm, type Model, type RunRecord, type ValidationResult } from "./types.ts";
import type { BenchDaemon } from "./daemon-harness.ts";

export type RunOneRepOptions = {
  scenario: ScenarioDefinition;
  arm: Arm;
  model: Model;
  repetition: number;
  runsRootDir: string;
  // Required for the parchment arm; unused for the HTML arm.
  daemon?: BenchDaemon;
  // Skills-delta appendix only: appended to the default system prompt via
  // --append-system-prompt (see bench/skills-delta.ts).
  appendSystemPrompt?: string;
};

const HTML_OUTPUT_FILENAME_PATTERN = /\.\/(\S+\.html)/;

export async function runOneRep(options: RunOneRepOptions): Promise<RunRecord> {
  const sessionId = randomUUID();
  const runDir = join(options.runsRootDir, options.scenario.id, options.arm, `rep-${options.repetition}`);
  mkdirSync(runDir, { recursive: true });

  const invocation = await runClaudeHeadless(await buildClaudeInvocationInput(options, sessionId, runDir));

  const jsonlPath = locateSessionJsonl(sessionId);
  const entries = readTranscriptEntries(jsonlPath);
  const transcript = extractTranscriptMetrics(entries, renderAttemptPredicateFor(options, runDir));
  const validation = await validateRun(options, sessionId, runDir);

  return {
    scenarioId: options.scenario.id,
    arm: options.arm,
    model: options.model,
    repetition: options.repetition,
    sessionId,
    jsonlPath,
    claudeResult: invocation.result,
    transcript,
    validation,
    claudeVersion: firstClaudeVersion(entries),
    recordedAt: new Date().toISOString(),
  };
}

// Both parchment arms run the scenario's UNCHANGED parchment prompt; the markup
// arm just has the dialect steer appended, so the task is identical and only the
// authoring surface differs.
function promptFor(scenario: ScenarioDefinition, arm: Arm): string {
  if (arm === Arm.Html) return scenario.htmlPrompt;
  if (arm === Arm.ParchmentMarkup) {
    return `${scenario.parchmentPrompt}\n\n${MARKUP_ARM_INSTRUCTION}`;
  }
  return scenario.parchmentPrompt;
}

async function buildClaudeInvocationInput(
  options: RunOneRepOptions,
  sessionId: string,
  runDir: string,
): Promise<Parameters<typeof runClaudeHeadless>[0]> {
  const prompt = promptFor(options.scenario, options.arm);
  const shared = {
    prompt,
    model: options.model,
    sessionId,
    cwd: runDir,
    arm: options.arm,
    ...(options.appendSystemPrompt ? { appendSystemPrompt: options.appendSystemPrompt } : {}),
  };

  if (options.arm === Arm.Html) return shared;

  if (!options.daemon) {
    throw new Error(`scenario "${options.scenario.id}": parchment arm requires a running bench daemon`);
  }
  const mcpConfigPath = writeCanvasMcpConfig({
    runDir,
    sessionId,
    benchDaemonHomeDir: options.daemon.homeDir,
  });
  return { ...shared, mcpConfigPath, allowedCanvasTools: [options.scenario.parchmentTool] };
}

function renderAttemptPredicateFor(options: RunOneRepOptions, runDir: string): RenderAttemptPredicate {
  if (isParchmentArm(options.arm)) {
    const toolName = options.scenario.parchmentTool;
    return (toolUse) => toolUse.toolName === toolName;
  }

  const outputPath = htmlOutputPath(options.scenario, runDir);
  return (toolUse) => {
    const isFileTool = toolUse.toolName === "Write" || toolUse.toolName === "Edit";
    if (!isFileTool) return false;
    const filePath = toolUse.input["file_path"];
    if (typeof filePath !== "string") return false;
    // The model may pass either an absolute path or one relative to its cwd
    // (runDir) — e.g. "./dashboard.html" is common even though the prompt's
    // cwd makes it equivalent to the absolute path. resolve() normalizes
    // both to the same absolute form before comparing.
    return resolve(runDir, filePath) === outputPath;
  };
}

async function validateRun(
  options: RunOneRepOptions,
  sessionId: string,
  runDir: string,
): Promise<ValidationResult> {
  if (options.arm === Arm.Html) {
    return validateHtmlFile(htmlOutputPath(options.scenario, runDir), options.scenario.htmlRequirements);
  }

  if (!options.daemon) {
    throw new Error(`scenario "${options.scenario.id}": parchment arm requires a running bench daemon`);
  }
  const slots = await fetchSessionSlots({
    daemonBaseUrl: options.daemon.baseUrl,
    daemonToken: options.daemon.token,
    sessionId,
  });
  return validateParchmentSlots(slots, options.scenario.parchmentRequirement);
}

// Scenario prompts name their output file as "./something.html"; resolving
// against runDir keeps this in one place instead of repeating the filename
// convention in every scenario file.
function htmlOutputPath(scenario: ScenarioDefinition, runDir: string): string {
  const match = scenario.htmlPrompt.match(HTML_OUTPUT_FILENAME_PATTERN);
  if (!match?.[1]) {
    throw new Error(`scenario "${scenario.id}": htmlPrompt does not name a "./*.html" output file`);
  }
  return join(runDir, match[1]);
}

function firstClaudeVersion(entries: ReturnType<typeof readTranscriptEntries>): string {
  for (const entry of entries) {
    if (entry.envelope.version) return entry.envelope.version;
  }
  return "unknown";
}
