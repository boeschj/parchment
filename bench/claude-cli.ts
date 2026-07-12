// Spawns one headless `claude -p` run with an arm-appropriate, locked-down
// tool surface, and parses the CLI's own JSON result summary.
//
// Every run passes --setting-sources "" so a developer's personal CLAUDE.md,
// memory files, and project settings never leak into the measured token
// counts — a real parchment user starts from a clean install, and the
// published numbers should reflect that, not this machine's history. (Verified
// empirically: with the operator's personal CLAUDE.md loaded, a one-word
// "pong" reply cost ~10.2k cache-creation tokens; with --setting-sources ""
// it dropped to ~7k — the remaining ~7k is the fixed system-prompt/tool-schema
// overhead every Claude Code call pays regardless of user config.)
//
// --bare was considered and rejected: it forces ANTHROPIC_API_KEY / apiKeyHelper
// auth, which fails outright for an OAuth-subscription login (confirmed:
// "Not logged in · Please run /login"). --setting-sources "" gets the same
// noise reduction without breaking auth.

import { Arm, type Model } from "./types.ts";
import type { ClaudeRunResult } from "./types.ts";
import { HTML_ARM_TOOLS } from "./config.ts";
import type { CanvasTool } from "./config.ts";

export type RunClaudeHeadlessOptions = {
  prompt: string;
  model: Model;
  sessionId: string;
  cwd: string;
  arm: Arm;
  // Parchment arm only: which canvas_* tools this scenario may call, and the
  // --mcp-config file wiring the canvas MCP server into this run.
  allowedCanvasTools?: readonly CanvasTool[];
  mcpConfigPath?: string;
  // Metric (c), HTML arm only: continue a prior call's session instead of
  // starting a fresh one, so a later "patch the file" turn has the earlier
  // turn's Write already in its own context (no Read tool is granted, so
  // this is the only way an Edit call can know the file's current content).
  // When set, this replaces --session-id with --resume <resumeSessionId>;
  // the transcript file is unchanged (Claude Code keeps writing to the same
  // <sessionId>.jsonl), so session-locator.ts needs no changes.
  resumeSessionId?: string;
  // Skills-delta appendix only: the canvas-tools + canvas-spec SKILL.md cores,
  // appended to the default system prompt via --append-system-prompt to
  // measure what the plugin's skills add over bare tool descriptions.
  appendSystemPrompt?: string;
};

export type ClaudeInvocation = {
  result: ClaudeRunResult;
  stdout: string;
  stderr: string;
  wallClockMs: number;
};

export async function runClaudeHeadless(options: RunClaudeHeadlessOptions): Promise<ClaudeInvocation> {
  const args = buildClaudeArgs(options);
  const startedAt = Date.now();

  const claudeProcess = Bun.spawn({
    cmd: ["claude", ...args],
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(claudeProcess.stdout).text(),
    new Response(claudeProcess.stderr).text(),
  ]);
  await claudeProcess.exited;

  const wallClockMs = Date.now() - startedAt;
  return { result: parseResultJson(stdout), stdout, stderr, wallClockMs };
}

function buildClaudeArgs(options: RunClaudeHeadlessOptions): string[] {
  const sharedArgs = [
    "-p",
    options.prompt,
    "--model",
    options.model,
    ...buildSessionArgs(options),
    "--output-format",
    "json",
    "--setting-sources",
    "",
    "--permission-mode",
    "bypassPermissions",
    "--strict-mcp-config",
    ...buildAppendSystemPromptArgs(options),
  ];

  return options.arm === Arm.Parchment
    ? [...sharedArgs, ...buildParchmentArmArgs(options)]
    : [...sharedArgs, ...buildHtmlArmArgs()];
}

function buildSessionArgs(options: RunClaudeHeadlessOptions): string[] {
  return options.resumeSessionId
    ? ["--resume", options.resumeSessionId]
    : ["--session-id", options.sessionId];
}

function buildAppendSystemPromptArgs(options: RunClaudeHeadlessOptions): string[] {
  return options.appendSystemPrompt ? ["--append-system-prompt", options.appendSystemPrompt] : [];
}

function buildParchmentArmArgs(options: RunClaudeHeadlessOptions): string[] {
  if (!options.mcpConfigPath) {
    throw new Error("parchment arm requires mcpConfigPath");
  }
  if (!options.allowedCanvasTools || options.allowedCanvasTools.length === 0) {
    throw new Error("parchment arm requires at least one allowedCanvasTools entry");
  }
  return [
    "--mcp-config",
    options.mcpConfigPath,
    "--tools",
    "",
    "--allowedTools",
    options.allowedCanvasTools.join(","),
  ];
}

function buildHtmlArmArgs(): string[] {
  return ["--tools", HTML_ARM_TOOLS.join(",")];
}

function parseResultJson(stdout: string): ClaudeRunResult {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    throw new Error("claude -p produced no stdout — check stderr for a launch failure");
  }
  const parsed = JSON.parse(trimmed) as {
    is_error: boolean;
    num_turns: number;
    total_cost_usd: number;
    duration_ms: number;
    session_id: string;
    result: unknown;
  };
  return {
    isError: parsed.is_error,
    numTurns: parsed.num_turns,
    totalCostUsd: parsed.total_cost_usd,
    durationMs: parsed.duration_ms,
    sessionId: parsed.session_id,
    resultText: typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result),
  };
}
