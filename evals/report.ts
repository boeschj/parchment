// The published report. Takes archived runs and emits markdown.
//
// THE HEADLINE IS AUTHORED OUTPUT TOKENS — the output tokens of the single
// assistant message that carried the render call. That is the cost of EMITTING
// the artifact, and it is the only output number that tests the thesis.
//
// A session's TOTAL output tokens are dominated by agentic exploration: reading
// the file, running git, thinking, retrying. That is real cost and it is
// published (see Session cost), but it measures how chatty the agent was, not how
// expensive the format is. Leading with it would compare session behaviour and
// call it a format comparison. Both numbers appear; neither wears the other's
// label.
//
// EVERY NUMBER IS THE LEDGER'S. This file does no token arithmetic and no pricing
// of its own: totals come from summariseRun, cost from costOfRun, the harness
// subtraction from subtractHarnessConstant. A report that computed its own cost
// model would eventually disagree with the ledger, and a hostile reader would be
// right to stop reading there.
//
// THE HONESTY RULES, enforced structurally rather than by good intentions:
//   1. Losses first. Every comparative section prints "Where parchment loses"
//      BEFORE "Where parchment wins". report.test.ts fails the build if that
//      order ever inverts.
//   2. A negative result is printed as plainly as a positive one. If the model
//      does not climb the ladder, that is the finding, and it goes near the top.
//   3. What the arm COULD have emitted, what it ACTUALLY emitted, and what an arm
//      with no reference mechanism MUST emit are three different numbers and are
//      never conflated.
//   4. Input is printed raw AND harness-subtracted; cost cold AND warm.
//   5. A field missing from an archive prints NOT MEASURED. Nothing is backfilled.

import { armFor } from "./arms/index.ts";
import { MAX_REPAIR_TURNS } from "./config.ts";
import {
  ArtifactOrigin,
  TOKEN_APPROXIMATION,
  type ApproximationAudit,
  type ArtifactMeasurement,
} from "./density.ts";
import {
  costOfRun,
  promptTokensOf,
  subtractHarnessConstant,
  summariseRun,
  type EvalAttemptRecord,
  type EvalRunRecord,
  type HarnessConstant,
  type RunTotals,
} from "./ledger.ts";
import {
  BOOTSTRAP_METHOD_DESCRIPTION,
  bootstrapConfidenceInterval,
  bootstrapRatio,
  EstimateStatus,
  mean,
  summarize,
  WILSON_METHOD_DESCRIPTION,
  wilsonInterval,
  type BootstrapOptions,
  type IntervalEstimate,
  type ProportionEstimate,
  type SampleSummary,
} from "./stats.ts";
import { ArmId, AuthoringSurface, EvalModel, Fidelity } from "./types.ts";

// ---- What the report must be told (it does no I/O and guesses nothing) -------

export type ScenarioSummary = {
  id: string;
  title: string;
  exercisesLadder: boolean;
  sourceFileRelativePaths: readonly string[];
  sourceFileBytes: number;
};

export type ReportMeta = {
  generatedAt: string;
  modelIds: Readonly<Partial<Record<EvalModel, string>>>;
  claudeCliVersion: string | null;
  scenarios: readonly ScenarioSummary[];
  // Measured by ledger.measureHarnessConstant, per model, per authoring surface.
  // Absent when the archive predates the measurement: the report then prints RAW
  // input only and says NOT MEASURED, rather than inventing a constant.
  harnessConstantsByModel: Readonly<Partial<Record<EvalModel, HarnessConstant>>>;
  archiveRelativePath: string;
  bootstrap: BootstrapOptions;
};

export type ReportInput = {
  records: readonly EvalRunRecord[];
  density: readonly ArtifactMeasurement[];
  densityAudit: ApproximationAudit | null;
  meta: ReportMeta;
};

// ---- Arm taxonomy ------------------------------------------------------------

export const ArmFamily = {
  Parchment: "parchment",
  Scrambled: "scrambled",
  Rival: "rival",
} as const;

export type ArmFamily = (typeof ArmFamily)[keyof typeof ArmFamily];

const ARM_FAMILY: Record<ArmId, ArmFamily> = {
  [ArmId.ParchmentMarkupHigh]: ArmFamily.Parchment,
  [ArmId.ParchmentMarkupLow]: ArmFamily.Parchment,
  [ArmId.ParchmentJsonHigh]: ArmFamily.Parchment,
  [ArmId.ParchmentJsonLow]: ArmFamily.Parchment,
  [ArmId.ScrambledMarkupHigh]: ArmFamily.Scrambled,
  [ArmId.ScrambledMarkupLow]: ArmFamily.Scrambled,
  [ArmId.TerseJson]: ArmFamily.Rival,
  [ArmId.OpenUiLang]: ArmFamily.Rival,
  [ArmId.RawHtml]: ArmFamily.Rival,
  [ArmId.RawJsx]: ArmFamily.Rival,
};

const ARM_FIDELITY: Record<ArmId, Fidelity> = {
  [ArmId.ParchmentMarkupHigh]: Fidelity.High,
  [ArmId.ParchmentMarkupLow]: Fidelity.Low,
  [ArmId.ParchmentJsonHigh]: Fidelity.High,
  [ArmId.ParchmentJsonLow]: Fidelity.Low,
  [ArmId.ScrambledMarkupHigh]: Fidelity.High,
  [ArmId.ScrambledMarkupLow]: Fidelity.Low,
  // Every rival format is structurally stuck on the low rung: none of them can
  // name a file and have something else fetch it.
  [ArmId.TerseJson]: Fidelity.Low,
  [ArmId.OpenUiLang]: Fidelity.Low,
  [ArmId.RawHtml]: Fidelity.Low,
  [ArmId.RawJsx]: Fidelity.Low,
};

// The arm whose authored output the ladder ratios are quoted against.
const LADDER_REFERENCE_ARM = ArmId.ParchmentMarkupHigh;

// Identical grammar, identical runtime, identical schema size — only the
// identifiers differ. Anything else would not be an ablation.
const ABLATION_PAIRS = [
  { rung: Fidelity.High, real: ArmId.ParchmentMarkupHigh, scrambled: ArmId.ScrambledMarkupHigh },
  { rung: Fidelity.Low, real: ArmId.ParchmentMarkupLow, scrambled: ArmId.ScrambledMarkupLow },
] as const;

const PASS_AT_K_LEVELS = { First: 1, WithinThree: 3 } as const;
const MAX_ATTEMPTS_PER_RUN = 1 + MAX_REPAIR_TURNS;
const RATIO_OF_NO_DIFFERENCE = 1;
const MAJORITY = 0.5;

// ---- Per-run metrics ---------------------------------------------------------

// Present only when the archive actually carries the authoring measurement.
// Archives written before it landed have no such field, and a silent `undefined`
// would sum to NaN and print as a number in the headline table.
type AuthoringMetrics = {
  // Every output token spent EMITTING an artifact, repairs included. A format
  // that needed three attempts paid for three artifacts.
  authoredOutputTokens: number;
  // The artifact that actually passed the browser rubric.
  passingAuthoredArtifactBytes: number | null;
  // Did the model reach for the reference component on ANY attempt?
  usedReference: boolean;
  referenceKindsUsed: readonly string[];
};

type RunMetrics = {
  armId: ArmId;
  scenarioId: string;
  model: EvalModel;
  passed: boolean;
  attemptsToPass: number | null;
  authoring: AuthoringMetrics | null;
  // SECONDARY: the whole session, agentic exploration included.
  sessionOutputTokens: number;
  systemPromptTokens: number;
  repairTokens: number;
  inputTokensRaw: number;
  inputTokensHarnessSubtracted: number | null;
  harnessWorkings: string | null;
  // The all-in agentic cost of reaching a correct render. Reported, and clearly
  // labelled — it is NOT the format comparison.
  sessionTotalTokens: number;
  coldCacheCostUsd: number;
  warmCacheCostUsd: number;
  reportedCostUsd: number;
  exercisesLadder: boolean;
};

