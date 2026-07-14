import { describe, expect, test } from "bun:test";
import { auditApproximationAgainstTranscripts, collectCanonicalArtifacts } from "./density.ts";
import type { EvalAttemptRecord, EvalRunRecord } from "./ledger.ts";
import {
  buildReportMarkdown,
  LOSSES_HEADING,
  WINS_HEADING,
  type ReportInput,
  type ReportMeta,
} from "./report.ts";
import { DEFAULT_BOOTSTRAP_OPTIONS } from "./stats.ts";
import { ArmId, AuthoringSurface, EvalModel } from "./types.ts";

// A synthetic archive in which parchment BOTH wins and loses:
//   - `signup-form` (no ladder): raw-html authors fewer tokens than every
//     parchment arm. A LOSS.
//   - `git-diff-ladder` (ladder): the high-fidelity arm REFERENCES the file
//     instead of pasting it and beats raw-html by ~30x. A WIN.
// The honesty rule under test is that the loss is printed FIRST — and, in the
// ladder-climbing tests below, that a model which does NOT climb is reported as a
// negative result rather than quietly dropped.

const LADDER_SCENARIO = "git-diff-ladder";
const FLAT_SCENARIO = "signup-form";
const SOURCE_FILE_PATH = "repo/src/server.ts";
const SOURCE_FILE_BYTES = 8_000;
// Measured per surface by the ledger's probe: the canvas arms are sent
// canvas_render's schema, the file arms are sent Write's.
const CANVAS_HARNESS_TOKENS = 9_000;
const WRITTEN_FILE_HARNESS_TOKENS = 8_000;

const GIT_DIFF_REFERENCE = "GitDiff";
const REFERENCE_ARTIFACT = `<GitDiff file="${SOURCE_FILE_PATH}" base="HEAD~1" />`;
const PASTED_ARTIFACT = `<pre>${"- const t = 5000;\n+ const t = 15000;\n".repeat(200)}</pre>`;
const FORM_ARTIFACT = `<Form><Input name="email" type="email" /><Button>Sign up</Button></Form>`;

type RunShape = {
  armId: ArmId;
  scenarioId: string;
  replicate: number;
  // THE HEADLINE: what it cost to EMIT the artifact.
  authoredOutputTokens: number;
  // SECONDARY: the whole chatty session. Deliberately far larger, so a test that
  // confuses the two fails loudly.
  sessionOutputTokens: number;
  systemPromptTokens: number;
  inputTokens: number;
  artifactSource: string;
  usedReference: boolean;
};

function makeAttempt(shape: RunShape): EvalAttemptRecord {
  return {
    // 0 is the authoring turn; 1..MAX_REPAIR_TURNS are repairs (driver.ts's
    // convention). The ledger derives attemptsToPass from it, so a first-try pass
    // recorded as index 1 would silently report as pass@2.
    attemptIndex: 0,
    outputTokens: shape.sessionOutputTokens,
    authoredOutputTokens: shape.authoredOutputTokens,
    authoredArtifactBytes: new TextEncoder().encode(shape.artifactSource).length,
    renderCallCount: 1,
    usedReference: shape.usedReference,
    referenceKindsUsed: shape.usedReference ? [GIT_DIFF_REFERENCE] : [],
    inputTokens: shape.inputTokens,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    assistantTurnCount: 1,
    wallClockMs: 20_000,
    reportedCostUsd: 0.02,
    artifact: { source: shape.artifactSource, toolInput: null },
    accepted: true,
    failureReasons: [],
  };
}

function makeRun(shape: RunShape): EvalRunRecord {
  return {
    runId: `${shape.armId}-${shape.scenarioId}-${shape.replicate}`,
    armId: shape.armId,
    scenarioId: shape.scenarioId,
    model: EvalModel.Sonnet,
    replicate: shape.replicate,
    attempts: [makeAttempt(shape)],
    passed: true,
    attemptsToPass: 1,
    systemPromptTokens: shape.systemPromptTokens,
    archivePath: `raw/${shape.armId}-${shape.scenarioId}-${shape.replicate}.json`,
  };
}

const PARCHMENT_SYSTEM_TOKENS = 900;
const RIVAL_SYSTEM_TOKENS = 300;

// Every session is chatty — the agent reads the file, runs git, thinks. If the
// report ever leads with THIS number instead of the authored one, the ladder
// win disappears into the noise, which is the bug these fixtures exist to catch.
const CHATTY_SESSION_TOKENS = 11_271;

