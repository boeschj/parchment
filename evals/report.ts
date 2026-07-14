// The published report. Takes archived RunRecords and emits markdown.
//
// THE PRIMARY AXIS IS OUTPUT TOKENS. Output bills ~5x fresh input and ~50x cached
// input, so a format that saves schema tokens while spending output tokens is
// losing money. Every headline table leads with output.
//
// EVERY NUMBER IS THE LEDGER'S. This file does no token arithmetic and no pricing
// of its own: totals come from summariseRun, cost from costOfRun, and the harness
// subtraction from subtractHarnessConstant. A report that computed its own cost
// model would eventually disagree with the ledger, and a hostile reader would be
// right to stop reading there.
//
// THE HONESTY RULES, enforced structurally rather than by good intentions:
//   1. Losses first. Every comparative section prints "Where parchment loses"
//      BEFORE "Where parchment wins". report.test.ts fails the build if that
//      order ever inverts.
//   2. Input is printed raw AND harness-subtracted, never quietly adjusted.
//   3. Cold-cache AND warm-cache cost are both published. A real user pays the
//      cache write once and then reads cheaply. Both numbers are true.
//   4. Format density gets its own table, where the terse formats will probably
//      win, printed plainly.
//   5. A null result is reported as a null result.

import { armFor } from "./arms/index.ts";
import { MAX_REPAIR_TURNS } from "./config.ts";
import {
  countBytes,
  TOKEN_APPROXIMATION,
  type ApproximationAudit,
  type ArtifactMeasurement,
} from "./density.ts";
import {
  costOfRun,
  promptTokensOf,
  subtractHarnessConstant,
  summariseRun,
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
  type BootstrapOptions,
  type IntervalEstimate,
  type SampleSummary,
} from "./stats.ts";
import {
  ArmId,
  AuthoringSurface,
  EvalModel,
  Fidelity,
  type AttemptRecord,
  type RunRecord,
} from "./types.ts";

// ---- What the report must be told (it does no I/O and guesses nothing) -------

export type ScenarioSummary = {
  id: string;
  title: string;
  exercisesLadder: boolean;
  // Used to decide whether an artifact REFERENCED the data or PASTED it.
  sourceFileRelativePaths: readonly string[];
  sourceFileBytes: number;
};

export type ReportMeta = {
  generatedAt: string;
  // The dated ids the aliases resolved to, if the archive recorded them.
  modelIds: Readonly<Partial<Record<EvalModel, string>>>;
  claudeCliVersion: string | null;
  scenarios: readonly ScenarioSummary[];
  // Measured by ledger.measureHarnessConstant, per model, per authoring surface.
  // Absent when the archive predates the measurement: the report then prints RAW
  // input only and says the constant was NOT MEASURED, rather than inventing one.
  harnessConstantsByModel: Readonly<Partial<Record<EvalModel, HarnessConstant>>>;
  archiveRelativePath: string;
  bootstrap: BootstrapOptions;
};