// TypeScript says these fields are numbers. The JSON on disk may predate them,
// and the report must say NOT MEASURED rather than print a NaN in the headline.
function carriesAuthoringMeasurement(attempt: EvalAttemptRecord): boolean {
  return (
    typeof attempt.authoredOutputTokens === "number" &&
    Number.isFinite(attempt.authoredOutputTokens) &&
    typeof attempt.usedReference === "boolean" &&
    Array.isArray(attempt.referenceKindsUsed)
  );
}

// The ledger rightly assumes its own fields exist — summariseRun spreads
// referenceKindsUsed, which THROWS on an archive written before the authoring
// measurement landed. So the absent fields are neutralised before the ledger
// does its arithmetic, and the run is flagged unmeasured so that not one of
// these zeros can ever reach the page: every authored column prints NOT MEASURED
// instead. Neutralising for arithmetic is not backfilling, because the values
// are never read back out.
const AUTHORING_MEASUREMENT_ABSENT = {
  authoredOutputTokens: 0,
  authoredArtifactBytes: 0,
  renderCallCount: 0,
  usedReference: false,
  referenceKindsUsed: [],
} as const;

function withAuthoringMeasurementNeutralised(attempt: EvalAttemptRecord): EvalAttemptRecord {
  return { ...attempt, ...AUTHORING_MEASUREMENT_ABSENT };
}

function authoringMetricsOf(totals: RunTotals): AuthoringMetrics {
  return {
    authoredOutputTokens: totals.totalAuthoredOutputTokens,
    passingAuthoredArtifactBytes: totals.passingAuthoredArtifactBytes,
    usedReference: totals.usedReference,
    referenceKindsUsed: totals.referenceKindsUsed,
  };
}

function toRunMetrics(
  record: EvalRunRecord,
  scenariosById: ReadonlyMap<string, ScenarioSummary>,
  harnessConstantsByModel: ReportMeta["harnessConstantsByModel"],
): RunMetrics {
  const archivedAttempts = [...record.attempts].sort(byAttemptIndex);
  const authoringWasMeasured = archivedAttempts.every(carriesAuthoringMeasurement);
  const attempts = authoringWasMeasured
    ? archivedAttempts
    : archivedAttempts.map(withAuthoringMeasurementNeutralised);

  const [, ...repairAttempts] = attempts;

  const totals = summariseRun(attempts, record.systemPromptTokens);
  const cost = costOfRun(record.model, totals);
  const harness = harnessSubtractionFor(record, totals, harnessConstantsByModel);
  const scenario = scenariosById.get(record.scenarioId) ?? null;

  const repairPromptTokens = sumOf(repairAttempts, promptTokensOf);
  const repairOutputTokens = sumOf(repairAttempts, (attempt) => attempt.outputTokens);

  return {
    armId: record.armId,
    scenarioId: record.scenarioId,
    model: record.model,
    passed: totals.passed,
    attemptsToPass: totals.attemptsToPass,
    authoring: authoringWasMeasured ? authoringMetricsOf(totals) : null,
    sessionOutputTokens: totals.totalOutputTokens,
    systemPromptTokens: totals.systemPromptTokens,
    repairTokens: repairPromptTokens + repairOutputTokens,
    inputTokensRaw: totals.totalPromptTokens,
    inputTokensHarnessSubtracted: harness?.adjustedPromptTokens ?? null,
    harnessWorkings: harness?.workings ?? null,
    sessionTotalTokens: totals.systemPromptTokens + totals.totalOutputTokens + repairPromptTokens,
    coldCacheCostUsd: cost.coldCacheUsd,
    warmCacheCostUsd: cost.warmCacheUsd,
    reportedCostUsd: totals.totalReportedCostUsd,
    exercisesLadder: scenario?.exercisesLadder ?? false,
  };
}

// The constant is measured PER SURFACE, because the tool schemas differ: the
// canvas arms are sent canvas_render's schema, the file arms are sent Write's.
function harnessSubtractionFor(
  record: EvalRunRecord,
  totals: RunTotals,
  harnessConstantsByModel: ReportMeta["harnessConstantsByModel"],
): ReturnType<typeof subtractHarnessConstant> | null {
  const constant = harnessConstantsByModel[record.model];
  if (!constant) return null;

  return subtractHarnessConstant({
    rawPromptTokens: totals.totalPromptTokens,
    assistantTurnCount: totals.totalAssistantTurns,
    harnessConstantTokens: constant.promptTokensBySurface[armFor(record.armId).surface],
  });
}

// ---- Spend (used by the CLI) -------------------------------------------------

export type SpendSummary = {
  runs: number;
  reportedUsd: number;
  coldCacheUsd: number;
  warmCacheUsd: number;
};

// Cost never touches the authoring fields, but summariseRun still reads them, so
// a legacy archive is neutralised here too rather than throwing at a caller who
// only wanted a dollar figure.
export function summarizeSpend(records: readonly EvalRunRecord[]): SpendSummary {
  const costs = records.map((record) => {
    const attempts = record.attempts.map(withAuthoringMeasurementNeutralised);
    const totals = summariseRun(attempts, record.systemPromptTokens);
    return { totals, cost: costOfRun(record.model, totals) };
  });

  return {
    runs: records.length,
    reportedUsd: sumOf(costs, (entry) => entry.totals.totalReportedCostUsd),
    coldCacheUsd: sumOf(costs, (entry) => entry.cost.coldCacheUsd),
    warmCacheUsd: sumOf(costs, (entry) => entry.cost.warmCacheUsd),
  };
}

// ---- Cells -------------------------------------------------------------------

// Token and cost figures are computed over PASSING runs only: "tokens to a
// correct render" is undefined for a run that never rendered correctly. Pass
// rates and ladder-climbing rates are computed over ALL runs, and printed beside
// them, so a cheap arm that fails constantly cannot hide behind a small mean.
type Cell = {
  armId: ArmId;
  model: EvalModel;
  allRuns: readonly RunMetrics[];
  passingRuns: readonly RunMetrics[];
};

function toCells(metrics: readonly RunMetrics[]): Cell[] {
  const grouped = new Map<string, RunMetrics[]>();
  for (const metric of metrics) {
    const key = `${metric.armId}::${metric.model}`;
    const existing = grouped.get(key) ?? [];
    existing.push(metric);
    grouped.set(key, existing);
  }

  return [...grouped.values()].flatMap((runs) => {
    const [first] = runs;
    if (!first) return [];
    return [
      {
        armId: first.armId,
        model: first.model,
        allRuns: runs,
        passingRuns: runs.filter((run) => run.passed),
      },
    ];
  });
}

function passAtK(runs: readonly RunMetrics[], attemptLimit: number): number | null {
  if (runs.length === 0) return null;
  const passedWithinLimit = runs.filter(
    (run) => run.attemptsToPass !== null && run.attemptsToPass <= attemptLimit,
  );
  return passedWithinLimit.length / runs.length;
}

function valuesOf(runs: readonly RunMetrics[], selector: (run: RunMetrics) => number): number[] {
  return runs.map(selector);
}

// The headline sample: authored output tokens, over runs whose authoring was
// actually measured. An unmeasured run contributes nothing rather than a zero.
function authoredOutputsOf(runs: readonly RunMetrics[]): number[] {
  return runs.flatMap((run) => (run.authoring ? [run.authoring.authoredOutputTokens] : []));
}

function authoredBytesOf(runs: readonly RunMetrics[]): number[] {
  return runs.flatMap((run) => {
    const bytes = run.authoring?.passingAuthoredArtifactBytes;
    return typeof bytes === "number" ? [bytes] : [];
  });
}

// ---- Losses first ------------------------------------------------------------

export const LOSSES_HEADING = "**Where parchment loses**";
export const WINS_HEADING = "**Where parchment wins**";

const NOTHING_ON_THIS_METRIC = "- None on this metric in this run.";

type CellComparison = {
  scenarioId: string;
  model: EvalModel;
  parchmentArmId: ArmId;
  parchmentValue: number;
  rivalArmId: ArmId;
  rivalValue: number;
  // Above 1 means parchment spent MORE than the best rival: a loss.
  parchmentTimesTheRival: number;
};