function replicatesOf(
  armId: ArmId,
  scenarioId: string,
  authoredTokens: readonly number[],
  options: {
    systemPromptTokens: number;
    inputTokens: number;
    artifactSource: string;
    usedReference: boolean;
  },
): EvalRunRecord[] {
  return authoredTokens.map((authored, index) =>
    makeRun({
      armId,
      scenarioId,
      replicate: index + 1,
      authoredOutputTokens: authored,
      sessionOutputTokens: CHATTY_SESSION_TOKENS,
      systemPromptTokens: options.systemPromptTokens,
      inputTokens: options.inputTokens,
      artifactSource: options.artifactSource,
      usedReference: options.usedReference,
    }),
  );
}

// The high-fidelity arm CLIMBS: it references the file, so it authors ~200 tokens.
function buildClimbingArchive(): EvalRunRecord[] {
  return [
    ...replicatesOf(ArmId.ParchmentMarkupHigh, LADDER_SCENARIO, [190, 200, 210], {
      systemPromptTokens: PARCHMENT_SYSTEM_TOKENS,
      inputTokens: 12_000,
      artifactSource: REFERENCE_ARTIFACT,
      usedReference: true,
    }),
    // Same grammar, opaque identifiers — and it fell back to pasting the bytes.
    ...replicatesOf(ArmId.ScrambledMarkupHigh, LADDER_SCENARIO, [5_800, 6_000, 6_200], {
      systemPromptTokens: PARCHMENT_SYSTEM_TOKENS,
      inputTokens: 20_000,
      artifactSource: PASTED_ARTIFACT,
      usedReference: false,
    }),
    ...replicatesOf(ArmId.RawHtml, LADDER_SCENARIO, [5_900, 6_000, 6_100], {
      systemPromptTokens: RIVAL_SYSTEM_TOKENS,
      inputTokens: 20_000,
      artifactSource: PASTED_ARTIFACT,
      usedReference: false,
    }),
    // One replicate only: its interval must say so rather than print a NaN.
    ...replicatesOf(ArmId.RawJsx, LADDER_SCENARIO, [7_000], {
      systemPromptTokens: RIVAL_SYSTEM_TOKENS,
      inputTokens: 20_000,
      artifactSource: PASTED_ARTIFACT,
      usedReference: false,
    }),

    // The flat scenario: no data to reference, so parchment's schema tax buys
    // nothing and raw-html simply wins.
    ...replicatesOf(ArmId.ParchmentJsonLow, FLAT_SCENARIO, [1_190, 1_200, 1_210], {
      systemPromptTokens: PARCHMENT_SYSTEM_TOKENS,
      inputTokens: 12_000,
      artifactSource: FORM_ARTIFACT,
      usedReference: false,
    }),
    ...replicatesOf(ArmId.ParchmentMarkupLow, FLAT_SCENARIO, [490, 500, 510], {
      systemPromptTokens: PARCHMENT_SYSTEM_TOKENS,
      inputTokens: 12_000,
      artifactSource: FORM_ARTIFACT,
      usedReference: false,
    }),
    // The ablation's null result: identical grammar, opaque names, same cost.
    ...replicatesOf(ArmId.ScrambledMarkupLow, FLAT_SCENARIO, [495, 505, 500], {
      systemPromptTokens: PARCHMENT_SYSTEM_TOKENS,
      inputTokens: 12_000,
      artifactSource: FORM_ARTIFACT,
      usedReference: false,
    }),
    ...replicatesOf(ArmId.RawHtml, FLAT_SCENARIO, [390, 400, 410], {
      systemPromptTokens: RIVAL_SYSTEM_TOKENS,
      inputTokens: 12_000,
      artifactSource: FORM_ARTIFACT,
      usedReference: false,
    }),
  ];
}

// Enough replicates for the Wilson interval to actually clear half. At N=3 even a
// perfect record cannot — which is the point of using Wilson in the first place.
const REPLICATES_ENOUGH_TO_CONCLUDE = 8;

