import { describe, expect, test } from "bun:test";
import {
  auditApproximationAgainstTranscripts,
  collectCanonicalArtifacts,
} from "./density.ts";
import {
  buildReportMarkdown,
  LOSSES_HEADING,
  WINS_HEADING,
  type ReportInput,
  type ReportMeta,
} from "./report.ts";
import { DEFAULT_BOOTSTRAP_OPTIONS } from "./stats.ts";
import {
  ArmId,
  AuthoringSurface,
  EvalModel,
  type AttemptRecord,
  type RunRecord,
} from "./types.ts";

// A synthetic archive in which parchment BOTH wins and loses:
//   - `signup-form` (no ladder): raw-html is cheaper than every parchment arm. A LOSS.
//   - `git-diff-review` (ladder): the high-fidelity arm references the file
//     instead of pasting it, and beats raw-html by ~6x. A WIN.
// The honesty rule under test is that the loss is printed FIRST.

const LADDER_SCENARIO = "git-diff-review";
const FLAT_SCENARIO = "signup-form";
const SOURCE_FILE_PATH = "src/server.ts";
const SOURCE_FILE_BYTES = 8_000;
// Measured per surface by the ledger's probe: the canvas arms are sent
// canvas_render's schema, the file arms are sent Write's.
const CANVAS_HARNESS_TOKENS = 9_000;
const WRITTEN_FILE_HARNESS_TOKENS = 8_000;

const REFERENCE_ARTIFACT = `<DiffViewer file="${SOURCE_FILE_PATH}" revs="HEAD~1..HEAD" />`;
const PASTED_ARTIFACT = `<pre>${"- const timeout = 5000;\n+ const timeout = 15000;\n".repeat(200)}</pre>`;
const FORM_ARTIFACT = `<Form><Input name="email" type="email" /><Button>Sign up</Button></Form>`;

function makeAttempt(overrides: Partial<AttemptRecord> & { outputTokens: number }): AttemptRecord {
  return {
    // 0 is the authoring turn; 1..MAX_REPAIR_TURNS are repairs (driver.ts's
    // convention). The ledger derives attemptsToPass from it, so a first-try pass
    // recorded as index 1 would silently report as pass@2.
    attemptIndex: 0,
    inputTokens: 12_000,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    assistantTurnCount: 1,
    wallClockMs: 20_000,
    reportedCostUsd: 0.02,
    artifact: { source: REFERENCE_ARTIFACT, toolInput: null },
    accepted: true,
    failureReasons: [],
    ...overrides,
  };
}

function makeRun(params: {
  armId: ArmId;
  scenarioId: string;
  replicate: number;
  outputTokens: number;
  systemPromptTokens: number;
  inputTokens: number;
  artifactSource: string;
}): RunRecord {
  const attempt = makeAttempt({
    outputTokens: params.outputTokens,
    inputTokens: params.inputTokens,
    artifact: { source: params.artifactSource, toolInput: null },
  });

  return {
    runId: `${params.armId}-${params.scenarioId}-${params.replicate}`,
    armId: params.armId,
    scenarioId: params.scenarioId,
    model: EvalModel.Sonnet,
    replicate: params.replicate,
    attempts: [attempt],
    passed: true,
    attemptsToPass: 1,
    systemPromptTokens: params.systemPromptTokens,
    archivePath: `raw/${params.armId}-${params.scenarioId}-${params.replicate}.json`,
  };
}

function replicatesOf(
  armId: ArmId,
  scenarioId: string,
  outputTokens: readonly number[],
  options: { systemPromptTokens: number; inputTokens: number; artifactSource: string },
): RunRecord[] {
  return outputTokens.map((tokens, index) =>
    makeRun({
      armId,
      scenarioId,
      replicate: index + 1,
      outputTokens: tokens,
      systemPromptTokens: options.systemPromptTokens,
      inputTokens: options.inputTokens,
      artifactSource: options.artifactSource,
    }),
  );
}

const PARCHMENT_SYSTEM_TOKENS = 900;
const RIVAL_SYSTEM_TOKENS = 300;