// For every (scenario, model), each parchment arm is compared against the BEST
// rival in that same cell — never against an average of rivals, which would let
// a weak rival flatter us.
function compareParchmentToBestRival(
  metrics: readonly RunMetrics[],
  selector: (run: RunMetrics) => number | null,
): CellComparison[] {
  const comparisons: CellComparison[] = [];

  for (const group of groupByScenarioAndModel(metrics).values()) {
    const passing = group.filter((run) => run.passed);
    const bestRival = findBestRival(passing, selector);
    if (!bestRival || bestRival.value === 0) continue;

    for (const parchmentArmId of distinctArms(passing, ArmFamily.Parchment)) {
      const parchmentRuns = passing.filter((run) => run.armId === parchmentArmId);
      const parchmentValue = meanOrNull(selectValues(parchmentRuns, selector));
      const [first] = parchmentRuns;
      if (parchmentValue === null || !first) continue;

      comparisons.push({
        scenarioId: first.scenarioId,
        model: first.model,
        parchmentArmId,
        parchmentValue,
        rivalArmId: bestRival.armId,
        rivalValue: bestRival.value,
        parchmentTimesTheRival: parchmentValue / bestRival.value,
      });
    }
  }

  return comparisons;
}

function findBestRival(
  runs: readonly RunMetrics[],
  selector: (run: RunMetrics) => number | null,
): { armId: ArmId; value: number } | null {
  const rivalMeans = distinctArms(runs, ArmFamily.Rival).flatMap((armId) => {
    const armRuns = runs.filter((run) => run.armId === armId);
    const armMean = meanOrNull(selectValues(armRuns, selector));
    if (armMean === null) return [];
    return [{ armId, value: armMean }];
  });

  const sortedByValue = [...rivalMeans].sort((left, right) => left.value - right.value);
  return sortedByValue[0] ?? null;
}

function buildLossesAndWins(
  comparisons: readonly CellComparison[],
  unitLabel: string,
  formatValue: (value: number) => string,
): string {
  const losses = comparisons
    .filter((comparison) => comparison.parchmentTimesTheRival > RATIO_OF_NO_DIFFERENCE)
    .sort((left, right) => right.parchmentTimesTheRival - left.parchmentTimesTheRival);
  const wins = comparisons
    .filter((comparison) => comparison.parchmentTimesTheRival < RATIO_OF_NO_DIFFERENCE)
    .sort((left, right) => left.parchmentTimesTheRival - right.parchmentTimesTheRival);

  const lossLines = losses.map((entry) => formatComparisonLine(entry, unitLabel, formatValue));
  const winLines = wins.map((entry) => formatComparisonLine(entry, unitLabel, formatValue));

  return [
    LOSSES_HEADING,
    "",
    ...(lossLines.length > 0 ? lossLines : [NOTHING_ON_THIS_METRIC]),
    "",
    WINS_HEADING,
    "",
    ...(winLines.length > 0 ? winLines : [NOTHING_ON_THIS_METRIC]),
  ].join("\n");
}

function formatComparisonLine(
  comparison: CellComparison,
  unitLabel: string,
  formatValue: (value: number) => string,
): string {
  const parchmentLost = comparison.parchmentTimesTheRival > RATIO_OF_NO_DIFFERENCE;
  const magnitude = parchmentLost
    ? comparison.parchmentTimesTheRival
    : RATIO_OF_NO_DIFFERENCE / comparison.parchmentTimesTheRival;
  const verdict = parchmentLost ? "worse" : "better";

  return (
    `- \`${comparison.parchmentArmId}\` on **${comparison.scenarioId}** (${comparison.model}): ` +
    `${formatValue(comparison.parchmentValue)} ${unitLabel} vs \`${comparison.rivalArmId}\` ` +
    `${formatValue(comparison.rivalValue)} — parchment is **${formatTimes(magnitude)} ${verdict}**.`
  );
}

// ---- The report --------------------------------------------------------------

export function buildReportMarkdown(input: ReportInput): string {
  const scenariosById = new Map(input.meta.scenarios.map((scenario) => [scenario.id, scenario]));
  const metrics = input.records.map((record) =>
    toRunMetrics(record, scenariosById, input.meta.harnessConstantsByModel),
  );
  const cells = toCells(metrics);

  const sections = [
    buildHeaderSection(input.records, input.meta),
    buildWhatWeMeasureSection(),
    buildHeadlineSection(metrics, cells, input.meta),
    buildLadderClimbingSection(metrics),
    buildLadderSection(metrics, input.density, input.meta),
    buildDecompositionSection(cells),
    buildAblationSection(metrics, input.meta),
    buildDensitySection(input.density, input.densityAudit),
    buildCostSection(metrics, cells),
    buildMethodologySection(input.meta, metrics),
  ];

  return `${sections.join("\n\n")}\n`;
}

function buildHeaderSection(records: readonly EvalRunRecord[], meta: ReportMeta): string {
  const arms = new Set(records.map((record) => record.armId));
  const scenarios = new Set(records.map((record) => record.scenarioId));
  const models = new Set(records.map((record) => record.model));

  return [
    "# Authored output tokens to a browser-verified render",
    "",
    `- Generated: ${meta.generatedAt}`,
    `- Runs: ${records.length} across ${arms.size} arms x ${scenarios.size} scenarios x ${models.size} models`,
    `- Archive (every number below is reproducible offline from it): \`${meta.archiveRelativePath}\``,
    `- Confidence intervals: percentile bootstrap, ${formatCount(meta.bootstrap.resamples)} resamples, ` +
      `${formatPercent(meta.bootstrap.confidence)}, seed \`${meta.bootstrap.seed}\` — deterministic. ` +
      "Proportions use a Wilson score interval.",
    "",
    "Acceptance is decided by a real headless browser against a DOM rubric that never imports",
    "parchment code. An arm passes when the page it produced actually paints the required content.",
  ].join("\n");
}

function buildWhatWeMeasureSection(): string {
  return [
    "## What we measure, and what we refuse to measure",
    "",
    "**THE HEADLINE — authored output tokens.** The output tokens of the single assistant message",
    "that carried the render call (`canvas_render` for the catalog arms, `Write` for raw-html and",
    "raw-jsx). This is the cost of EMITTING the artifact, measured by the same rule for every arm and",
    "read exactly from the transcript. Repairs count: a format that needed three attempts paid for",
    "three artifacts.",
    "",
    "**THE SECONDARY NUMBER — session output tokens.** Everything the model emitted: reading files,",
    "running git, thinking, retrying. This is real money and it is published in full (see Session",
    "cost). But it is dominated by AGENTIC EXPLORATION, which is a property of the task and the",
    "harness, not of the format. In the first pilot, one high-fidelity run burned over 11,000 session",
    "output tokens across 11 assistant turns while the artifact it authored cost a small fraction of",
    "that. Leading with that number would have measured how chatty the agent was and called it a",
    "format comparison. Both numbers appear here; neither wears the other's label.",
    "",
    "```",
    "authored_output_tokens(run) = output tokens of the render-call message, summed over attempts",
    "session_total_tokens(run)   = system/schema + session output + repair-turn input",
    "```",
    "",
    "The initial authoring turn's INPUT is in neither total: it is dominated by a harness constant",
    "that every arm on the same surface pays identically. It is not swept away either — it is printed",
    "raw and harness-subtracted in the decomposition table.",
  ].join("\n");
}

