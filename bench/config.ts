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
  Plan: "mcp__canvas__canvas_plan",
  Patch: "mcp__canvas__canvas_patch",
  Snapshot: "mcp__canvas__canvas_snapshot",
  // Registered after this harness's original 6 scenarios were built (see
  // bench/live-update.ts, metric (c)): streams file-tail/command-poll/http-poll
  // updates into a slot's state with zero further tool calls.
  Live: "mcp__canvas__canvas_live",
  // The full surface must be enumerable: buildParchmentArmArgs disallows every
  // canvas tool a scenario doesn't declare (bypassPermissions treats
  // --allowedTools as pre-approval, not restriction), so a missing entry here
  // reopens a hole.
  App: "mcp__canvas__canvas_app",
  Library: "mcp__canvas__canvas_library",
  Close: "mcp__canvas__canvas_close",
} as const;

export type CanvasTool = (typeof CanvasTool)[keyof typeof CanvasTool];

// The HTML arm gets exactly enough built-in tools to author and revise one
// file — never Bash, never Read of unrelated files.
export const HTML_ARM_TOOLS = ["Write", "Edit"] as const;

export const DEFAULT_REPETITIONS = 3;
export const DEFAULT_MODEL_FOR_REPS = "haiku" as const;
export const HEADLINE_MODEL = "sonnet" as const;

// The parchment-markup arm's steer. It is APPENDED to the scenario's unchanged
// parchment prompt, so both parchment arms attempt the identical task and the
// only variable is the authoring surface — which is the whole point of the
// comparison. It is deliberately a minimal contract: the thesis under test is
// that a model's HTML/JSX prior carries the rest, so anything the prior already
// supplies is left unsaid. The fidelity ladder is stated first because it, not
// the syntax, is where the tokens actually are.
export const MARKUP_ARM_INSTRUCTION = `Author the UI as a markup document passed to canvas_render's \`markup\` argument (do NOT pass \`spec\`).

The dialect is HTML with the canvas widgets as custom elements.

PREFER THE HIGHEST-FIDELITY ELEMENT AVAILABLE. Never paste content you can reference by path — a reference costs ~15 tokens where the pasted bytes cost thousands:
- <GitDiff file="src/a.ts" base="HEAD~1"/> — a full two-sided diff. Never paste a diff.
- <CodeBlock file="src/a.ts" lines="40-80"/> — a source excerpt. Never paste code you can name.
- <DataTable src="results.csv"/> and <Chart src="results.csv" kind="line" x="run" y="p99"/> — never paste rows you can name.
- <LogStream file="app.log" watch/> — a live log tail.
- <Markdown file="README.md"/>, <Image src="shot.png"/>.
Paste content inline ONLY when it exists nowhere on disk (e.g. you are inventing it).

Otherwise:
- Semantic tags map to components: section/div→Stack, h1-h4→Heading, p→Text/Markdown, ul/ol→Markdown list, table→DataTable, form→Card, hr→Separator, a→Link, button→Button, input/textarea/select→Input/Textarea/Select.
- Widgets are custom elements whose attributes are the component's props: <Metric label="p99" value="412ms" trend="down"/>, <Callout tone="warning">…</Callout>, <Terminal command="…">…</Terminal>, <MermaidEditor>…raw mermaid…</MermaidEditor>, <Steps items="[…]"/>, <Sparkline/>.
- Elements that carry text (CodeBlock, Terminal, MermaidEditor, Callout, Markdown, Heading, Button) take it as their content.
- Seed state with one top-level <state>{…json…}</state>. An attribute value starting with [ or { is parsed as JSON; a "$state.path" string reads state.
- Two-way bind an input with bind="/form/email". Wire a button with intent="retry" (optional intent-params='{…}') or submit="signup".`;
