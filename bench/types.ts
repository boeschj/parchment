// Shared vocabulary for the benchmark harness. Every module below composes
// these primitives rather than inventing parallel ad-hoc shapes.

// The authoring approaches under comparison: parchment's canvas_* MCP tools —
// reached either by writing a JSON spec ("parchment") or the HTML-flavored
// markup dialect ("parchment-markup") — versus a single-file HTML artifact
// (the Claude Code Artifacts model).
export const Arm = {
  Parchment: "parchment",
  ParchmentMarkup: "parchment-markup",
  Html: "html",
} as const;

export type Arm = (typeof Arm)[keyof typeof Arm];

// Both parchment arms drive the same canvas_render tool against the same bench
// daemon and are checked against the same component-type requirement — the
// markup dialect compiles to the very same components. They differ only in how
// the model authors the UI, which is the whole point of the comparison.
export function isParchmentArm(arm: Arm): boolean {
  return arm === Arm.Parchment || arm === Arm.ParchmentMarkup;
}

// `claude -p --model <alias>` accepts these aliases directly.
export const Model = {
  Haiku: "haiku",
  Sonnet: "sonnet",
  Opus: "opus",
} as const;

export type Model = (typeof Model)[keyof typeof Model];

// Outcome of checking a run's final artifact against a scenario's
// machine-checkable requirements — the same shape for both arms so a report
// table can compare them column-for-column.
export type ValidationResult = {
  passed: boolean;
  reasons: string[];
};

// Token/turn accounting derived purely from the session JSONL (see
// metrics/extract-metrics.ts). Cost and wall-clock come from the `claude -p`
// result summary instead, since the JSONL never carries a dollar figure.
export type TranscriptMetrics = {
  assistantTurnCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  renderAttempts: number;
  // Cumulative prompt+completion tokens through the turn where the user
  // would first see SOMETHING rendered — not necessarily correct yet.
  tokensToFirstPaint: number | null;
  turnsToFirstPaint: number | null;
};

// The `claude -p --output-format json` result object, narrowed to the fields
// this harness uses. Field names mirror the CLI's own JSON verbatim.
export type ClaudeRunResult = {
  isError: boolean;
  numTurns: number;
  totalCostUsd: number;
  durationMs: number;
  sessionId: string;
  resultText: string;
};

export type RunRecord = {
  scenarioId: string;
  arm: Arm;
  model: Model;
  repetition: number;
  sessionId: string;
  jsonlPath: string;
  claudeResult: ClaudeRunResult;
  transcript: TranscriptMetrics;
  validation: ValidationResult;
  claudeVersion: string;
  recordedAt: string;
};