function buildHeadlineSection(
  metrics: readonly RunMetrics[],
  cells: readonly Cell[],
  meta: ReportMeta,
): string {
  const comparisons = compareParchmentToBestRival(
    metrics,
    (run) => run.authoring?.authoredOutputTokens ?? null,
  );
  const lossesAndWins = buildLossesAndWins(comparisons, "authored output tokens", formatCount);

  const rows = sortCellsBy(cells, (run) => run.authoring?.authoredOutputTokens ?? null).map(
    (cell) => {
      const authored = authoredOutputsOf(cell.passingRuns);
      const authoredSummary = summarize(authored);

      return [
        `\`${cell.armId}\``,
        ARM_FIDELITY[cell.armId],
        cell.model,
        `${cell.passingRuns.length}/${cell.allRuns.length}`,
        formatPercentOrNa(passAtK(cell.allRuns, PASS_AT_K_LEVELS.First)),
        formatMeanOrNotMeasured(authoredSummary, formatCount),
        formatInterval(bootstrapConfidenceInterval(authored, mean, meta.bootstrap), formatCount),
        formatMedianOrNotMeasured(authoredSummary, formatCount),
        formatSpreadOrNotMeasured(authoredSummary, formatCount),
        formatMeanOrNotMeasured(summarize(authoredBytesOf(cell.passingRuns)), formatCount),
      ];
    },
  );

  const table = renderMarkdownTable(
    [
      "Arm",
      "Rung",
      "Model",
      "Passed/N",
      "pass@1",
      "AUTHORED output tokens (mean)",
      "95% CI",
      "median",
      "min–max",
      "Artifact bytes (EXACT, mean)",
    ],
    rows,
  );

  return [
    "## HEADLINE: authored output tokens to a correct render",
    "",
    "The cost of EMITTING the artifact — not the cost of the agent's exploration, which is reported",
    "separately under Session cost. Token columns cover PASSING runs only: a run that never rendered",
    "correctly has no cost-to-a-correct-render. Pass rate sits beside them so a cheap arm that fails",
    "cannot hide. Bytes are exact; tokens are measured from the transcript, not approximated.",
    "",
    ...coverageWarningLines(cells),
    lossesAndWins,
    "",
    table,
  ].join("\n");
}

// A row in this table is an arm's mean ACROSS the scenarios it ran. If two arms
// ran different scenario sets, their means are not comparable to each other, and
// saying so is cheaper than letting a reader assume otherwise.
function coverageWarningLines(cells: readonly Cell[]): string[] {
  const scenariosByArm = new Map<ArmId, Set<string>>();
  for (const cell of cells) {
    const scenarios = scenariosByArm.get(cell.armId) ?? new Set<string>();
    for (const run of cell.allRuns) scenarios.add(run.scenarioId);
    scenariosByArm.set(cell.armId, scenarios);
  }

  const coverageSignatures = new Set(
    [...scenariosByArm.values()].map((scenarios) => [...scenarios].sort().join(",")),
  );
  if (coverageSignatures.size <= 1) return [];

  return [
    "> **Not every arm ran every scenario in this archive**, so the means in this table pool",
    "> different scenario mixes and are NOT directly comparable across rows. The per-scenario",
    "> comparisons below, and the ladder table, are like-for-like.",
    "",
  ];
}

// ---- Did the model climb the ladder? -----------------------------------------

// THE RESULT THAT MAY SINK THE THESIS, AND IT GOES NEAR THE TOP.
//
// The fidelity ladder only pays off if the model actually REACHES for the
// reference component. A high-fidelity arm whose prompt documents `GitDiff
// file="..."` and which pastes the whole file anyway has proven that the
// compression is AVAILABLE and UNTAKEN — a negative result for the product
// thesis, not a rounding error. It is written to read as plainly as a positive
// one would.
function buildLadderClimbingSection(metrics: readonly RunMetrics[]): string {
  const ladderRuns = metrics.filter((run) => run.exercisesLadder);
  if (ladderRuns.length === 0) {
    return ["## Did the model climb the ladder?", "", "No ladder scenarios were run."].join("\n");
  }

  // The verdict is about the PRODUCT's high-fidelity arms. The scrambled arm is a
  // deliberately sabotaged control: pooling it in would dilute a real failure and
  // understate a real climb. Its behaviour is reported in the table below, and
  // compared like-for-like in the ablation.
  const productClimbRuns = ladderRuns.filter(
    (run) => ARM_FIDELITY[run.armId] === Fidelity.High && ARM_FAMILY[run.armId] === ArmFamily.Parchment,
  );
  const table = renderMarkdownTable(
    ["Scenario", "Arm", "Rung", "Model", "Climbed", "Rate", "95% CI (Wilson)", "Reference used"],
    buildClimbRows(ladderRuns),
  );

  return [
    "## Did the model climb the ladder?",
    "",
    "A high-fidelity arm is TOLD, in its system prompt, that it can name a file and have the daemon",
    "fetch the bytes. This section asks whether it actually did. The rate is over ALL runs, not just",
    "passing ones: a run that failed still shows whether the model reached for the reference.",
    "",
    "**This is the result most likely to sink the thesis, so it is printed before the win.** If the",
    'compression is available and the model does not take it, the honest headline is not "parchment',
    'is 30x cheaper" — it is "parchment COULD be 30x cheaper, and the model does not do it".',
    "",
    ...buildClimbVerdicts(productClimbRuns),
    "",
    table,
    "",
    "Intervals are Wilson score intervals. A rate of 0/3 or 3/3 is exactly where the normal",
    "approximation collapses to zero width and claims certainty from three observations; Wilson keeps",
    "an honest width there.",
  ].join("\n");
}

function buildClimbVerdicts(productClimbRuns: readonly RunMetrics[]): string[] {
  if (productClimbRuns.length === 0) {
    return ["_No high-fidelity parchment arm ran a ladder scenario._"];
  }

  const measured = productClimbRuns.filter((run) => run.authoring !== null);
  if (measured.length === 0) {
    return [
      "- **NOT MEASURED.** This archive predates the `usedReference` measurement. Re-run the matrix; " +
        "nothing here is backfilled.",
    ];
  }

  const climbed = measured.filter((run) => run.authoring?.usedReference === true).length;
  const estimate = wilsonInterval(climbed, measured.length);
  if (estimate.status !== EstimateStatus.Ok) {
    return [`- **Insufficient data** (${estimate.reason}).`];
  }

  const rate =
    `${climbed}/${measured.length} (${formatPercent(estimate.point)}, 95% CI ` +
    `${formatPercent(estimate.lowerBound)}–${formatPercent(estimate.upperBound)})`;

  if (climbed === 0) {
    return [
      "- **NEGATIVE RESULT — the model NEVER climbed the ladder.** High-fidelity arms reached for a " +
        `reference component in ${rate} of their ladder runs. The prompt documented it; the model ` +
        "pasted the file anyway.",
      "- **What that means:** the ladder's compression is real and AVAILABLE, and the model does not " +
        "take it. Any authored-token win below was earned by the notation, not by the ladder. The " +
        "ladder is, as of this run, a product opportunity — NOT a measured result — and it must not " +
        "be quoted as one.",
    ];
  }

  if (estimate.upperBound < MAJORITY) {
    return [
      `- **NEGATIVE RESULT — the model rarely climbed the ladder.** ${rate}. Even the optimistic end ` +
        "of the interval sits below half, so this is not noise.",
      "- The compression is available and mostly untaken. Treat the ladder as an opportunity, not a " +
        "result.",
    ];
  }

  if (estimate.lowerBound > MAJORITY) {
    return [
      "- **The model climbed the ladder.** High-fidelity arms reached for a reference component in " +
        `${rate} of their ladder runs, and the interval clears half. The authored-token win below is ` +
        "the ladder's, not just the notation's.",
    ];
  }

  return [
    `- **INCONCLUSIVE.** ${rate}. The interval straddles half: at this N we cannot say whether the ` +
      "model reliably climbs. Raise `--replicates` before quoting the ladder as a result.",
  ];
}

function buildClimbRows(ladderRuns: readonly RunMetrics[]): string[][] {
  const groups = new Map<string, RunMetrics[]>();
  for (const run of ladderRuns) {
    const key = `${run.scenarioId}::${run.armId}::${run.model}`;
    const existing = groups.get(key) ?? [];
    existing.push(run);
    groups.set(key, existing);
  }

  return [...groups.values()].flatMap((runs) => {
    const [first] = runs;
    if (!first) return [];

    const identity = [
      first.scenarioId,
      `\`${first.armId}\``,
      ARM_FIDELITY[first.armId],
      first.model,
    ];

    const measured = runs.filter((run) => run.authoring !== null);
    if (measured.length === 0) {
      return [[...identity, NOT_MEASURED, NOT_MEASURED, NOT_MEASURED, NOT_MEASURED]];
    }

    const climbed = measured.filter((run) => run.authoring?.usedReference === true);
    const kinds = [
      ...new Set(measured.flatMap((run) => [...(run.authoring?.referenceKindsUsed ?? [])])),
    ];

    return [
      [
        ...identity,
        `${climbed.length}/${measured.length}`,
        formatPercent(climbed.length / measured.length),
        formatProportionInterval(wilsonInterval(climbed.length, measured.length)),
        kinds.length > 0 ? kinds.map((kind) => `\`${kind}\``).join(", ") : "none",
      ],
    ];
  });
}