function buildStronglyClimbingArchive(): EvalRunRecord[] {
  const authoredTokens = Array.from({ length: REPLICATES_ENOUGH_TO_CONCLUDE }, () => 200);

  return [
    ...replicatesOf(ArmId.ParchmentMarkupHigh, LADDER_SCENARIO, authoredTokens, {
      systemPromptTokens: PARCHMENT_SYSTEM_TOKENS,
      inputTokens: 12_000,
      artifactSource: REFERENCE_ARTIFACT,
      usedReference: true,
    }),
    ...replicatesOf(ArmId.RawHtml, LADDER_SCENARIO, [5_900, 6_000, 6_100], {
      systemPromptTokens: RIVAL_SYSTEM_TOKENS,
      inputTokens: 20_000,
      artifactSource: PASTED_ARTIFACT,
      usedReference: false,
    }),
  ];
}

// The finding from the first real pilot: the high-fidelity arm was TOLD it could
// reference the file, and pasted the whole thing anyway, 3 times out of 3.
function buildNeverClimbedArchive(): EvalRunRecord[] {
  return [
    ...replicatesOf(ArmId.ParchmentMarkupHigh, LADDER_SCENARIO, [5_700, 5_900, 6_100], {
      systemPromptTokens: PARCHMENT_SYSTEM_TOKENS,
      inputTokens: 20_000,
      artifactSource: PASTED_ARTIFACT,
      usedReference: false,
    }),
    ...replicatesOf(ArmId.RawHtml, LADDER_SCENARIO, [5_900, 6_000, 6_100], {
      systemPromptTokens: RIVAL_SYSTEM_TOKENS,
      inputTokens: 20_000,
      artifactSource: PASTED_ARTIFACT,
      usedReference: false,
    }),
  ];
}

// An archive written BEFORE the authoring measurement existed. The report reads
// archives through JSON.parse, so on-disk records can be missing fields the type
// promises — which is precisely the case that would otherwise sum to NaN and
// print as a number in the headline. Modelled here through the same untyped
// boundary the CLI uses, rather than with a cast that would lie about the shape.
function buildLegacyArchive(): readonly EvalRunRecord[] {
  const withoutAuthoringFields = buildClimbingArchive().map((record) => ({
    ...record,
    attempts: record.attempts.map((attempt) => {
      const {
        authoredOutputTokens: _authoredOutputTokens,
        authoredArtifactBytes: _authoredArtifactBytes,
        usedReference: _usedReference,
        referenceKindsUsed: _referenceKindsUsed,
        ...legacyAttempt
      } = attempt;
      return legacyAttempt;
    }),
  }));

  return JSON.parse(JSON.stringify(withoutAuthoringFields));
}

const META: ReportMeta = {
  generatedAt: "2026-07-14T00:00:00.000Z",
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
  archiveRelativePath: "evals/results/2026-07-14T00-00-00Z",
  bootstrap: DEFAULT_BOOTSTRAP_OPTIONS,
};

function renderReport(records: readonly EvalRunRecord[], meta: ReportMeta = META): string {
  const input: ReportInput = {
    records,
    density: collectCanonicalArtifacts(records),
    densityAudit: auditApproximationAgainstTranscripts(records),
    meta,
  };
  return buildReportMarkdown(input);
}

function renderSyntheticReport(): string {
  return renderReport(buildClimbingArchive());
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
    const lossLine = lineContaining(renderSyntheticReport(), LOSING_CELL);
    expect(lossLine).toContain(ArmId.RawHtml);
    expect(lossLine).toContain("worse");
  });

  test("the worst loss is printed before a smaller loss", () => {
    const markdown = renderSyntheticReport();
    const smallerLoss = `\`${ArmId.ParchmentMarkupLow}\` on **${FLAT_SCENARIO}**`;
    expect(markdown.indexOf(LOSING_CELL)).toBeLessThan(markdown.indexOf(smallerLoss));
  });
});

