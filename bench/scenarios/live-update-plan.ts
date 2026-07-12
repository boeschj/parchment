// The interface for metric (c), tokens-per-live-update: once a dashboard
// exists, what does it cost to reflect 20 new data points?
//
// The two arms are structurally different here, not just quantitatively:
//   - parchment (once W1's live data engine lands): an agent registers ONE
//     data source (file-tail / command-poll / http-poll) against the slot's
//     state path; the daemon applies every subsequent update as a patch, with
//     zero further LLM calls. Cost per update is 0 tokens by construction.
//   - HTML baseline: there is no daemon and no live engine. The only way the
//     artifact reflects new data is another full `claude -p` turn asking it
//     to regenerate or patch the file. Cost per update is a real, measurable
//     token count.
//
// W1 (the live data engine + canvas_live MCP tool) is being built in a
// parallel worktree tonight and had not landed as of this harness build.
// Rather than fake a measurement, this module exposes the plug point:
// isCanvasLiveToolRegistered() detects the tool the moment it exists, and
// measureParchmentUpdateCost() reports the 0-token design assumption until
// then. The HTML side is fully measurable today, but running the real
// 20-update sweep costs 20 `claude -p` calls per arm/model — outside
// tonight's approved smoke-spend cap — so it is wired for the moderate suite
// (`bun run bench/cli.ts live-update ...`) rather than run automatically.

import { readFileSync } from "node:fs";
import { MCP_STDIO_ENTRY } from "../config.ts";
import type { Model } from "../types.ts";

export type LiveUpdateStep = {
  index: number;
  logLine: string;
};

const LIVE_UPDATE_COUNT = 20;

export const LIVE_UPDATE_STEPS: LiveUpdateStep[] = Array.from({ length: LIVE_UPDATE_COUNT }, (_, position) => ({
  index: position + 1,
  logLine: `[INFO] heartbeat ${position + 1} — synthetic tick for tokens-per-update measurement`,
}));

export type UpdateCostResult = {
  measured: boolean;
  promptCompletionTokens: number | null;
  costUsd: number | null;
  note: string;
};

// Static capability probe: does the canvas MCP server currently register a
// canvas_live tool? Reading the source rather than spawning a real MCP
// session keeps this check at zero cost (no process, no tokens) and makes it
// flip to true automatically the moment W1 lands — no harness change needed.
export function isCanvasLiveToolRegistered(): boolean {
  const mcpStdioSource = readFileSync(MCP_STDIO_ENTRY, "utf8");
  return /registerTool\(\s*["']canvas_live["']/.test(mcpStdioSource);
}

export function measureParchmentUpdateCost(): UpdateCostResult {
  if (!isCanvasLiveToolRegistered()) {
    return {
      measured: false,
      promptCompletionTokens: 0,
      costUsd: 0,
      note: "canvas_live is not yet registered (pending W1's live data engine) — reporting the 0-token design assumption, not a measurement.",
    };
  }
  return {
    measured: false,
    promptCompletionTokens: 0,
    costUsd: 0,
    note: "canvas_live is now registered, but this harness version does not yet drive a live-update sweep against it — wire a real measurement before publishing this number.",
  };
}

// Builds the prompt for one HTML-arm update turn: hand the model the new log
// line and ask it to patch the existing file in place. Each call to this,
// run through claude-cli.ts's runClaudeHeadless with arm: Html, is one real,
// billable `claude -p` invocation — the caller (a future `bench live-update`
// command) is responsible for running LIVE_UPDATE_STEPS.length of these
// sequentially and summing their token/cost columns.
export function buildHtmlUpdatePrompt(step: LiveUpdateStep, filePath: string): string {
  return `Update ${filePath} in place to reflect one new log line: "${step.logLine}". ` +
    `Append it to the log table and update the error-rate chart with one new data point. ` +
    `Keep everything else in the file unchanged.`;
}

export type HtmlLiveUpdatePlan = {
  model: Model;
  filePath: string;
  steps: LiveUpdateStep[];
};

export function buildHtmlLiveUpdatePlan(model: Model, filePath: string): HtmlLiveUpdatePlan {
  return { model, filePath, steps: LIVE_UPDATE_STEPS };
}