// ---- The fidelity ladder -----------------------------------------------------

// THREE NUMBERS, NEVER CONFLATED:
//   (a) what the arm COULD have emitted — the reference artifact. A static floor.
//   (b) what the model ACTUALLY emitted — measured authored tokens.
//   (c) what an arm with NO reference mechanism MUST emit — measured.
// (a)->(b) is the product's opportunity. (b)->(c) is the format's realised win.
// Publishing (a) as if it were (b) is the exact sin this eval exists to expose in
// other people's benchmarks. We do not get to commit it.
function buildLadderSection(
  metrics: readonly RunMetrics[],
  density: readonly ArtifactMeasurement[],
  meta: ReportMeta,
): string {
  const ladderRuns = metrics.filter((run) => run.exercisesLadder);
  if (ladderRuns.length === 0) {
    return ["## The fidelity ladder", "", "No ladder scenarios were run."].join("\n");
  }

  const comparisons = compareParchmentToBestRival(
    ladderRuns,
    (run) => run.authoring?.authoredOutputTokens ?? null,
  );
  const lossesAndWins = buildLossesAndWins(comparisons, "authored output tokens", formatCount);
  const referenceArmOutputs = authoredOutputsOf(
    ladderRuns.filter((run) => run.armId === LADDER_REFERENCE_ARM && run.passed),
  );

  const rows = sortCellsBy(
    toCells(ladderRuns),
    (run) => run.authoring?.authoredOutputTokens ?? null,
  ).map((cell) => {
    const authored = authoredOutputsOf(cell.passingRuns);
    const canClimb = ARM_FIDELITY[cell.armId] === Fidelity.High;

    return [
      `\`${cell.armId}\``,
      ARM_FIDELITY[cell.armId],
      cell.model,
      `${cell.passingRuns.length}/${cell.allRuns.length}`,
      canClimb ? referenceFloorFor(cell.armId, density) : "none — no reference mechanism",
      formatMeanOrNotMeasured(summarize(authored), formatCount),
      formatInterval(bootstrapConfidenceInterval(authored, mean, meta.bootstrap), formatCount),
      formatInterval(bootstrapRatio(authored, referenceArmOutputs, meta.bootstrap), formatTimes),
    ];
  });

  const table = renderMarkdownTable(
    [
      "Arm",
      "Rung",
      "Model",
      "Passed/N",
      "(a) COULD have emitted",
      "(b) ACTUALLY emitted",
      "95% CI",
      `x vs \`${LADDER_REFERENCE_ARM}\` (95% CI)`,
    ],
    rows,
  );

  return [
    "## The fidelity ladder",
    "",
    "Ladder scenarios keep the source data on disk. A high-fidelity arm MAY reference it by path; a",
    "low-fidelity arm and every rival format MUST read it and paste it into the artifact.",
    "",
    "Three different numbers live in this table, and they are never added together or swapped:",
    "",
    "- **(a) COULD have emitted** — the reference artifact: a static, hand-written floor. Bytes exact,",
    "  tokens APPROXIMATE. This is what the arm was *able* to write. It is NOT a measurement of what",
    "  any model did, and it is never quoted as one.",
    "- **(b) ACTUALLY emitted** — measured authored output tokens, read from the transcript.",
    "- **(c) MUST emit** — the same measured column, read on `raw-html` / `raw-jsx`, which have no",
    "  reference mechanism at all.",
    "",
    "**The gap between (a) and (b) is the product's opportunity. The gap between (b) and (c) is the",
    "format's realised win.** Read the ladder-climbing section above before this table: if the model",
    "did not climb, then (a) is a hypothetical and only (b) vs (c) is a result.",
    "",
    lossesAndWins,
    "",
    table,
  ].join("\n");
}

// The static floor, taken ONLY from a hand-written reference artifact on disk. An
// artifact pulled from a RUN is what the model DID emit, not what it COULD have —
// using one here would collapse (a) into (b) and publish a hypothetical as a
// measurement.
function referenceFloorFor(armId: ArmId, density: readonly ArtifactMeasurement[]): string {
  const floors = density.filter(
    (measurement) =>
      measurement.armId === armId && measurement.origin === ArtifactOrigin.ReferenceFile,
  );

  const bytes = summarize(floors.map((floor) => floor.bytes));
  const tokens = summarize(floors.map((floor) => floor.approximateTokens));
  if (!bytes || !tokens) return NOT_MEASURED;

  return `${formatCount(bytes.mean)} B / ~${formatCount(tokens.mean)} tok (approx.)`;
}

function buildDecompositionSection(cells: readonly Cell[]): string {
  const rows = sortCellsBy(cells, (run) => run.sessionTotalTokens).map((cell) => {
    const passing = cell.passingRuns;
    const subtracted = passing
      .map((run) => run.inputTokensHarnessSubtracted)
      .filter((value): value is number => value !== null);

    return [
      `\`${cell.armId}\``,
      cell.model,
      `${passing.length}/${cell.allRuns.length}`,
      formatMeanOrNotMeasured(summarize(authoredOutputsOf(passing)), formatCount),
      formatMean(summarize(valuesOf(passing, (run) => run.sessionOutputTokens)), formatCount),
      formatMean(summarize(valuesOf(passing, (run) => run.systemPromptTokens)), formatCount),
      formatMean(summarize(valuesOf(passing, (run) => run.repairTokens)), formatCount),
      formatMean(summarize(valuesOf(passing, (run) => run.inputTokensRaw)), formatCount),
      formatMeanOrNotMeasured(summarize(subtracted), formatCount),
      formatPercentOrNa(passAtK(cell.allRuns, PASS_AT_K_LEVELS.First)),
      formatPercentOrNa(passAtK(cell.allRuns, PASS_AT_K_LEVELS.WithinThree)),
    ];
  });

  const table = renderMarkdownTable(
    [
      "Arm",
      "Model",
      "Passed/N",
      "AUTHORED output",
      "SESSION output (exploration incl.)",
      "System/schema",
      "Repair turns (in+out)",
      "Input RAW",
      "Input harness-subtracted",
      "pass@1",
      "pass@3",
    ],
    rows,
  );

  return [
    "## Decomposition",
    "",
    "The two output columns are the whole argument of this page. **AUTHORED** is the format's cost.",
    "**SESSION** is the agent's cost: it includes reading the file, running git, and thinking, and it",
    "is a property of the task and the harness far more than of the format. Both are real; only the",
    "first one compares formats.",
    "",
    table,
  ].join("\n");
}

function buildAblationSection(metrics: readonly RunMetrics[], meta: ReportMeta): string {
  const models = modelsPresentIn(metrics);
  const rows = ABLATION_PAIRS.flatMap((pair) =>
    models.map((model) => buildAblationRow(pair, model, metrics, meta)),
  ).filter((row) => row.length > 0);

  const verdicts = ABLATION_PAIRS.flatMap((pair) =>
    models.map((model) => buildAblationVerdict(pair, model, metrics, meta)),
  ).filter((verdict) => verdict.length > 0);

  const table = renderMarkdownTable(
    [
      "Rung",
      "Model",
      "Real vocab AUTHORED (mean)",
      "Scrambled AUTHORED (mean)",
      "Scrambled / real (95% CI)",
      "Real pass@1",
      "Scrambled pass@1",
      "Real climbed",
      "Scrambled climbed",
    ],
    rows,
  );

  return [
    "## Ablation: real vocabulary vs scrambled vocabulary",
    "",
    "Same grammar, same runtime, same schema size. Only the identifiers are opaque. The question is",
    "whether the model's familiarity with real component names is worth anything, or whether the",
    "structure is doing all of the work.",
    "",
    "**A null result is a result.** An interval that brackets 1.00x means familiarity bought nothing",
    "measurable at this N, and it is reported as exactly that.",
    "",
    "The last two columns carry the BEHAVIOURAL half of the ablation: on ladder scenarios, did the",
    "scrambled arm still reach for the high-fidelity component, or did it fall back to pasting?",
    "",
    ...(verdicts.length > 0 ? verdicts : ["_No arm pair had runs on both sides._"]),
    "",
    table,
  ].join("\n");
}