function buildSyntheticArchive(): RunRecord[] {
  return [
    // The ladder scenario: high fidelity references the file.
    ...replicatesOf(ArmId.ParchmentMarkupHigh, LADDER_SCENARIO, [190, 200, 210], {
      systemPromptTokens: PARCHMENT_SYSTEM_TOKENS,
      inputTokens: 12_000,
      artifactSource: REFERENCE_ARTIFACT,
    }),
    // Same grammar, opaque identifiers — and it fell back to pasting the bytes.
    ...replicatesOf(ArmId.ScrambledMarkupHigh, LADDER_SCENARIO, [5_800, 6_000, 6_200], {
      systemPromptTokens: PARCHMENT_SYSTEM_TOKENS,
      inputTokens: 20_000,
      artifactSource: PASTED_ARTIFACT,
    }),
    ...replicatesOf(ArmId.RawHtml, LADDER_SCENARIO, [5_900, 6_000, 6_100], {
      systemPromptTokens: RIVAL_SYSTEM_TOKENS,
      inputTokens: 20_000,
      artifactSource: PASTED_ARTIFACT,
    }),
    // One replicate only: its interval must say so rather than print a NaN.
    ...replicatesOf(ArmId.RawJsx, LADDER_SCENARIO, [7_000], {
      systemPromptTokens: RIVAL_SYSTEM_TOKENS,
      inputTokens: 20_000,
      artifactSource: PASTED_ARTIFACT,
    }),

    // The flat scenario: no data to paste, so parchment's schema tax has nothing
    // to buy — and raw-html simply wins.
    ...replicatesOf(ArmId.ParchmentJsonLow, FLAT_SCENARIO, [1_190, 1_200, 1_210], {
      systemPromptTokens: PARCHMENT_SYSTEM_TOKENS,
      inputTokens: 12_000,
      artifactSource: FORM_ARTIFACT,
    }),
    ...replicatesOf(ArmId.ParchmentMarkupLow, FLAT_SCENARIO, [490, 500, 510], {
      systemPromptTokens: PARCHMENT_SYSTEM_TOKENS,
      inputTokens: 12_000,
      artifactSource: FORM_ARTIFACT,
    }),
    // The ablation's null result: identical grammar, opaque names, same cost.
    ...replicatesOf(ArmId.ScrambledMarkupLow, FLAT_SCENARIO, [495, 505, 500], {
      systemPromptTokens: PARCHMENT_SYSTEM_TOKENS,
      inputTokens: 12_000,
      artifactSource: FORM_ARTIFACT,
    }),
    ...replicatesOf(ArmId.RawHtml, FLAT_SCENARIO, [390, 400, 410], {
      systemPromptTokens: RIVAL_SYSTEM_TOKENS,
      inputTokens: 12_000,
      artifactSource: FORM_ARTIFACT,
    }),
  ];
}

const META: ReportMeta = {
  generatedAt: "2026-07-13T00:00:00.000Z",
  modelIds: { [EvalModel.Sonnet]: "claude-sonnet-4-5-20250929" },
  claudeCliVersion: "2.0.0",
  scenarios: [
    {
      id: LADDER_SCENARIO,
      title: "Review a git diff",
      exercisesLadder: true,
      sourceFileRelativePaths: [SOURCE_FILE_PATH],
      sourceFileBytes: SOURCE_FILE_BYTES,
    },
    {
      id: FLAT_SCENARIO,
      title: "Render a signup form",
      exercisesLadder: false,
      sourceFileRelativePaths: [],
      sourceFileBytes: 0,
    },
  ],
  harnessConstantsByModel: {
    [EvalModel.Sonnet]: {
      model: EvalModel.Sonnet,
      probes: [],
      promptTokensBySurface: {
        [AuthoringSurface.CanvasTool]: CANVAS_HARNESS_TOKENS,
        [AuthoringSurface.WrittenFile]: WRITTEN_FILE_HARNESS_TOKENS,
      },
    },
  },
  archiveRelativePath: "evals/results/2026-07-13T00-00-00Z",
  bootstrap: DEFAULT_BOOTSTRAP_OPTIONS,
};

