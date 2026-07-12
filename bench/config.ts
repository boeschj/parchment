// Constants shared across the benchmark harness. Paths are re-exported from
// src/cli/paths.ts (read-only reuse) rather than re-derived here, so the
// harness never drifts from where the daemon and MCP entrypoints actually live.

import { join } from "node:path";
import { DAEMON_ENTRY, MCP_STDIO_ENTRY, REPO_ROOT } from "../src/cli/paths.ts";

export { DAEMON_ENTRY, MCP_STDIO_ENTRY, REPO_ROOT };

export const BENCH_ROOT = join(REPO_ROOT, "bench");
export const BENCH_RUNS_DIR = join(BENCH_ROOT, ".runs");
export const BENCH_RESULTS_DIR = join(BENCH_ROOT, "results");

// The MCP server key the harness registers the canvas tools under in its
// generated --mcp-config file. Claude Code exposes each tool as
// `mcp__<serverKey>__<toolName>`, e.g. mcp__canvas__canvas_render.
export const CANVAS_MCP_SERVER_KEY = "canvas";

// Isolation port for the harness's own daemon — deliberately far from 7800,
// which is where a developer's real, interactively-used parchment daemon
// (with live sessions) is likely already running. Never reuse that daemon:
// the harness gets its own HOME override too (see daemon-harness.ts), so it
// never touches ~/.parchment or a developer's real session state.
export const DEFAULT_BENCH_PORT = 7811;

// Every canvas_* tool a scenario prompt is allowed to call. Scoped down
// per-scenario via --allowedTools so the parchment arm can't reach outside
// the authoring surface the scenario is actually testing.
export const CanvasTool = {
  Render: "mcp__canvas__canvas_render",
  Table: "mcp__canvas__canvas_table",
  Diagram: "mcp__canvas__canvas_diagram",
  Plan: "mcp__canvas__canvas_plan",
  Patch: "mcp__canvas__canvas_patch",
  Snapshot: "mcp__canvas__canvas_snapshot",
} as const;

export type CanvasTool = (typeof CanvasTool)[keyof typeof CanvasTool];

// The HTML arm gets exactly enough built-in tools to author and revise one
// file — never Bash, never Read of unrelated files.
export const HTML_ARM_TOOLS = ["Write", "Edit"] as const;

export const DEFAULT_REPETITIONS = 3;
export const DEFAULT_MODEL_FOR_REPS = "haiku" as const;
export const HEADLINE_MODEL = "sonnet" as const;