describe("the headline is AUTHORED tokens, not session tokens", () => {
  test("the headline table reports authored output, not the chatty session total", () => {
    const headline = sectionOf(renderSyntheticReport(), "## HEADLINE");
    const parchmentRow = tableRowFor(headline, ArmId.ParchmentMarkupHigh);

    // 200 authored, not the 11,271-token session it lived inside.
    expect(parchmentRow).toContain("200");
    expect(parchmentRow).not.toContain("11,271");
  });

  test("the session total is published, but in its own clearly-labelled section", () => {
    const markdown = renderSyntheticReport();
    const sessionCost = sectionOf(markdown, "## Session cost");
    expect(sessionCost).toContain("NOT the format comparison");

    const decomposition = sectionOf(markdown, "## Decomposition");
    expect(decomposition).toContain("AUTHORED output");
    expect(decomposition).toContain("SESSION output (exploration incl.)");
    // The session number is never dropped — it is right there, next to the authored one.
    expect(tableRowFor(decomposition, ArmId.ParchmentMarkupHigh)).toContain("11,271");
  });

  test("the headline carries exact artifact bytes beside the tokens", () => {
    const headline = sectionOf(renderSyntheticReport(), "## HEADLINE");
    expect(headline).toContain("Artifact bytes (EXACT, mean)");
  });

  test("a first-attempt pass counts as pass@1", () => {
    // Every synthetic run passes on the authoring turn (attemptIndex 0), so every
    // pass@1 cell must read 100%. This pins the 0-based attemptIndex convention.
    const headline = sectionOf(renderSyntheticReport(), "## HEADLINE");
    expect(tableRowFor(headline, ArmId.ParchmentMarkupHigh)).toContain("100%");
  });
});

describe("did the model climb the ladder?", () => {
  test("a model that NEVER climbed is reported as a NEGATIVE RESULT, near the top", () => {
    const markdown = renderReport(buildNeverClimbedArchive());
    const climbing = sectionOf(markdown, "## Did the model climb the ladder?");

    expect(climbing).toContain("NEGATIVE RESULT");
    expect(climbing).toContain("the model NEVER climbed the ladder");
    expect(climbing).toContain("product opportunity");
    // It must not be quotable as a measured win.
    expect(climbing).toContain("NOT a measured result");

    // "Near the top" is a structural claim, so it gets a structural test: the
    // negative result appears before the ladder table that would otherwise read
    // as a victory.
    expect(markdown.indexOf("NEGATIVE RESULT")).toBeLessThan(
      markdown.indexOf("## The fidelity ladder"),
    );
  });

  test("the climb rate carries a Wilson interval, not a bare 0% or 100%", () => {
    const climbing = sectionOf(renderReport(buildNeverClimbedArchive()), "## Did the model climb");
    const row = tableRowFor(climbing, ArmId.ParchmentMarkupHigh);

    expect(row).toContain("0/3");
    // 0/3 under Wilson is 0%-56%, NOT the [0,0] the normal approximation claims.
    expect(row).toContain("0%–56%");
  });

  test("3 out of 3 climbs is INCONCLUSIVE, not a victory lap", () => {
    // The honest verdict at N=3. Even a perfect 3/3 has a Wilson lower bound of
    // 44%, which does not clear half — so the report REFUSES to say the model
    // reliably climbs. A pilot is not a result, and the report says so itself.
    const climbing = sectionOf(renderSyntheticReport(), "## Did the model climb the ladder?");
    const row = tableRowFor(climbing, ArmId.ParchmentMarkupHigh);

    expect(climbing).toContain("INCONCLUSIVE");
    expect(climbing).toContain("Raise `--replicates`");
    expect(row).toContain("3/3");
    expect(row).toContain(GIT_DIFF_REFERENCE);
    expect(row).toContain("44%–100%");
  });

  test("with enough replicates, a climbing model IS reported as climbing", () => {
    const climbing = sectionOf(
      renderReport(buildStronglyClimbingArchive()),
      "## Did the model climb the ladder?",
    );
    expect(climbing).toContain("The model climbed the ladder");
    expect(climbing).toContain("the interval clears half");
  });

  test("the verdict ignores the scrambled control, which is sabotaged on purpose", () => {
    // parchment-markup-high climbs 3/3; scrambled-markup-high climbs 0/3. Pooling
    // them would report 3/6 and bury a real finding under a control arm.
    const climbing = sectionOf(renderSyntheticReport(), "## Did the model climb the ladder?");
    expect(climbing).not.toContain("3/6");
    expect(tableRowFor(climbing, ArmId.ScrambledMarkupHigh)).toContain("0/3");
  });

});