function renderSyntheticReport(): string {
  const records = buildSyntheticArchive();
  const input: ReportInput = {
    records,
    density: collectCanonicalArtifacts(records),
    densityAudit: auditApproximationAgainstTranscripts(records),
    meta: META,
  };
  return buildReportMarkdown(input);
}

const LOSING_CELL = `\`${ArmId.ParchmentJsonLow}\` on **${FLAT_SCENARIO}**`;
const WINNING_CELL = `\`${ArmId.ParchmentMarkupHigh}\` on **${LADDER_SCENARIO}**`;

describe("the losses-first honesty rule", () => {
  test("the losses heading is printed before the wins heading", () => {
    const markdown = renderSyntheticReport();
    expect(markdown).toContain(LOSSES_HEADING);
    expect(markdown).toContain(WINS_HEADING);
    expect(markdown.indexOf(LOSSES_HEADING)).toBeLessThan(markdown.indexOf(WINS_HEADING));
  });

  test("a cell parchment LOSES is printed before a cell parchment WINS", () => {
    const markdown = renderSyntheticReport();
    expect(markdown).toContain(LOSING_CELL);
    expect(markdown).toContain(WINNING_CELL);
    expect(markdown.indexOf(LOSING_CELL)).toBeLessThan(markdown.indexOf(WINNING_CELL));
  });

  test("the loss is named as a loss, with the rival that beat us", () => {
    const markdown = renderSyntheticReport();
    const lossLine = lineContaining(markdown, LOSING_CELL);
    expect(lossLine).toContain(ArmId.RawHtml);
    expect(lossLine).toContain("worse");
  });

  test("the worst loss is printed before a smaller loss", () => {
    const markdown = renderSyntheticReport();
    const smallerLoss = `\`${ArmId.ParchmentMarkupLow}\` on **${FLAT_SCENARIO}**`;
    expect(markdown.indexOf(LOSING_CELL)).toBeLessThan(markdown.indexOf(smallerLoss));
  });
});

describe("the ladder table", () => {
  test("quotes the gap as a ratio with a confidence interval, not a bare point", () => {
    const markdown = renderSyntheticReport();
    const ladderSection = sectionOf(markdown, "## THE FIDELITY LADDER");
    expect(ladderSection).toContain(`x vs \`${ArmId.ParchmentMarkupHigh}\` (95% CI)`);
    expect(ladderSection).toMatch(/\d+\.\d+x–\d+\.\d+x/);
  });

  test("reports whether each arm referenced the file or pasted it", () => {
    const ladderSection = sectionOf(renderSyntheticReport(), "## THE FIDELITY LADDER");
    expect(ladderSection).toContain("referenced");
    expect(ladderSection).toContain("pasted");
  });

  test("a single-replicate cell says insufficient data instead of printing NaN", () => {
    const markdown = renderSyntheticReport();
    expect(markdown).toContain("insufficient data (single-sample)");
    expect(markdown).not.toContain("NaN");
  });
});

describe("the ablation section", () => {
  test("reports a null result as a null result", () => {
    const ablation = sectionOf(renderSyntheticReport(), "## Ablation");
    expect(ablation).toContain("NULL RESULT");
    expect(ablation).toContain("brackets 1.00x");
  });

  test("answers whether the scrambled arm still climbed the ladder", () => {
    const climbing = sectionOf(
      renderSyntheticReport(),
      "### Did the scrambled arm still climb the ladder?",
    );
    const scrambledRow = lineContaining(climbing, `\`${ArmId.ScrambledMarkupHigh}\``);
    const realRow = lineContaining(climbing, `\`${ArmId.ParchmentMarkupHigh}\``);
    // Columns: arm | rung | ladder runs | referenced | pasted | inconclusive | no artifact.
    // The scrambled arm pasted the bytes; the real-vocabulary arm referenced them.
    expect(scrambledRow).toBe("| `scrambled-markup-high` | high | 3 | 0 | 3 | 0 | 0 |");
    expect(realRow).toBe("| `parchment-markup-high` | high | 3 | 3 | 0 | 0 | 0 |");
  });
});