export type ReportInput = {
  records: readonly RunRecord[];
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

// The arm whose output tokens the ladder ratios are quoted against.
const LADDER_REFERENCE_ARM = ArmId.ParchmentMarkupHigh;

// Identical grammar, identical runtime, identical schema size — only the
// identifiers differ. Anything else would not be an ablation.
const ABLATION_PAIRS = [
  { rung: Fidelity.High, real: ArmId.ParchmentMarkupHigh, scrambled: ArmId.ScrambledMarkupHigh },
  { rung: Fidelity.Low, real: ArmId.ParchmentMarkupLow, scrambled: ArmId.ScrambledMarkupLow },
] as const;

// ---- Per-run metrics ---------------------------------------------------------

export const LadderBehavior = {
  Referenced: "referenced",
  Pasted: "pasted",
  Inconclusive: "inconclusive",
  NoArtifact: "no-artifact",
  NotApplicable: "not-applicable",
} as const;

export type LadderBehavior = (typeof LadderBehavior)[keyof typeof LadderBehavior];

// An artifact at least this fraction of the source data's size is carrying the
// data itself: it PASTED rather than referenced. A reference is ~15 tokens.
const PASTE_DETECTION_BYTE_FRACTION = 0.5;

const PASS_AT_K_LEVELS = { First: 1, WithinThree: 3 } as const;
const MAX_ATTEMPTS_PER_RUN = 1 + MAX_REPAIR_TURNS;
const RATIO_OF_NO_DIFFERENCE = 1;

type RunMetrics = {
  armId: ArmId;
  scenarioId: string;
  model: EvalModel;
  passed: boolean;
  attemptsToPass: number | null;
  outputTokens: number;
  systemPromptTokens: number;
  repairTokens: number;
  inputTokensRaw: number;
  // Null when the harness constant was never measured for this run's model and
  // surface. A null prints as "not measured", never as a silently unadjusted
  // number dressed up as an adjusted one.
  inputTokensHarnessSubtracted: number | null;
  harnessWorkings: string | null;
  objectiveTokens: number;
  allInTokensRaw: number;
  coldCacheCostUsd: number;
  warmCacheCostUsd: number;
  reportedCostUsd: number;
  ladderBehavior: LadderBehavior;
  exercisesLadder: boolean;
};

function toRunMetrics(
  record: RunRecord,
  scenariosById: ReadonlyMap<string, ScenarioSummary>,
  harnessConstantsByModel: ReportMeta["harnessConstantsByModel"],
): RunMetrics {
  const attempts = [...record.attempts].sort(byAttemptIndex);
  const [authoringAttempt, ...repairAttempts] = attempts;

  const totals = summariseRun(attempts, record.systemPromptTokens);
  const cost = costOfRun(record.model, totals);
  const harness = harnessSubtractionFor(record, totals, harnessConstantsByModel);
  const scenario = scenariosById.get(record.scenarioId) ?? null;

  // The objective function, exactly as declared: schema tokens once, every output
  // token, and every token spent inside the repair loop. Repair OUTPUT is already
  // inside totalOutputTokens, so only repair INPUT is added here.
  const repairPromptTokens = sumOf(repairAttempts, promptTokensOf);
  const repairOutputTokens = sumOf(repairAttempts, (attempt) => attempt.outputTokens);

  return {
    armId: record.armId,
    scenarioId: record.scenarioId,
    model: record.model,
    passed: totals.passed,
    attemptsToPass: totals.attemptsToPass,
    outputTokens: totals.totalOutputTokens,
    systemPromptTokens: totals.systemPromptTokens,
    repairTokens: repairPromptTokens + repairOutputTokens,
    inputTokensRaw: totals.totalPromptTokens,
    inputTokensHarnessSubtracted: harness?.adjustedPromptTokens ?? null,
    harnessWorkings: harness?.workings ?? null,
    objectiveTokens: totals.systemPromptTokens + totals.totalOutputTokens + repairPromptTokens,
    allInTokensRaw:
      totals.systemPromptTokens + totals.totalOutputTokens + totals.totalPromptTokens,
    coldCacheCostUsd: cost.coldCacheUsd,
    warmCacheCostUsd: cost.warmCacheUsd,
    reportedCostUsd: totals.totalReportedCostUsd,
    ladderBehavior: classifyLadderBehavior(record, scenario, authoringAttempt),
    exercisesLadder: scenario?.exercisesLadder ?? false,
  };
}

// The constant is measured PER SURFACE, because the tool schemas differ: the
// canvas arms are sent canvas_render's schema, the file arms are sent Write's.
function harnessSubtractionFor(
  record: RunRecord,
  totals: RunTotals,
  harnessConstantsByModel: ReportMeta["harnessConstantsByModel"],
): ReturnType<typeof subtractHarnessConstant> | null {
  const constant = harnessConstantsByModel[record.model];
  if (!constant) return null;

  const surface = surfaceOf(record.armId);
  return subtractHarnessConstant({
    rawPromptTokens: totals.totalPromptTokens,
    assistantTurnCount: totals.totalAssistantTurns,
    harnessConstantTokens: constant.promptTokensBySurface[surface],
  });
}

function surfaceOf(armId: ArmId): AuthoringSurface {
  return armFor(armId).surface;
}

function classifyLadderBehavior(
  record: RunRecord,
  scenario: ScenarioSummary | null,
  authoringAttempt: AttemptRecord | undefined,
): LadderBehavior {
  if (!scenario?.exercisesLadder) return LadderBehavior.NotApplicable;

  const acceptedAttempt = record.attempts.find((attempt) => attempt.accepted && attempt.artifact);
  const judgedAttempt = acceptedAttempt ?? authoringAttempt;
  const source = judgedAttempt?.artifact?.source ?? null;
  if (!source) return LadderBehavior.NoArtifact;

  const artifactBytes = countBytes(source);
  const pasteThresholdBytes = scenario.sourceFileBytes * PASTE_DETECTION_BYTE_FRACTION;
  const carriesTheDataItself = scenario.sourceFileBytes > 0 && artifactBytes >= pasteThresholdBytes;
  if (carriesTheDataItself) return LadderBehavior.Pasted;

  const namesASourceFile = scenario.sourceFileRelativePaths.some((path) => source.includes(path));
  if (namesASourceFile) return LadderBehavior.Referenced;

  return LadderBehavior.Inconclusive;
}

// ---- Spend (used by the CLI) -------------------------------------------------

export type SpendSummary = {
  runs: number;
  reportedUsd: number;
  coldCacheUsd: number;
  warmCacheUsd: number;
};

export function summarizeSpend(records: readonly RunRecord[]): SpendSummary {
  const costs = records.map((record) => {
    const totals = summariseRun(record.attempts, record.systemPromptTokens);
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
// rates are computed over ALL runs, and printed beside the token figures, so a
// cheap arm that fails constantly cannot hide behind a small mean.
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
  selector: (run: RunMetrics) => number,
): CellComparison[] {
  const comparisons: CellComparison[] = [];

  for (const group of groupByScenarioAndModel(metrics).values()) {
    const passing = group.filter((run) => run.passed);
    const bestRival = findBestRival(passing, selector);
    if (!bestRival || bestRival.value === 0) continue;

    for (const parchmentArmId of distinctArms(passing, ArmFamily.Parchment)) {
      const parchmentRuns = passing.filter((run) => run.armId === parchmentArmId);
      const parchmentValue = meanOrNull(valuesOf(parchmentRuns, selector));
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
  selector: (run: RunMetrics) => number,
): { armId: ArmId; value: number } | null {
  const rivalMeans = distinctArms(runs, ArmFamily.Rival).flatMap((armId) => {
    const armRuns = runs.filter((run) => run.armId === armId);
    const armMean = meanOrNull(valuesOf(armRuns, selector));
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

  const lossLines = losses.map((comparison) => formatComparisonLine(comparison, unitLabel, formatValue));
  const winLines = wins.map((comparison) => formatComparisonLine(comparison, unitLabel, formatValue));

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
    buildObjectiveSection(),
    buildHeadlineSection(metrics, cells, input.meta),
    buildLadderSection(metrics, input.meta),
    buildDecompositionSection(cells),
    buildAblationSection(metrics, input.meta),
    buildDensitySection(input.density, input.densityAudit),
    buildCostSection(metrics, cells),
    buildMethodologySection(input.meta, metrics),
  ];

  return `${sections.join("\n\n")}\n`;
}

function buildHeaderSection(records: readonly RunRecord[], meta: ReportMeta): string {
  const arms = new Set(records.map((record) => record.armId));
  const scenarios = new Set(records.map((record) => record.scenarioId));
  const models = new Set(records.map((record) => record.model));

  return [
    "# Tokens to a browser-verified render",
    "",
    `- Generated: ${meta.generatedAt}`,
    `- Runs: ${records.length} across ${arms.size} arms x ${scenarios.size} scenarios x ${models.size} models`,
    `- Archive (every number below is reproducible offline from it): \`${meta.archiveRelativePath}\``,
    `- Confidence intervals: percentile bootstrap, ${formatCount(meta.bootstrap.resamples)} resamples, ` +
      `${formatPercent(meta.bootstrap.confidence)}, seed \`${meta.bootstrap.seed}\` — deterministic.`,
    "",
    "Acceptance is decided by a real headless browser against a DOM rubric that never imports",
    "parchment code. An arm passes when the page it produced actually paints the required content.",
  ].join("\n");
}

function buildObjectiveSection(): string {
  return [
    "## The objective function",
    "",
    "```",
    "total_tokens_to_correct_render(run) =",
    "      system/schema tokens   (the arm's protocol cost, once, as sent)",
    "    + output tokens          (every attempt, repairs included)",
    "    + repair-turn input      (every token re-sent inside the repair loop)",
    "```",
    "",
    "Output is the primary axis because output bills ~5x fresh input and ~50x cached input.",
    "",
    "The initial authoring turn's INPUT is deliberately not in that total: it is dominated by a",
    "harness constant that every arm on the same surface pays identically. It is not swept away",
    "either — it is printed raw and harness-subtracted in the decomposition table, and an all-in",
    "column (objective + initial input, raw) appears in the headline table so nothing is hidden by",
    "the choice.",
  ].join("\n");
}

function buildHeadlineSection(
  metrics: readonly RunMetrics[],
  cells: readonly Cell[],
  meta: ReportMeta,
): string {
  const comparisons = compareParchmentToBestRival(metrics, (run) => run.objectiveTokens);
  const lossesAndWins = buildLossesAndWins(comparisons, "total tokens", formatCount);

  const rows = sortCellsBy(cells, (run) => run.objectiveTokens).map((cell) => {
    const objectives = valuesOf(cell.passingRuns, (run) => run.objectiveTokens);
    const objectiveSummary = summarize(objectives);

    return [
      `\`${cell.armId}\``,
      ARM_FIDELITY[cell.armId],
      cell.model,
      `${cell.passingRuns.length}/${cell.allRuns.length}`,
      formatPercentOrNa(passAtK(cell.allRuns, PASS_AT_K_LEVELS.First)),
      formatMean(summarize(valuesOf(cell.passingRuns, (run) => run.outputTokens)), formatCount),
      formatMean(objectiveSummary, formatCount),
      formatInterval(bootstrapConfidenceInterval(objectives, mean, meta.bootstrap), formatCount),
      formatMedian(objectiveSummary, formatCount),
      formatSpread(objectiveSummary, formatCount),
      formatMean(summarize(valuesOf(cell.passingRuns, (run) => run.allInTokensRaw)), formatCount),
    ];
  });

  const table = renderMarkdownTable(
    [
      "Arm",
      "Rung",
      "Model",
      "Passed/N",
      "pass@1",
      "Output tokens (mean)",
      "TOTAL to correct render (mean)",
      "95% CI",
      "median",
      "min–max",
      "All-in raw (mean)",
    ],
    rows,
  );

  return [
    "## Headline: total tokens to a correct render",
    "",
    "Token columns cover PASSING runs only — a run that never rendered correctly has no",
    "tokens-to-correct-render. Pass rate sits beside them so a cheap arm that fails cannot hide.",
    "",
    ...coverageWarningLines(cells),
    lossesAndWins,
    "",
    table,
  ].join("\n");
}

// A row in this table is an arm's mean ACROSS the scenarios it ran. If two arms
// ran different scenario sets, their means are not comparable to each other, and
// saying so is cheaper than letting a reader assume otherwise. The per-scenario
// bullets above the table are unaffected: they compare within one scenario.
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
  const everyArmRanTheSameScenarios = coverageSignatures.size <= 1;
  if (everyArmRanTheSameScenarios) return [];

  return [
    "> **Not every arm ran every scenario in this archive**, so the means in this table pool",
    "> different scenario mixes and are NOT directly comparable across rows. The per-scenario",
    "> comparisons below, and the ladder table, are like-for-like. Fix this by running the full",
    "> matrix.",
    "",
  ];
}

// The most prominent comparison in the eval: a high-fidelity arm names a file
// (~15 tokens); every low-fidelity arm and every rival format must paste the
// bytes. This is where the compression stops being a syntax war.
function buildLadderSection(metrics: readonly RunMetrics[], meta: ReportMeta): string {
  const ladderRuns = metrics.filter((run) => run.exercisesLadder);
  if (ladderRuns.length === 0) {
    return ["## THE FIDELITY LADDER (the headline experiment)", "", "No ladder scenarios were run."].join(
      "\n",
    );
  }

  const comparisons = compareParchmentToBestRival(ladderRuns, (run) => run.outputTokens);
  const lossesAndWins = buildLossesAndWins(comparisons, "output tokens", formatCount);
  const referenceOutputs = outputsOfArm(ladderRuns, LADDER_REFERENCE_ARM);

  const rows = sortCellsBy(toCells(ladderRuns), (run) => run.outputTokens).map((cell) => {
    const outputs = valuesOf(cell.passingRuns, (run) => run.outputTokens);

    return [
      `\`${cell.armId}\``,
      ARM_FIDELITY[cell.armId],
      cell.model,
      `${cell.passingRuns.length}/${cell.allRuns.length}`,
      formatMean(summarize(outputs), formatCount),
      formatInterval(bootstrapConfidenceInterval(outputs, mean, meta.bootstrap), formatCount),
      formatInterval(bootstrapRatio(outputs, referenceOutputs, meta.bootstrap), formatTimes),
      formatLadderBehaviorCounts(cell.passingRuns),
    ];
  });

  const table = renderMarkdownTable(
    [
      "Arm",
      "Rung",
      "Model",
      "Passed/N",
      "Output tokens (mean)",
      "95% CI",
      `x vs \`${LADDER_REFERENCE_ARM}\` (95% CI)`,
      "Climbed the ladder?",
    ],
    rows,
  );

  return [
    "## THE FIDELITY LADDER (the headline experiment)",
    "",
    "Ladder scenarios keep the source data on disk. A high-fidelity arm may REFERENCE it by path;",
    "a low-fidelity arm and every rival format must READ it and PASTE it into the artifact. The",
    `ratio column is quoted against \`${LADDER_REFERENCE_ARM}\` with a bootstrap interval, so the`,
    "gap is published as a range rather than as a flattering point estimate.",
    "",
    '"Climbed the ladder?" classifies each artifact as referenced / pasted — see Methodology for',
    "the exact rule.",
    "",
    lossesAndWins,
    "",
    table,
  ].join("\n");
}

function buildDecompositionSection(cells: readonly Cell[]): string {
  const rows = sortCellsBy(cells, (run) => run.objectiveTokens).map((cell) => {
    const passing = cell.passingRuns;
    const subtractedInputs = passing
      .map((run) => run.inputTokensHarnessSubtracted)
      .filter((value): value is number => value !== null);

    return [
      `\`${cell.armId}\``,
      cell.model,
      `${passing.length}/${cell.allRuns.length}`,
      formatMean(summarize(valuesOf(passing, (run) => run.outputTokens)), formatCount),
      formatMean(summarize(valuesOf(passing, (run) => run.systemPromptTokens)), formatCount),
      formatMean(summarize(valuesOf(passing, (run) => run.repairTokens)), formatCount),
      formatMean(summarize(valuesOf(passing, (run) => run.inputTokensRaw)), formatCount),
      formatMeanOrNotMeasured(summarize(subtractedInputs), formatCount),
      formatPercentOrNa(passAtK(cell.allRuns, PASS_AT_K_LEVELS.First)),
      formatPercentOrNa(passAtK(cell.allRuns, PASS_AT_K_LEVELS.WithinThree)),
    ];
  });

  const table = renderMarkdownTable(
    [
      "Arm",
      "Model",
      "Passed/N",
      "Output",
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
    "Repair-turn output is also inside the Output column — the repair column is printed so the cost",
    "of the repair loop is visible, not so it can be added again.",
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
      "Real vocab output (mean)",
      "Scrambled output (mean)",
      "Scrambled / real (95% CI)",
      "Real pass@1",
      "Scrambled pass@1",
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
    ...(verdicts.length > 0 ? verdicts : ["_No arm pair had runs on both sides._"]),
    "",
    table,
    "",
    buildLadderClimbingSubsection(metrics),
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

  const realOutputs = outputsOfPassingRuns(realRuns);
  const scrambledOutputs = outputsOfPassingRuns(scrambledRuns);

  return [
    pair.rung,
    model,
    formatMean(summarize(realOutputs), formatCount),
    formatMean(summarize(scrambledOutputs), formatCount),
    formatInterval(bootstrapRatio(scrambledOutputs, realOutputs, meta.bootstrap), formatTimes),
    formatPercentOrNa(passAtK(realRuns, PASS_AT_K_LEVELS.First)),
    formatPercentOrNa(passAtK(scrambledRuns, PASS_AT_K_LEVELS.First)),
  ];
}

function buildAblationVerdict(
  pair: AblationPair,
  model: EvalModel,
  metrics: readonly RunMetrics[],
  meta: ReportMeta,
): string {
  const realOutputs = outputsOfPassingRuns(runsOf(metrics, pair.real, model));
  const scrambledOutputs = outputsOfPassingRuns(runsOf(metrics, pair.scrambled, model));
  const ratio = bootstrapRatio(scrambledOutputs, realOutputs, meta.bootstrap);
  const label = `\`${pair.scrambled}\` vs \`${pair.real}\` (${model}, output tokens)`;

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

  const scrambledCostsMore = ratio.lowerBound > RATIO_OF_NO_DIFFERENCE;
  if (scrambledCostsMore) {
    return (
      `- ${label}: scrambling COST ${formatTimes(ratio.point)} more output (95% CI ${interval}). ` +
      "Familiarity with the real names is worth something."
    );
  }

  return (
    `- ${label}: scrambling was CHEAPER — ${formatTimes(ratio.point)} (95% CI ${interval}). ` +
    "This is evidence AGAINST the familiarity hypothesis and is printed first for that reason."
  );
}

// The behavioural half of the ablation: on ladder scenarios, did the scrambled
// arm still reach for the high-fidelity component, or did it retreat to
// low-fidelity primitives and paste the bytes?
function buildLadderClimbingSubsection(metrics: readonly RunMetrics[]): string {
  const ladderRuns = metrics.filter((run) => run.exercisesLadder);
  const ablationArms = ABLATION_PAIRS.flatMap((pair) => [pair.real, pair.scrambled]);

  const rows = ablationArms.flatMap((armId) => {
    const armRuns = ladderRuns.filter((run) => run.armId === armId);
    if (armRuns.length === 0) return [];

    return [
      [
        `\`${armId}\``,
        ARM_FIDELITY[armId],
        String(armRuns.length),
        String(countBehavior(armRuns, LadderBehavior.Referenced)),
        String(countBehavior(armRuns, LadderBehavior.Pasted)),
        String(countBehavior(armRuns, LadderBehavior.Inconclusive)),
        String(countBehavior(armRuns, LadderBehavior.NoArtifact)),
      ],
    ];
  });

  if (rows.length === 0) {
    return ["### Did the scrambled arm still climb the ladder?", "", "_No ladder runs._"].join("\n");
  }

  return [
    "### Did the scrambled arm still climb the ladder?",
    "",
    "On ladder scenarios only: whether the artifact REFERENCED the source file by path (climbed) or",
    "PASTED its contents (fell back to low-fidelity primitives).",
    "",
    renderMarkdownTable(
      ["Arm", "Rung", "Ladder runs", "Referenced", "Pasted", "Inconclusive", "No artifact"],
      rows,
    ),
  ].join("\n");
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

  // Ascending bytes: the densest notation is printed FIRST, which is where the
  // terse formats are expected to beat parchment.
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
    "This is the table where the terse formats are expected to WIN, and it is sorted densest-first",
    "so they appear at the top. It is printed plainly because it does not decide the argument:",
    "density is a per-character property, while the fidelity ladder is a per-ELEMENT property. A",
    "notation that spells a diff in 20% fewer characters still has to spell the whole diff.",
    "",
    "**Bytes are exact. TOKEN COLUMNS ARE APPROXIMATIONS, not model tokenization.** No model",
    "tokenizer is reachable offline on this machine (subscription-only Claude Code, no Console API",
    "key), so these columns are computed, not measured. Nothing else in this report depends on them:",
    "every other token number comes from the transcripts and is exact.",
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
    `for ${formatPercent(audit.meanRatioToMeasuredOutput)} of the MEASURED output tokens on average ` +
    `(range ${formatPercent(audit.minRatio)}–${formatPercent(audit.maxRatio)}). Values under 100% are ` +
    "expected: the model also emits prose and tool scaffolding that is not part of the artifact."
  );
}

function buildCostSection(metrics: readonly RunMetrics[], cells: readonly Cell[]): string {
  const comparisons = compareParchmentToBestRival(metrics, (run) => run.warmCacheCostUsd);
  const lossesAndWins = buildLossesAndWins(comparisons, "per correct render (warm)", formatUsd);

  const rows = sortCellsBy(cells, (run) => run.objectiveTokens).map((cell) => {
    const passing = cell.passingRuns;
    return [
      `\`${cell.armId}\``,
      cell.model,
      `${passing.length}/${cell.allRuns.length}`,
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
      "Cold-cache $ / correct render",
      "Warm-cache $ / correct render",
      "CLI-reported $ (mean)",
      "Cold spend incl. failures (total)",
    ],
    rows,
  );

  return [
    "## Cost",
    "",
    "Both numbers are true. **Cold-cache** prices every cache-read token as if it were fresh input:",
    "somebody paid to write that cache, and on the first call of the day nobody's cache is warm.",
    "**Warm-cache** prices cache reads at the cache-read rate — the steady state a returning user",
    "actually pays. The arms' ordering is least sensitive to the warm number, which is why both are",
    "published rather than one blended figure.",
    "",
    "The CLI-reported column is Claude Code's own figure, printed so our arithmetic can be checked",
    "against it. It is known to under-report on cached turns; where it disagrees with the columns to",
    "its left, the token math is the number to trust.",
    "",
    lossesAndWins,
    "",
    table,
  ].join("\n");
}

function buildMethodologySection(meta: ReportMeta, metrics: readonly RunMetrics[]): string {
  return [
    "## Methodology (for a hostile reader)",
    "",
    buildModelSubsection(meta, metrics),
    "",
    buildPromptsSubsection(meta),
    "",
    buildRepairSubsection(),
    "",
    buildHarnessSubsection(meta, metrics),
    "",
    buildClassifierSubsection(),
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
    "Nothing in this report was typed by hand: regenerate it with",
    "`bun run evals/cli.ts report --from <archive>` and every number reappears, including the",
    "confidence intervals, which are seeded.",
  ].join("\n");
}

function buildRepairSubsection(): string {
  return [
    "### How repairs were counted",
    "",
    "A failed artifact is handed back to the model with its OWN toolchain's error signal (its",
    "compiler's issues, its validator's issues, the browser's console errors) plus the rubric's",
    `"missing from the page" list, phrased identically for every arm. Up to ${MAX_REPAIR_TURNS} repair`,
    `turns are allowed, so a run is at most ${MAX_ATTEMPTS_PER_RUN} attempts, and the repair turn`,
    "resumes the same session so the model can see what it wrote. Every token spent inside that loop",
    "counts toward the objective function. `pass@1` is the fraction of runs whose FIRST attempt was",
    "accepted; `pass@3` is the fraction accepted within three attempts.",
  ].join("\n");
}

function buildHarnessSubsection(meta: ReportMeta, metrics: readonly RunMetrics[]): string {
  const constantLines = modelsPresentIn(metrics).flatMap((model) => {
    const constant = meta.harnessConstantsByModel[model];
    if (!constant) {
      return [
        `- \`${model}\`: **NOT MEASURED for this archive.** The harness-subtracted column reads` +
          " \"not measured\" rather than showing a number nobody verified.",
      ];
    }

    return Object.values(AuthoringSurface).map((surface) => {
      const tokens = constant.promptTokensBySurface[surface];
      return `- \`${model}\` / \`${surface}\`: ${formatCount(tokens)} tokens`;
    });
  });

  const workingsExample = metrics.find((run) => run.harnessWorkings !== null)?.harnessWorkings;

  return [
    "### The harness constant, and how it was measured",
    "",
    "Claude Code injects its own system prompt and tool schemas into every arm before the arm has",
    "said anything. It is MEASURED, not estimated: one control turn per authoring surface, through",
    "the same harness, with a trivial task and no arm system prompt. The constant is the prompt",
    "tokens of the FIRST assistant message — everything the model read before it had written",
    "anything.",
    "",
    ...constantLines,
    "",
    "Measured per SURFACE because the tool schemas differ (canvas_render's schema vs Write's). Two",
    "arms on the same surface pay the same constant, so it cannot bias a comparison between them;",
    "a comparison ACROSS surfaces carries whatever difference the two numbers above show, and that",
    "difference lands in the INPUT columns only — never in output, which is the primary axis.",
    "",
    "It is subtracted once per assistant turn (it is paid on every turn: written to cache on the",
    "first, read from cache after) and floored at zero, because a negative adjusted input would mean",
    "the constant was mismeasured and publishing it silently would hide that.",
    ...(workingsExample ? ["", `Worked example from this archive: \`${workingsExample}\`.`] : []),
    "",
    "Input RAW and input harness-subtracted are printed side by side. Subtract it or restore it",
    "yourself; the report never does it quietly. Input tokens are fresh input + cache reads + cache",
    "writes, which the usage schema reports as a disjoint partition of what the model read.",
  ].join("\n");
}

function buildClassifierSubsection(): string {
  return [
    "### The ladder-climbing classifier",
    "",
    `An artifact is classified PASTED when it is at least ${formatPercent(PASTE_DETECTION_BYTE_FRACTION)} of the size`,
    "of the scenario's source data — at that size it is carrying the data itself. Otherwise, if it",
    "names one of the scenario's source paths, it is REFERENCED. Anything else is INCONCLUSIVE. This",
    "is a heuristic over the archived artifact text, not a claim from the model; the artifacts are in",
    "the archive, so the classification can be re-derived or disputed.",
  ].join("\n");
}

function buildIntervalSubsection(meta: ReportMeta): string {
  return [
    "### Confidence intervals",
    "",
    `${BOOTSTRAP_METHOD_DESCRIPTION} Seed: \`${meta.bootstrap.seed}\`. Resamples: ` +
      `${formatCount(meta.bootstrap.resamples)}. Confidence: ${formatPercent(meta.bootstrap.confidence)}.`,
    "",
    "A cell with fewer than two passing runs prints `insufficient data` rather than a point estimate",
    "dressed up as a measurement.",
  ].join("\n");
}

function buildUncontrolledSubsection(): string {
  return [
    "### What we did NOT control for",
    "",
    "- **Model nondeterminism.** Temperature is not pinnable through the Claude Code path.",
    "  Replicates are the only defence, and N per cell is small.",
    "- **Prompt-writing skill.** Each arm's system prompt was written by us. A better prompt for a",
    "  rival format exists, and we did not find it. The rival prompts are in the archive; rewrite",
    "  them and re-run.",
    "- **Model familiarity with HTML.** HTML and JSX are overwhelmingly represented in pretraining;",
    "  parchment's vocabulary is not. This cuts AGAINST parchment, and we did not correct for it.",
    "- **Scenario selection.** We chose the scenarios, and we chose them to exercise the ladder —",
    "  which is the hypothesis under test. That is the point, and it is also the bias.",
    "- **Wall-clock time.** Runs are paced, not parallelised, and the bench daemon is already warm.",
    "  Latency numbers here are not a product benchmark.",
    "- **Cache state across runs.** Cache hits depend on run order; that is exactly why both the cold",
    "  and the warm cost columns are published instead of one blended number.",
  ].join("\n");
}

function buildNotTestedSubsection(): string {
  return [
    "### NOT TESTED",
    "",
    "- **Strict tool use / grammar-constrained decoding is UNREACHABLE through Claude Code's MCP path",
    "  and was NOT tested.** A constrained decoder would likely eliminate the rival formats' syntax",
    "  errors and change the repair-turn numbers. We did not simulate it, and we claim nothing about",
    "  it. This is the single biggest gap in the eval.",
    "- Streaming and partial-render latency: not measured.",
    "- Human preference and aesthetic quality: not measured.",
    "- Multi-turn conversational editing of an existing canvas: not measured.",
    "- Any model outside the ones listed above.",
  ].join("\n");
}

function buildFalsificationSubsection(): string {
  return [
    "### How to falsify this",
    "",
    "1. **Kill the ladder.** Give a rival format a reference mechanism (a file-path directive its",
    "   runtime hydrates). If the gap survives, the claim is about the ladder. If it collapses, the",
    "   claim was only ever about a missing feature in the rivals, and this report is wrong.",
    "2. **Rewrite our rival prompts.** They are archived. If a better raw-HTML system prompt closes",
    "   the output-token gap on the ladder scenarios, say so with the run records.",
    "3. **Raise N.** Every interval here is a bootstrap over a small sample. Raise `--replicates`",
    "   until the intervals separate or overlap decisively.",
    "4. **Change the rubric.** It is pure data and imports no parchment code. If it flatters us, edit",
    "   the assertions and re-run.",
    "5. **Check the arithmetic offline.** `report --from <archive>` recomputes every table from the",
    "   raw records without calling a model. The intervals are seeded, so they must come back",
    "   identical. If they do not, something is wrong and you should not trust this page.",
  ].join("\n");
}

// ---- Sorting -----------------------------------------------------------------

function sortCellsBy(cells: readonly Cell[], selector: (run: RunMetrics) => number): Cell[] {
  return [...cells].sort((left, right) => {
    const leftMean = meanOrNull(valuesOf(left.passingRuns, selector));
    const rightMean = meanOrNull(valuesOf(right.passingRuns, selector));
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
  const arms = new Set(
    runs.filter((run) => ARM_FAMILY[run.armId] === family).map((run) => run.armId),
  );
  return [...arms];
}

function runsOf(metrics: readonly RunMetrics[], armId: ArmId, model: EvalModel): RunMetrics[] {
  return metrics.filter((run) => run.armId === armId && run.model === model);
}

function outputsOfPassingRuns(runs: readonly RunMetrics[]): number[] {
  return runs.filter((run) => run.passed).map((run) => run.outputTokens);
}

function outputsOfArm(metrics: readonly RunMetrics[], armId: ArmId): number[] {
  return outputsOfPassingRuns(metrics.filter((run) => run.armId === armId));
}

function modelsPresentIn(metrics: readonly RunMetrics[]): EvalModel[] {
  return [...new Set(metrics.map((run) => run.model))];
}

function countBehavior(runs: readonly RunMetrics[], behavior: LadderBehavior): number {
  return runs.filter((run) => run.ladderBehavior === behavior).length;
}

function formatLadderBehaviorCounts(runs: readonly RunMetrics[]): string {
  const referenced = countBehavior(runs, LadderBehavior.Referenced);
  const pasted = countBehavior(runs, LadderBehavior.Pasted);
  return `${referenced} referenced / ${pasted} pasted`;
}

function sumOf<Item>(items: readonly Item[], selector: (item: Item) => number): number {
  return items.reduce((runningTotal, item) => runningTotal + selector(item), 0);
}

function meanOrNull(values: readonly number[]): number | null {
  return summarize(values)?.mean ?? null;
}

function byAttemptIndex(left: AttemptRecord, right: AttemptRecord): number {
  return left.attemptIndex - right.attemptIndex;
}

// ---- Formatting --------------------------------------------------------------

const NOT_AVAILABLE = "n/a";
const NEVER_PASSED = "never passed";
const NOT_MEASURED = "not measured";
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

function formatMedian(
  summary: SampleSummary | null,
  formatValue: (value: number) => string,
): string {
  if (!summary) return NEVER_PASSED;
  return formatValue(summary.median);
}

function formatSpread(
  summary: SampleSummary | null,
  formatValue: (value: number) => string,
): string {
  if (!summary) return NEVER_PASSED;
  return `${formatValue(summary.min)}–${formatValue(summary.max)}`;
}

function formatInterval(
  estimate: IntervalEstimate,
  formatValue: (value: number) => string,
): string {
  if (estimate.status !== EstimateStatus.Ok) return `insufficient data (${estimate.reason})`;
  return `${formatValue(estimate.lowerBound)}–${formatValue(estimate.upperBound)}`;
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