describe("the fidelity ladder table", () => {
  test("separates what the arm COULD emit from what it ACTUALLY emitted", () => {
    const ladder = sectionOf(renderSyntheticReport(), "## The fidelity ladder");
    expect(ladder).toContain("(a) COULD have emitted");
    expect(ladder).toContain("(b) ACTUALLY emitted");
    expect(ladder).toContain("(c) MUST emit");
    expect(ladder).toContain("the product's opportunity");
    expect(ladder).toContain("realised win");
  });

  test("an arm with no reference mechanism has no floor, rather than a fake one", () => {
    const ladder = sectionOf(renderSyntheticReport(), "## The fidelity ladder");
    expect(tableRowFor(ladder, ArmId.RawHtml)).toContain("none — no reference mechanism");
  });

  test("the floor is NOT MEASURED when no hand-written reference artifact exists", () => {
    // The synthetic archive has no reference artifacts on disk, so column (a) must
    // refuse to quote a number — using a run's artifact here would collapse what
    // the model COULD have emitted into what it DID emit.
    const ladder = sectionOf(renderSyntheticReport(), "## The fidelity ladder");
    expect(tableRowFor(ladder, ArmId.ParchmentMarkupHigh)).toContain("NOT MEASURED");
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

  test("reports whether each side of the ablation climbed the ladder", () => {
    const ablation = sectionOf(renderSyntheticReport(), "## Ablation");
    expect(ablation).toContain("Real climbed");
    expect(ablation).toContain("Scrambled climbed");
  });
});

describe("the honesty requirements", () => {
  test("an archive without the authoring measurement prints NOT MEASURED, never a NaN", () => {
    const markdown = renderReport(buildLegacyArchive());

    expect(markdown).toContain("NOT MEASURED");
    expect(markdown).not.toContain("NaN");
  });

  test("input is reported BOTH raw and harness-subtracted", () => {
    const decomposition = sectionOf(renderSyntheticReport(), "## Decomposition");
    expect(decomposition).toContain("Input RAW");
    expect(decomposition).toContain("Input harness-subtracted");
  });

  test("the harness constant is published per surface, with the subtraction shown", () => {
    const markdown = renderSyntheticReport();
    expect(markdown).toContain("The harness constant, and how it was measured");
    expect(markdown).toContain(`\`${AuthoringSurface.CanvasTool}\`: 9,000 tokens`);
    expect(markdown).toContain(`\`${AuthoringSurface.WrittenFile}\`: 8,000 tokens`);
    expect(markdown).toContain("Worked example from this archive:");
  });

  test("cost is reported cold AND warm", () => {
    const cost = sectionOf(renderSyntheticReport(), "## Session cost");
    expect(cost).toContain("Cold-cache $");
    expect(cost).toContain("Warm-cache $");
  });

  test("format density is its own table and its token counts are labelled approximate", () => {
    const density = sectionOf(renderSyntheticReport(), "## Format density");
    expect(density).toContain("Bytes (EXACT)");
    expect(density).toContain("TOKEN COLUMNS ARE APPROXIMATIONS");
    expect(density).toContain("Method:");
    expect(density).toContain("Known error:");
  });

  test("the methodology says plainly that the reference components are NOT shipped", () => {
    const methodology = sectionOf(renderSyntheticReport(), "## Methodology");
    expect(methodology).toContain("WHAT IS NOT SHIPPED");
    expect(methodology).toContain("GitDiff");
    expect(methodology).toContain("NOT YET REAL");
    expect(methodology).toContain("does not exist yet");
  });

  test("strict tool use is declared NOT TESTED, and named as THE open question", () => {
    const methodology = sectionOf(renderSyntheticReport(), "## Methodology");
    expect(methodology).toContain("NOT TESTED");
    expect(methodology).toContain("grammar-constrained decoding");
    expect(methodology).toContain("UNREACHABLE through Claude Code's MCP path");
    expect(methodology).toContain("Console API key");
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
// assertion must match a TABLE row — a line that opens a markdown row and carries
// the arm in one of its cells. (The ladder-climbing table leads with the scenario
// rather than the arm, so matching on a prefix would miss it.)
function tableRowFor(markdown: string, armId: ArmId): string {
  const armCell = `\`${armId}\``;
  const row = markdown
    .split("\n")
    .filter(isTableBodyRow)
    .find((candidate) => candidate.includes(armCell));
  if (!row) throw new Error(`report has no table row for "${armId}"`);
  return row;
}

// A header can legitimately carry an arm's name in a column LABEL (the ladder
// table's "x vs `parchment-markup-high`" column), so header rows are excluded
// rather than matched as data.
const TABLE_HEADER_FIRST_CELLS = ["Arm", "Scenario", "Rung"] as const;

function isTableBodyRow(line: string): boolean {
  if (!line.startsWith("| ")) return false;
  if (line.startsWith("|---")) return false;

  const isHeader = TABLE_HEADER_FIRST_CELLS.some((cell) => line.startsWith(`| ${cell} |`));
  return !isHeader;
}