describe("the honesty requirements", () => {
  test("input is reported BOTH raw and harness-subtracted", () => {
    const decomposition = sectionOf(renderSyntheticReport(), "## Decomposition");
    expect(decomposition).toContain("Input RAW");
    expect(decomposition).toContain("Input harness-subtracted");
  });

  test("the harness constant is published per surface, with the subtraction shown", () => {
    const markdown = renderSyntheticReport();
    expect(markdown).toContain("The harness constant, and how it was measured");
    // Measured per surface, because canvas_render's tool schema is not Write's.
    expect(markdown).toContain(`\`${AuthoringSurface.CanvasTool}\`: 9,000 tokens`);
    expect(markdown).toContain(`\`${AuthoringSurface.WrittenFile}\`: 8,000 tokens`);
    // The arithmetic, not just the claim.
    expect(markdown).toContain("Worked example from this archive:");
  });

  test("an unmeasured harness constant prints 'not measured', never a silent zero", () => {
    const records = buildSyntheticArchive();
    const markdown = buildReportMarkdown({
      records,
      density: collectCanonicalArtifacts(records),
      densityAudit: auditApproximationAgainstTranscripts(records),
      meta: { ...META, harnessConstantsByModel: {} },
    });

    expect(markdown).toContain("NOT MEASURED for this archive");
    expect(markdown).toContain("not measured");
  });

  test("a first-attempt pass counts as pass@1", () => {
    // Every synthetic run passes on the authoring turn (attemptIndex 0), so every
    // pass@1 cell must read 100%. This pins the 0-based attemptIndex convention:
    // recording the authoring turn as index 1 would silently report pass@2.
    const headline = sectionOf(renderSyntheticReport(), "## Headline");
    const parchmentRow = tableRowFor(headline, ArmId.ParchmentMarkupHigh);
    expect(parchmentRow).toContain("100%");
  });

  test("cost is reported cold AND warm", () => {
    const cost = sectionOf(renderSyntheticReport(), "## Cost");
    expect(cost).toContain("Cold-cache $ / correct render");
    expect(cost).toContain("Warm-cache $ / correct render");
  });

  test("format density is its own table and its token counts are labelled approximate", () => {
    const density = sectionOf(renderSyntheticReport(), "## Format density");
    expect(density).toContain("Bytes (EXACT)");
    expect(density).toContain("TOKEN COLUMNS ARE APPROXIMATIONS");
    expect(density).toContain("Method:");
    expect(density).toContain("Known error:");
  });

  test("strict tool use is declared NOT TESTED rather than simulated", () => {
    const methodology = sectionOf(renderSyntheticReport(), "## Methodology");
    expect(methodology).toContain("NOT TESTED");
    expect(methodology).toContain("grammar-constrained decoding");
    expect(methodology).toContain("UNREACHABLE through Claude Code's MCP path");
    expect(methodology).toContain("What we did NOT control for");
    expect(methodology).toContain("How to falsify this");
  });

  test("the exact model id and the bootstrap seed are published", () => {
    const markdown = renderSyntheticReport();
    expect(markdown).toContain("claude-sonnet-4-5-20250929");
    expect(markdown).toContain(String(DEFAULT_BOOTSTRAP_OPTIONS.seed));
  });
});

function sectionOf(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  if (start < 0) throw new Error(`report is missing the section "${heading}"`);

  const rest = markdown.slice(start + heading.length);
  const nextHeadingOffset = rest.indexOf("\n## ");
  if (nextHeadingOffset < 0) return rest;
  return rest.slice(0, nextHeadingOffset);
}

function lineContaining(markdown: string, needle: string): string {
  const line = markdown.split("\n").find((candidate) => candidate.includes(needle));
  if (!line) throw new Error(`report has no line containing "${needle}"`);
  return line;
}

// A section's prose and its losses/wins bullets also name the arms, so a table
// assertion must match a TABLE row: one that starts with the arm's own cell.
function tableRowFor(markdown: string, armId: ArmId): string {
  const rowPrefix = `| \`${armId}\` |`;
  const row = markdown.split("\n").find((candidate) => candidate.startsWith(rowPrefix));
  if (!row) throw new Error(`report has no table row for "${armId}"`);
  return row;
}