type AblationPair = (typeof ABLATION_PAIRS)[number];

function buildAblationRow(
  pair: AblationPair,
  model: EvalModel,
  metrics: readonly RunMetrics[],
  meta: ReportMeta,
): string[] {
  const realRuns = runsOf(metrics, pair.real, model);
  const scrambledRuns = runsOf(metrics, pair.scrambled, model);
  if (realRuns.length === 0 && scrambledRuns.length === 0) return [];

  const realAuthored = authoredOutputsOf(realRuns.filter((run) => run.passed));
  const scrambledAuthored = authoredOutputsOf(scrambledRuns.filter((run) => run.passed));

  return [
    pair.rung,
    model,
    formatMeanOrNotMeasured(summarize(realAuthored), formatCount),
    formatMeanOrNotMeasured(summarize(scrambledAuthored), formatCount),
    formatInterval(bootstrapRatio(scrambledAuthored, realAuthored, meta.bootstrap), formatTimes),
    formatPercentOrNa(passAtK(realRuns, PASS_AT_K_LEVELS.First)),
    formatPercentOrNa(passAtK(scrambledRuns, PASS_AT_K_LEVELS.First)),
    formatClimbRate(realRuns),
    formatClimbRate(scrambledRuns),
  ];
}

function formatClimbRate(runs: readonly RunMetrics[]): string {
  const ladderRuns = runs.filter((run) => run.exercisesLadder && run.authoring !== null);
  if (ladderRuns.length === 0) return NOT_APPLICABLE;

  const climbed = ladderRuns.filter((run) => run.authoring?.usedReference === true).length;
  return `${climbed}/${ladderRuns.length}`;
}

function buildAblationVerdict(
  pair: AblationPair,
  model: EvalModel,
  metrics: readonly RunMetrics[],
  meta: ReportMeta,
): string {
  const realAuthored = authoredOutputsOf(passingRunsOf(metrics, pair.real, model));
  const scrambledAuthored = authoredOutputsOf(passingRunsOf(metrics, pair.scrambled, model));
  const ratio = bootstrapRatio(scrambledAuthored, realAuthored, meta.bootstrap);
  const label = `\`${pair.scrambled}\` vs \`${pair.real}\` (${model}, authored output)`;

  if (ratio.status !== EstimateStatus.Ok) {
    return `- ${label}: **insufficient data** (${ratio.reason}).`;
  }

  const interval = `${formatTimes(ratio.lowerBound)}–${formatTimes(ratio.upperBound)}`;
  const bracketsNoDifference =
    ratio.lowerBound <= RATIO_OF_NO_DIFFERENCE && ratio.upperBound >= RATIO_OF_NO_DIFFERENCE;

  if (bracketsNoDifference) {
    return (
      `- ${label}: **NULL RESULT** — ${formatTimes(ratio.point)} (95% CI ${interval}) brackets 1.00x. ` +
      "Scrambling the vocabulary changed nothing measurable. Familiarity with the real component " +
      "names is worth **nothing** at this N; the grammar is doing the work."
    );
  }

  if (ratio.lowerBound > RATIO_OF_NO_DIFFERENCE) {
    return (
      `- ${label}: scrambling COST ${formatTimes(ratio.point)} more authored output ` +
      `(95% CI ${interval}). Familiarity with the real names is worth something.`
    );
  }

  return (
    `- ${label}: scrambling was CHEAPER — ${formatTimes(ratio.point)} (95% CI ${interval}). ` +
    "This is evidence AGAINST the familiarity hypothesis and is printed first for that reason."
  );
}

function buildDensitySection(
  measurements: readonly ArtifactMeasurement[],
  audit: ApproximationAudit | null,
): string {
  if (measurements.length === 0) {
    return [
      "## Format density (notation cost per artifact)",
      "",
      "_No canonical artifacts were available: no reference artifacts on disk, and no accepted runs",
      "in the archive._",
    ].join("\n");
  }

  const sorted = [...measurements].sort((left, right) => left.bytes - right.bytes);
  const rows = sorted.map((measurement) => [
    measurement.scenarioId,
    `\`${measurement.armId}\``,
    measurement.origin,
    formatCount(measurement.bytes),
    `~${formatCount(measurement.approximateTokens)}`,
    `~${formatCount(measurement.approximateTokensByBytesRule)}`,
  ]);

  const table = renderMarkdownTable(
    [
      "Scenario",
      "Arm",
      "Artifact source",
      "Bytes (EXACT)",
      `Tokens (${TOKEN_APPROXIMATION.label}, segmentation)`,
      `Tokens (${TOKEN_APPROXIMATION.label}, bytes/4)`,
    ],
    rows,
  );

  return [
    "## Format density (notation cost per artifact)",
    "",
    "This is the table where the terse formats are expected to WIN, and it is sorted densest-first so",
    "they appear at the top. It is printed plainly because it does not decide the argument: density is",
    "a per-character property, while the fidelity ladder is a per-ELEMENT property. A notation that",
    "spells a diff in 20% fewer characters still has to spell the whole diff.",
    "",
    "**Bytes are exact. TOKEN COLUMNS ARE APPROXIMATIONS, not model tokenization.** No tokenizer is",
    "reachable offline here (subscription-only Claude Code, no Console API key), so these columns are",
    "computed, not measured. The HEADLINE authored-token numbers do NOT come from here — they are read",
    "from the transcripts and are exact. These approximations are load-bearing for exactly one thing:",
    "the static reference floor, column (a) of the ladder table, which is labelled approximate there.",
    "",
    `- Method: ${TOKEN_APPROXIMATION.method}`,
    `- Known error: ${TOKEN_APPROXIMATION.knownError}`,
    ...(audit ? [`- Sanity check: ${formatDensityAudit(audit)}`] : []),
    "",
    table,
  ].join("\n");
}

function formatDensityAudit(audit: ApproximationAudit): string {
  return (
    `across ${audit.runsCompared} single-attempt passing runs, the approximated artifact accounts ` +
    `for ${formatPercent(audit.meanRatioToMeasuredOutput)} of the MEASURED session output tokens on ` +
    `average (range ${formatPercent(audit.minRatio)}–${formatPercent(audit.maxRatio)}). Values well ` +
    "under 100% are expected: the session also paid for exploration the artifact never contained."
  );
}

function buildCostSection(metrics: readonly RunMetrics[], cells: readonly Cell[]): string {
  const comparisons = compareParchmentToBestRival(metrics, (run) => run.warmCacheCostUsd);
  const lossesAndWins = buildLossesAndWins(comparisons, "per correct render (warm)", formatUsd);

  const rows = sortCellsBy(cells, (run) => run.sessionTotalTokens).map((cell) => {
    const passing = cell.passingRuns;
    return [
      `\`${cell.armId}\``,
      cell.model,
      `${passing.length}/${cell.allRuns.length}`,
      formatMean(summarize(valuesOf(passing, (run) => run.sessionTotalTokens)), formatCount),
      formatMean(summarize(valuesOf(passing, (run) => run.coldCacheCostUsd)), formatUsd),
      formatMean(summarize(valuesOf(passing, (run) => run.warmCacheCostUsd)), formatUsd),
      formatMean(summarize(valuesOf(passing, (run) => run.reportedCostUsd)), formatUsd),
      formatUsd(sumOf(cell.allRuns, (run) => run.coldCacheCostUsd)),
    ];
  });

  const table = renderMarkdownTable(
    [
      "Arm",
      "Model",
      "Passed/N",
      "SESSION tokens to correct render",
      "Cold-cache $",
      "Warm-cache $",
      "CLI-reported $",
      "Cold spend incl. failures (total)",
    ],
    rows,
  );

  return [
    "## Session cost (the agent's bill, not the format's)",
    "",
    "**This is the money, and it is NOT the format comparison.** These numbers include every token the",
    "agent spent exploring — reading the file, running git, thinking, retrying. They are the honest",
    'answer to "what did this cost me", and a misleading answer to "which format is cheaper", because',
    "a chatty agent and an expensive format are indistinguishable in this column. The format",
    "comparison is the HEADLINE table.",
    "",
    "Both cache numbers are true. **Cold-cache** prices every cache-read token as if it were fresh",
    "input: on the first call of the day nobody's cache is warm. **Warm-cache** prices cache reads at",
    "the cache-read rate — the steady state a returning user pays.",
    "",
    "The CLI-reported column is Claude Code's own figure, printed so our arithmetic can be checked",
    "against it. It is known to under-report on cached turns; where it disagrees, the token math is",
    "the number to trust.",
    "",
    lossesAndWins,
    "",
    table,
  ].join("\n");
}

