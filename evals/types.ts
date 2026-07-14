// The eval's vocabulary. Every arm, every scenario, and every measurement in
// this directory is expressed in these types.
//
// THE OBJECTIVE FUNCTION: total tokens to a first BROWSER-VERIFIED correct
// render. Not "tokens to a spec our validator liked" — the old harness measured
// that and optimized the product against its own opinion. Acceptance here is
// decided by bench/acceptance's DOM rubric, which never imports parchment code.
//
// THE PRIMARY AXIS: output tokens. Output bills ~5x input and ~50x cached
// input, so a format that saves schema tokens while spending output tokens is
// losing. Every table leads with output.

import type { AcceptanceSpec } from "../bench/acceptance/types.ts";

// ---- Models -----------------------------------------------------------------

export const EvalModel = {
  Haiku: "haiku",
  Sonnet: "sonnet",
  Opus: "opus",
} as const;

export type EvalModel = (typeof EvalModel)[keyof typeof EvalModel];

// ---- The fidelity ladder ----------------------------------------------------

// The rung an arm is allowed to stand on. This is the eval's headline variable.
//
// Low: the model must EMIT the content. To show a diff it pastes the file's
//   before and after text; to show a CSV it pastes every row. Every competing
//   format (raw HTML, raw JSX, terse JSON, OpenUI) is structurally stuck here —
//   they have no way to name a file and have something else fetch it.
// High: the catalog exposes components that take a REFERENCE (a path, a git
//   revision range) and the daemon hydrates the bytes at push time. "Show me
//   the diff" becomes ~15 authored tokens instead of ~2,000 pasted ones.
//
// The ladder is what makes the compression multiplicative rather than marginal:
// a syntax war moves output tokens tens of percent; a rung moves one element
// by one to two orders of magnitude.
export const Fidelity = {
  Low: "low",
  High: "high",
} as const;

export type Fidelity = (typeof Fidelity)[keyof typeof Fidelity];

// ---- Arms -------------------------------------------------------------------

export const ArmId = {
  ParchmentMarkupHigh: "parchment-markup-high",
  ParchmentMarkupLow: "parchment-markup-low",
  ParchmentJsonHigh: "parchment-json-high",
  ParchmentJsonLow: "parchment-json-low",
  ScrambledMarkupHigh: "scrambled-markup-high",
  ScrambledMarkupLow: "scrambled-markup-low",
  TerseJson: "terse-json",
  OpenUiLang: "openui-lang",
  RawHtml: "raw-html",
  RawJsx: "raw-jsx",
} as const;

export type ArmId = (typeof ArmId)[keyof typeof ArmId];

// How the model is asked to author. Determines the tool surface a run gets and
// how its artifact is turned into a page a browser can open.
export const AuthoringSurface = {
  // Calls canvas_render on the bench daemon's MCP server.
  CanvasTool: "canvas-tool",
  // Writes a file to the run's working directory with Write.
  WrittenFile: "written-file",
} as const;

export type AuthoringSurface = (typeof AuthoringSurface)[keyof typeof AuthoringSurface];

// What the model authored, pulled back out of the session transcript. This is
// the thing whose tokens we are counting, so it is captured verbatim.
export type AuthoredArtifact = {
  // The exact text the model emitted (markup document, JSON spec, HTML file,
  // JSX component). Archived per-run so every number is auditable.
  source: string;
  // Set when the arm authored through a tool call, so the report can show what
  // the daemon actually received.
  toolInput: Record<string, unknown> | null;
};

// The arm-natural error signal fed back on a failed attempt. NEVER parchment's
// own hints for a non-parchment arm, and never our validator's opinion for an
// arm that has its own compiler.
export type RepairSignal = {
  // Issues the arm's own toolchain produced: the markup compiler's issue list,
  // the spec validator's issues, the browser's console errors. Empty when the
  // artifact compiled and ran cleanly but simply rendered the wrong thing.
  toolchainIssues: readonly string[];
  // Derived ONLY from failed rubric assertions — "the page is missing X".
  // This is the same information a human would get by looking at the page, and
  // it is phrased identically for every arm so no arm is hand-held.
  missingFromPage: readonly string[];
};

export type Arm = {
  id: ArmId;
  fidelity: Fidelity;
  surface: AuthoringSurface;
  // Appended to Claude Code's system prompt via --append-system-prompt. This is
  // the arm's protocol/schema cost, and it is paid on every run as sent.
  systemPrompt: string;
  // The scenario task, phrased for this arm. Carries the same facts to every
  // arm — only the authoring instruction differs.
  encodeTask: (scenario: EvalScenario) => string;
  // How a failed attempt is described back to the model.
  repairPrompt: (signal: RepairSignal) => string;
};

// ---- Scenarios --------------------------------------------------------------

// A scenario states the task and the source data ONCE, arm-agnostically. Each
// arm's encodeTask wraps it. The acceptance rubric is shared byte-for-byte.
export type EvalScenario = {
  id: string;
  title: string;
  // What the user wants, in plain language, with no format-specific wording.
  request: string;
  // Source data pasted into the prompt (the classic scenarios), or null when
  // the data lives on disk and the point of the scenario is whether the arm can
  // REFERENCE it instead of pasting it (the ladder scenarios).
  inlineData: string | null;
  // Files on disk the task is about. Low-fidelity arms must read and paste
  // these; high-fidelity arms may reference them by path.
  sourceFiles: readonly SourceFile[];
  // True when this scenario exists to exercise the fidelity ladder.
  exercisesLadder: boolean;
  acceptance: AcceptanceSpec;
};

export type SourceFile = {
  // Path as the model sees it, relative to the run's working directory.
  relativePath: string;
  // Absolute path on this machine, for the harness's own hydration + rubric.
  absolutePath: string;
  description: string;
};

// ---- Measurement ------------------------------------------------------------

// One attempt: the initial authoring turn, or one repair turn.
export type AttemptRecord = {
  attemptIndex: number;
  // Tokens the model PRODUCED. The primary axis.
  outputTokens: number;
  // Everything the model READ: fresh input + cache reads + cache creation.
  // Reported raw and harness-subtracted; never quietly adjusted.
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  assistantTurnCount: number;
  wallClockMs: number;
  // Claude Code's own cost figure for the run.
  reportedCostUsd: number;
  artifact: AuthoredArtifact | null;
  accepted: boolean;
  failureReasons: readonly string[];
};

export type RunRecord = {
  runId: string;
  armId: ArmId;
  scenarioId: string;
  model: EvalModel;
  replicate: number;
  attempts: readonly AttemptRecord[];
  // True if any attempt passed the browser rubric.
  passed: boolean;
  // 1 when the first attempt passed; null when no attempt ever passed.
  attemptsToPass: number | null;
  // The arm's protocol cost, counted once per run as actually sent.
  systemPromptTokens: number;
  archivePath: string;
};