// ---- Methodology --------------------------------------------------------------

function buildMethodologySection(meta: ReportMeta, metrics: readonly RunMetrics[]): string {
  return [
    "## Methodology (for a hostile reader)",
    "",
    buildNotShippedSubsection(),
    "",
    buildModelSubsection(meta, metrics),
    "",
    buildPromptsSubsection(meta),
    "",
    buildAuthoredMetricSubsection(),
    "",
    buildRepairSubsection(),
    "",
    buildHarnessSubsection(meta, metrics),
    "",
    buildIntervalSubsection(meta),
    "",
    buildUncontrolledSubsection(),
    "",
    buildNotTestedSubsection(),
    "",
    buildFalsificationSubsection(),
  ].join("\n");
}

// The single most misreadable thing on this page, so it is the FIRST thing in the
// methodology rather than a footnote.
function buildNotShippedSubsection(): string {
  return [
    "### WHAT IS NOT SHIPPED",
    "",
    "**The high-fidelity reference components are not in parchment's shipped catalog.** `GitDiff` and",
    "`LogStream` do not exist in the product at all. `DataTable src=` and `CodeBlock file=` are",
    "reference-prop forms the shipped catalog does not accept. They are AUTHORING-side intents, and",
    "this eval's own resolver (`evals/hydration/resolvers.ts`) lowers them into real catalog",
    "components (DiffViewer, Chart, DataTable, CodeBlock) whose props the model never had to emit. The",
    "real hydration engine lives on an unmerged branch.",
    "",
    "So, precisely:",
    "",
    "- **REAL, and what this eval measures:** what the model had to EMIT to reach a correct render.",
    "  Those tokens were really spent by a real model, and the page really painted in a real browser.",
    "- **NOT YET REAL:** the daemon fulfilling those references in production. A user cannot do this",
    "  today.",
    "",
    'Any claim of the form "parchment renders a diff in 50 tokens" is a claim about a product that',
    "does not exist yet. Read every ladder number with that sentence in front of you.",
  ].join("\n");
}

function buildModelSubsection(meta: ReportMeta, metrics: readonly RunMetrics[]): string {
  const modelLines = modelsPresentIn(metrics).map((model) => {
    const exactId = meta.modelIds[model] ?? "NOT RECORDED IN THE ARCHIVE";
    return `- \`${model}\` -> \`${exactId}\``;
  });

  return [
    "### Exact models",
    "",
    ...modelLines,
    `- Claude Code version: ${meta.claudeCliVersion ?? "NOT RECORDED IN THE ARCHIVE"}`,
    "- Prices are the published per-million rates in `evals/config.ts`.",
  ].join("\n");
}

function buildPromptsSubsection(meta: ReportMeta): string {
  return [
    "### Exact prompts",
    "",
    "Every arm's system prompt, every task prompt, the session JSONL, and the artifact the model",
    `produced were archived verbatim with the run that used them, under \`${meta.archiveRelativePath}\`.`,
    "Nothing here was typed by hand: regenerate it with `bun run evals/cli.ts report --from <archive>`",
    "and every number reappears, including the confidence intervals, which are seeded.",
  ].join("\n");
}

function buildAuthoredMetricSubsection(): string {
  return [
    "### How the headline number is measured",
    "",
    "`authoredOutputTokens` is the output-token count of the single assistant message that carried the",
    "render call — `canvas_render` for the catalog arms, `Write` for raw-html and raw-jsx. It is read",
    "from the transcript, not estimated from a character count, and it is derived by the SAME rule for",
    "every arm. It is summed across attempts, so a format that needed three tries pays for three",
    "artifacts. An attempt that never authored anything contributes 0: it did not pay the format's",
    "cost, because it never produced the format.",
    "",
    "`usedReference` is set when the artifact the model emitted into the tool call actually used a",
    "reference component. It is read from what was emitted — not inferred from the artifact's size.",
    "",
    "An archive that predates these fields prints **NOT MEASURED**. Nothing is backfilled or",
    "reconstructed after the fact.",
  ].join("\n");
}

function buildRepairSubsection(): string {
  return [
    "### How repairs were counted",
    "",
    "A failed artifact is handed back to the model with its OWN toolchain's error signal (its",
    "compiler's issues, its validator's issues, the browser's console errors) plus the rubric's",
    `"missing from the page" list, phrased identically for every arm. Up to ${MAX_REPAIR_TURNS} repair`,
    `turns are allowed, so a run is at most ${MAX_ATTEMPTS_PER_RUN} attempts, and a repair resumes the`,
    "same session so the model can see what it wrote. `pass@1` is the fraction of runs whose FIRST",
    "attempt was accepted; `pass@3` is the fraction accepted within three attempts.",
  ].join("\n");
}

function buildHarnessSubsection(meta: ReportMeta, metrics: readonly RunMetrics[]): string {
  const constantLines = modelsPresentIn(metrics).flatMap((model) => {
    const constant = meta.harnessConstantsByModel[model];
    if (!constant) return [`- \`${model}\`: **NOT MEASURED for this archive.**`];

    return Object.values(AuthoringSurface).map(
      (surface) =>
        `- \`${model}\` / \`${surface}\`: ${formatCount(constant.promptTokensBySurface[surface])} tokens`,
    );
  });

  const workingsExample = metrics.find((run) => run.harnessWorkings !== null)?.harnessWorkings;

  return [
    "### The harness constant, and how it was measured",
    "",
    "Claude Code injects its own system prompt and tool schemas into every arm before the arm has said",
    "anything. It is MEASURED, not estimated: one control turn per authoring surface, through the same",
    "harness, with a trivial task and no arm system prompt. The constant is the prompt tokens of the",
    "FIRST assistant message — everything the model read before it had written anything.",
    "",
    ...constantLines,
    "",
    "Measured per SURFACE because the tool schemas differ (canvas_render's schema vs Write's). It is",
    "subtracted once per assistant turn and floored at zero. It lands in the INPUT columns only, never",
    "in output — so it cannot bias the headline.",
    ...(workingsExample ? ["", `Worked example from this archive: \`${workingsExample}\`.`] : []),
    "",
    "Input RAW and input harness-subtracted are printed side by side. Subtract it or restore it",
    "yourself; the report never does it quietly.",
  ].join("\n");
}

function buildIntervalSubsection(meta: ReportMeta): string {
  return [
    "### Confidence intervals",
    "",
    `${BOOTSTRAP_METHOD_DESCRIPTION} Seed: \`${meta.bootstrap.seed}\`. Resamples: ` +
      `${formatCount(meta.bootstrap.resamples)}. Confidence: ${formatPercent(meta.bootstrap.confidence)}.`,
    "",
    WILSON_METHOD_DESCRIPTION,
    "",
    "A cell with fewer than two passing runs prints `insufficient data` rather than a point estimate",
    "dressed up as a measurement.",
  ].join("\n");
}

function buildUncontrolledSubsection(): string {
  return [
    "### What we did NOT control for",
    "",
    "- **Model nondeterminism.** Temperature is not pinnable through the Claude Code path. Replicates",
    "  are the only defence, and N per cell is small.",
    "- **Agentic exploration.** How much the model reads, greps, and thinks before it authors is a",
    "  property of the task and the harness, and it varies enormously run to run. This is precisely",
    "  why the headline is the authored artifact and not the session.",
    "- **Prompt-writing skill.** Each arm's system prompt was written by us. A better prompt for a",
    "  rival format exists, and we did not find it. This cuts both ways: a better prompt for OUR arm",
    "  might also make the model climb the ladder — which the section above says we failed to get.",
    "- **Model familiarity with HTML.** HTML and JSX are overwhelmingly represented in pretraining;",
    "  parchment's vocabulary is not. This cuts AGAINST parchment, and we did not correct for it.",
    "- **Scenario selection.** We chose the scenarios, and we chose them to exercise the ladder —",
    "  which is the hypothesis under test. That is the point, and it is also the bias.",
    "- **Cache state across runs.** Cache hits depend on run order; that is why both the cold and the",
    "  warm cost columns are published instead of one blended number.",
  ].join("\n");
}

function buildNotTestedSubsection(): string {
  return [
    "### NOT TESTED — and this is THE open question",
    "",
    "**Strict tool use / grammar-constrained decoding is UNREACHABLE through Claude Code's MCP path,",
    "and was NOT tested.** Reaching it needs a Console API key, which this eval does not have: it runs",
    "on a subscription. This gap matters more than any other on this page, for two reasons:",
    "",
    "1. A constrained decoder would likely eliminate the rival formats' syntax errors and cut their",
    "   repair turns — so the arm most likely to benefit is the one we beat.",
    "2. It is also the most plausible mechanism for making a model actually USE a reference component",
    "   instead of pasting a file. The ladder-climbing failure reported above might simply not survive",
    "   it.",
    "",
    "We did not simulate it, and we claim nothing about it. Anyone with a Console API key can settle",
    "it, and until someone does, this page has an open question at its centre.",
    "",
    "Also not measured: streaming and partial-render latency; human preference and aesthetic quality;",
    "multi-turn conversational editing of an existing canvas; any model not listed above.",
  ].join("\n");
}

function buildFalsificationSubsection(): string {
  return [
    "### How to falsify this",
    "",
    "1. **Make the model climb.** If a better system prompt (or a constrained decoder) makes the",
    "   high-fidelity arm reach for the reference component reliably, the ladder becomes a measured",
    "   result instead of an opportunity. If nothing makes it climb, the ladder is worth nothing in",
    "   practice, no matter how good column (a) looks.",
    "2. **Kill the ladder.** Give a rival format a reference mechanism its runtime hydrates. If the",
    "   authored-token gap survives that, the claim is about the ladder. If it collapses, the claim",
    "   was only ever about a missing feature in the rivals.",
    "3. **Rewrite our rival prompts.** They are archived. If a better raw-HTML system prompt closes the",
    "   authored-token gap, say so with the run records.",
    "4. **Raise N.** Every interval here is over a small sample. Raise `--replicates` until the",
    "   intervals separate or overlap decisively.",
    "5. **Change the rubric.** It is pure data and imports no parchment code. If it flatters us, edit",
    "   the assertions and re-run.",
    "6. **Check the arithmetic offline.** `report --from <archive>` recomputes every table from the raw",
    "   records without calling a model. The intervals are seeded, so they must come back identical. If",
    "   they do not, something is wrong and you should not trust this page.",
  ].join("\n");
}

// ---- Sorting -----------------------------------------------------------------

function sortCellsBy(cells: readonly Cell[], selector: (run: RunMetrics) => number | null): Cell[] {
  return [...cells].sort((left, right) => {
    const leftMean = meanOrNull(selectValues(left.passingRuns, selector));
    const rightMean = meanOrNull(selectValues(right.passingRuns, selector));
    return compareNullableAscending(leftMean, rightMean);
  });
}

// A cell with no passing runs sorts last: it has no measurement, and an empty
// cell must never look like a cheap one.
function compareNullableAscending(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

// ---- Small helpers -----------------------------------------------------------

function selectValues(
  runs: readonly RunMetrics[],
  selector: (run: RunMetrics) => number | null,
): number[] {
  return runs.flatMap((run) => {
    const value = selector(run);
    return value === null ? [] : [value];
  });
}

function groupByScenarioAndModel(metrics: readonly RunMetrics[]): Map<string, RunMetrics[]> {
  const groups = new Map<string, RunMetrics[]>();
  for (const metric of metrics) {
    const key = `${metric.scenarioId}::${metric.model}`;
    const existing = groups.get(key) ?? [];
    existing.push(metric);
    groups.set(key, existing);
  }
  return groups;
}

function distinctArms(runs: readonly RunMetrics[], family: ArmFamily): ArmId[] {
  return [
    ...new Set(runs.filter((run) => ARM_FAMILY[run.armId] === family).map((run) => run.armId)),
  ];
}

function runsOf(metrics: readonly RunMetrics[], armId: ArmId, model: EvalModel): RunMetrics[] {
  return metrics.filter((run) => run.armId === armId && run.model === model);
}

function passingRunsOf(
  metrics: readonly RunMetrics[],
  armId: ArmId,
  model: EvalModel,
): RunMetrics[] {
  return runsOf(metrics, armId, model).filter((run) => run.passed);
}

function modelsPresentIn(metrics: readonly RunMetrics[]): EvalModel[] {
  return [...new Set(metrics.map((run) => run.model))];
}

function sumOf<Item>(items: readonly Item[], selector: (item: Item) => number): number {
  return items.reduce((runningTotal, item) => runningTotal + selector(item), 0);
}

function meanOrNull(values: readonly number[]): number | null {
  return summarize(values)?.mean ?? null;
}

function byAttemptIndex(left: EvalAttemptRecord, right: EvalAttemptRecord): number {
  return left.attemptIndex - right.attemptIndex;
}

// ---- Formatting --------------------------------------------------------------

const NOT_AVAILABLE = "n/a";
const NOT_APPLICABLE = "n/a";
const NEVER_PASSED = "never passed";
const NOT_MEASURED = "NOT MEASURED";
const USD_DECIMALS = 4;
const TIMES_DECIMALS_BELOW_TEN = 2;
const TIMES_DECIMALS_AT_OR_ABOVE_TEN = 1;
const RATIO_DECIMAL_THRESHOLD = 10;

function renderMarkdownTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const headerLine = `| ${headers.join(" | ")} |`;
  const dividerLine = `|${headers.map(() => "---").join("|")}|`;
  const bodyLines = rows.map((row) => `| ${row.join(" | ")} |`);
  return [headerLine, dividerLine, ...bodyLines].join("\n");
}

function formatMean(summary: SampleSummary | null, formatValue: (value: number) => string): string {
  if (!summary) return NEVER_PASSED;
  return formatValue(summary.mean);
}

function formatMeanOrNotMeasured(
  summary: SampleSummary | null,
  formatValue: (value: number) => string,
): string {
  if (!summary) return NOT_MEASURED;
  return formatValue(summary.mean);
}

function formatMedianOrNotMeasured(
  summary: SampleSummary | null,
  formatValue: (value: number) => string,
): string {
  if (!summary) return NOT_MEASURED;
  return formatValue(summary.median);
}

function formatSpreadOrNotMeasured(
  summary: SampleSummary | null,
  formatValue: (value: number) => string,
): string {
  if (!summary) return NOT_MEASURED;
  return `${formatValue(summary.min)}–${formatValue(summary.max)}`;
}

function formatInterval(
  estimate: IntervalEstimate,
  formatValue: (value: number) => string,
): string {
  if (estimate.status !== EstimateStatus.Ok) return `insufficient data (${estimate.reason})`;
  return `${formatValue(estimate.lowerBound)}–${formatValue(estimate.upperBound)}`;
}

function formatProportionInterval(estimate: ProportionEstimate): string {
  if (estimate.status !== EstimateStatus.Ok) return `insufficient data (${estimate.reason})`;
  return `${formatPercent(estimate.lowerBound)}–${formatPercent(estimate.upperBound)}`;
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatUsd(value: number): string {
  return `$${value.toFixed(USD_DECIMALS)}`;
}

function formatTimes(value: number): string {
  const decimals =
    value >= RATIO_DECIMAL_THRESHOLD ? TIMES_DECIMALS_AT_OR_ABOVE_TEN : TIMES_DECIMALS_BELOW_TEN;
  return `${value.toFixed(decimals)}x`;
}

function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function formatPercentOrNa(fraction: number | null): string {
  if (fraction === null) return NOT_AVAILABLE;
  return formatPercent(fraction);
}
