#!/usr/bin/env bun
// One command reproduces everything.
//
//   bun run evals/cli.ts pilot --arms parchment-markup-high,raw-html \
//                              --scenarios git-diff-review --model sonnet --replicates 3
//   bun run evals/cli.ts matrix --models sonnet --replicates 5
//   bun run evals/cli.ts density                       # static, zero spend
//   bun run evals/cli.ts report --from evals/results/<timestamp>
//
// `report --from` regenerates every published table from the archive WITHOUT
// calling a model, so a reader can reproduce each number offline. The confidence
// intervals are seeded, so they come back byte-identical.

import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";

import {
  DAEMON_PORT,
  DELAY_BETWEEN_RUNS_MS,
  EvalPaths,
  ModelPricing,
} from "./config.ts";
import {
  auditApproximationAgainstTranscripts,
  collectCanonicalArtifacts,
  loadReferenceArtifacts,
  type ArtifactMeasurement,
} from "./density.ts";
import {
  buildReportMarkdown,
  summarizeSpend,
  type ReportMeta,
  type ScenarioSummary,
} from "./report.ts";
import { DEFAULT_BOOTSTRAP_OPTIONS } from "./stats.ts";
import {
  ArmId,
  AuthoringSurface,
  EvalModel,
  type Arm,
  type EvalScenario,
  type RunRecord,
} from "./types.ts";

// This CLI orchestrates; it does not drive the model. No fake data is stubbed in
// behind any of these imports: if a module is missing, the command fails loudly
// at import rather than reporting numbers no model produced.

import { runWithRepairLoop } from "./repair.ts";
import { ARMS, armFor } from "./arms/index.ts";
import { everyScenario } from "./scenarios/index.ts";
import { startEvalDaemon, type EvalDaemon } from "./daemon.ts";
import {
  REAL_VOCABULARY_INVERSE,
  SCRAMBLED_VOCABULARY_INVERSE,
  type AuthoringVocabulary,
} from "./render/materialize.ts";
import { REAL_VOCABULARY } from "./catalog/vocabulary.ts";
import {
  measureHarnessConstant,
  measureSystemPromptTokens,
  type HarnessConstant,
} from "./ledger.ts";

// The terse arm minifies only the STRUCTURAL keys; its component and prop names
// are the real ones. Expanded back before compiling.
//
// Copied from the grammar the terse arm is actually SHOWN — catalog/surface.ts,
// renderTerseJsonGrammar: "r = root key, e = elements, t = type, p = props,
// c = children, s = seeded state". Every key it is taught must be expandable: a
// missing entry here would leave `r`/`e`/`s` unexpanded, the spec would fail to
// compile, and the terse arm would be scored a failure this harness caused. The
// arm most likely to beat us on density is the last one that may be handicapped
// by a typo in our own table.
const TERSE_SPEC_KEYS = {
  r: "root",
  e: "elements",
  t: "type",
  p: "props",
  c: "children",
  s: "state",
} as const;

// ---- Defaults ----------------------------------------------------------------

const DEFAULT_REPLICATES = 3;
const DEFAULT_MODEL = EvalModel.Sonnet;
const RAW_DIRECTORY = "raw";
const META_FILENAME = "meta.json";
const DENSITY_FILENAME = "density.json";
const REPORT_FILENAME = "report.md";
const JSON_INDENT = 2;
const TEXT_ENCODING = "utf8";

// Used ONLY for the pre-flight spend estimate when no prior archive exists, and
// labelled as a guess wherever it is printed. The actual cost is measured from
// the runs themselves and printed afterwards.
const FALLBACK_COST_PER_RUN_USD: Record<EvalModel, number> = {
  [EvalModel.Haiku]: 0.02,
  [EvalModel.Sonnet]: 0.08,
  [EvalModel.Opus]: 0.35,
};

const Command = {
  Pilot: "pilot",
  Matrix: "matrix",
  Density: "density",
  Report: "report",
} as const;

type Command = (typeof Command)[keyof typeof Command];

// ---- Entry point --------------------------------------------------------------

async function main(): Promise<void> {
  const [commandName, ...commandArguments] = process.argv.slice(2);
  const command = toCommand(commandName);

  if (!command) {
    printUsage();
    process.exitCode = commandName === undefined ? 0 : 1;
    return;
  }

  const flags = parseFlags(commandArguments);

  if (command === Command.Density) {
    runDensityCommand(flags);
    return;
  }

  if (command === Command.Report) {
    runReportCommand(flags);
    return;
  }

  const cells = command === Command.Pilot ? toPilotCells(flags) : toCells(flags);
  await runCells(cells, flags);
}

// ---- Flags --------------------------------------------------------------------

type Flags = {
  arms: string | undefined;
  scenarios: string | undefined;
  model: string | undefined;
  models: string | undefined;
  replicates: string | undefined;
  from: string | undefined;
  harnessBaseline: string | undefined;
  referenceArtifacts: string | undefined;
  yes: boolean;
};

function parseFlags(commandArguments: readonly string[]): Flags {
  const { values } = parseArgs({
    args: [...commandArguments],
    options: {
      arms: { type: "string" },
      scenarios: { type: "string" },
      model: { type: "string" },
      models: { type: "string" },
      replicates: { type: "string" },
      from: { type: "string" },
      "harness-baseline": { type: "string" },
      "reference-artifacts": { type: "string" },
      yes: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  return {
    arms: values.arms,
    scenarios: values.scenarios,
    model: values.model,
    models: values.models,
    replicates: values.replicates,
    from: values.from,
    harnessBaseline: values["harness-baseline"],
    referenceArtifacts: values["reference-artifacts"],
    yes: values.yes ?? false,
  };
}

// ---- Cells --------------------------------------------------------------------

type Cell = {
  arm: Arm;
  scenario: EvalScenario;
  model: EvalModel;
  replicate: number;
};

function toPilotCells(flags: Flags): Cell[] {
  const arms = parseArms(flags.arms);
  const scenarios = parseScenarios(flags.scenarios);
  const models = [parseModel(flags.model ?? DEFAULT_MODEL)];
  return expandCells(arms, scenarios, models, parseReplicates(flags.replicates));
}

function toCells(flags: Flags): Cell[] {
  const arms = parseArms(flags.arms ?? everyArmId().join(","));
  const scenarios = parseScenarios(flags.scenarios ?? everyScenarioId().join(","));
  const models = parseModels(flags.models ?? DEFAULT_MODEL);
  return expandCells(arms, scenarios, models, parseReplicates(flags.replicates));
}

function expandCells(
  arms: readonly Arm[],
  scenarios: readonly EvalScenario[],
  models: readonly EvalModel[],
  replicates: number,
): Cell[] {
  const replicateNumbers = Array.from({ length: replicates }, (_unused, index) => index + 1);

  return arms.flatMap((arm) =>
    scenarios.flatMap((scenario) =>
      models.flatMap((model) =>
        replicateNumbers.map((replicate) => ({ arm, scenario, model, replicate })),
      ),
    ),
  );
}

// ---- Running ------------------------------------------------------------------

async function runCells(cells: readonly Cell[], flags: Flags): Promise<void> {
  if (cells.length === 0) throw new Error("no cells to run");

  printPlan(cells);
  const approved = await confirmSpend(flags.yes);
  if (!approved) {
    console.log("Aborted before spending anything.");
    return;
  }

  const resultsDirectory = createResultsDirectory();
  const rawDirectory = join(resultsDirectory, RAW_DIRECTORY);
  mkdirSync(rawDirectory, { recursive: true });

  const daemon = await startEvalDaemon();
  const records: RunRecord[] = [];
  let harnessConstantByModel: ReadonlyMap<EvalModel, HarnessConstant> = new Map();

  try {
    const protocolCosts = await measureProtocolCosts(cells, daemon);
    harnessConstantByModel = protocolCosts.harnessConstantByModel;

    for (const [index, cell] of cells.entries()) {
      console.log(`[${index + 1}/${cells.length}] ${describeCell(cell)}`);

      const record = await runWithRepairLoop({
        runId: runIdFor(cell),
        arm: cell.arm,
        scenario: cell.scenario,
        model: cell.model,
        replicate: cell.replicate,
        cwd: prepareRunDirectory(cell),
        daemon,
        vocabulary: authoringVocabularyFor(cell.arm),
        systemPromptTokens: protocolCostFor(protocolCosts.systemPromptTokensByKey, cell),
      });

      records.push(record);
      // Written as each run lands, so a crash mid-matrix never loses paid-for runs.
      writeJson(join(rawDirectory, `${record.runId}.json`), record);

      await pause(DELAY_BETWEEN_RUNS_MS);
    }
  } finally {
    await daemon.stop();
  }

  const reportPath = writeArchive(resultsDirectory, records, harnessConstantByModel, flags);
  printActualSpend(records);
  console.log(`\nReport: ${reportPath}`);
  console.log(`Reproduce offline: bun run evals/cli.ts report --from ${resultsDirectory}`);
}

// The arm's protocol cost is a term in the objective function. A missing
// measurement must stop the run, not quietly enter it as zero — a zero here would
// silently hand the arm a schema surface it never paid for.
function protocolCostFor(systemPromptTokensByKey: ReadonlyMap<string, number>, cell: Cell): number {
  const tokens = systemPromptTokensByKey.get(protocolKeyFor(cell));
  if (tokens === undefined) {
    throw new Error(`no system-prompt measurement for ${cell.arm.id} / ${cell.model}`);
  }
  return tokens;
}

// ---- Wiring the cells to the modules that do the work -------------------------

function runIdFor(cell: Cell): string {
  return `${cell.arm.id}__${cell.scenario.id}__${cell.model}__rep${cell.replicate}`;
}

// The protocol cost depends on the arm's system prompt and the model tokenizing
// it — not on the scenario or the replicate.
function protocolKeyFor(cell: Cell): string {
  return `${cell.arm.id}__${cell.model}`;
}

// Measured, never assumed: the fixed Claude Code overhead every arm pays, and
// then each arm's own system prompt on top of it. This is what lets the report
// print input tokens BOTH raw and harness-subtracted without either being a guess.
type ProtocolCosts = {
  systemPromptTokensByKey: ReadonlyMap<string, number>;
  harnessConstantByModel: ReadonlyMap<EvalModel, HarnessConstant>;
};

async function measureProtocolCosts(
  cells: readonly Cell[],
  daemon: EvalDaemon,
): Promise<ProtocolCosts> {
  const systemPromptTokensByKey = new Map<string, number>();
  const harnessConstantByModel = new Map<EvalModel, HarnessConstant>();

  for (const cell of cells) {
    const key = protocolKeyFor(cell);
    if (systemPromptTokensByKey.has(key)) continue;

    const cachedConstant = harnessConstantByModel.get(cell.model);
    const harnessConstant = cachedConstant ?? (await measureHarnessConstant({ model: cell.model, daemon }));
    harnessConstantByModel.set(cell.model, harnessConstant);

    const systemPromptTokens = await measureSystemPromptTokens({
      arm: cell.arm,
      model: cell.model,
      daemon,
      harnessConstant,
    });
    systemPromptTokensByKey.set(key, systemPromptTokens);
    console.log(`  protocol cost ${key}: ${systemPromptTokens} tokens`);
  }

  return { systemPromptTokensByKey, harnessConstantByModel };
}

// A scrambled arm authored in opaque names; its document is un-scrambled before
// it is compiled, because the scramble is an AUTHORING experiment, not a runtime
// one. Passing the identity map for a scrambled arm would score its output as if
// the names had been real, so the maps are resolved per arm and never defaulted.
function authoringVocabularyFor(arm: Arm): AuthoringVocabulary {
  const isScrambled = arm.id === ArmId.ScrambledMarkupHigh || arm.id === ArmId.ScrambledMarkupLow;
  if (isScrambled) return SCRAMBLED_VOCABULARY_INVERSE;

  // Only the terse arm authors short structural keys. Handing the expansion map
  // to any other arm would rename an element whose KEY happened to be "c" or "t".
  if (arm.id === ArmId.TerseJson) {
    return { inverse: REAL_VOCABULARY.inverse, terseSpecKeys: TERSE_SPEC_KEYS };
  }

  return REAL_VOCABULARY_INVERSE;
}

// Each run gets its own working directory with a fresh copy of the fixtures, so
// one run's written artifact can never be read by the next, and so the ladder's
// relative paths ("repo/src/server.ts") resolve for a model that only has Read
// and git.
function prepareRunDirectory(cell: Cell): string {
  const runDirectory = join(EvalPaths.runs, runIdFor(cell));
  rmSync(runDirectory, { recursive: true, force: true });
  mkdirSync(runDirectory, { recursive: true });
  cpSync(EvalPaths.fixtures, runDirectory, { recursive: true });
  return runDirectory;
}

function writeArchive(
  resultsDirectory: string,
  records: readonly RunRecord[],
  harnessConstantByModel: ReadonlyMap<EvalModel, HarnessConstant>,
  flags: Flags,
): string {
  const density = measureDensity(records, flags);
  const meta = buildMeta(resultsDirectory, records, harnessConstantByModel);

  writeJson(join(resultsDirectory, META_FILENAME), meta);
  writeJson(join(resultsDirectory, DENSITY_FILENAME), density);

  const markdown = buildReportMarkdown({
    records,
    density,
    densityAudit: auditApproximationAgainstTranscripts(records),
    meta,
  });

  const reportPath = join(resultsDirectory, REPORT_FILENAME);
  writeFileSync(reportPath, markdown, TEXT_ENCODING);
  return reportPath;
}

// ---- report --from (offline, zero spend) --------------------------------------

function runReportCommand(flags: Flags): void {
  const resultsDirectory = flags.from;
  if (!resultsDirectory) {
    throw new Error("usage: bun run evals/cli.ts report --from evals/results/<timestamp>");
  }

  const records = readArchivedRecords(resultsDirectory);
  if (records.length === 0) {
    throw new Error(`no run records under ${join(resultsDirectory, RAW_DIRECTORY)}`);
  }

  const meta = readArchivedMeta(resultsDirectory) ?? buildMeta(resultsDirectory, records, new Map());
  const density = measureDensity(records, flags);

  const markdown = buildReportMarkdown({
    records,
    density,
    densityAudit: auditApproximationAgainstTranscripts(records),
    meta: { ...meta, generatedAt: new Date().toISOString() },
  });

  const reportPath = join(resultsDirectory, REPORT_FILENAME);
  writeFileSync(reportPath, markdown, TEXT_ENCODING);
  console.log(`Regenerated from ${records.length} archived runs, no model calls: ${reportPath}`);
}

function readArchivedRecords(resultsDirectory: string): RunRecord[] {
  const rawDirectory = join(resultsDirectory, RAW_DIRECTORY);
  if (!directoryExists(rawDirectory)) return [];

  const jsonFiles = readdirSync(rawDirectory).filter((name) => name.endsWith(".json"));
  return jsonFiles.map((name) => readJson<RunRecord>(join(rawDirectory, name)));
}

function readArchivedMeta(resultsDirectory: string): ReportMeta | null {
  const metaPath = join(resultsDirectory, META_FILENAME);
  if (!fileExists(metaPath)) return null;
  return readJson<ReportMeta>(metaPath);
}

// ---- density (static, zero spend) ---------------------------------------------

function runDensityCommand(flags: Flags): void {
  const referenceMeasurements = loadReferenceArtifacts(
    flags.referenceArtifacts ?? undefined,
  );
  const measurements =
    referenceMeasurements.length > 0
      ? referenceMeasurements
      : collectCanonicalArtifacts(readLatestArchivedRecords());

  if (measurements.length === 0) {
    console.log(
      "No canonical artifacts found: write reference artifacts to " +
        "evals/fixtures/artifacts/<scenario>/<arm>.<ext>, or run the matrix first.",
    );
    return;
  }

  for (const measurement of [...measurements].sort((left, right) => left.bytes - right.bytes)) {
    console.log(
      `${measurement.scenarioId}\t${measurement.armId}\t${measurement.bytes} bytes\t` +
        `~${measurement.approximateTokens} tokens (APPROX, see report methodology)`,
    );
  }
}

function measureDensity(records: readonly RunRecord[], flags: Flags): ArtifactMeasurement[] {
  const referenceMeasurements = loadReferenceArtifacts(flags.referenceArtifacts ?? undefined);
  if (referenceMeasurements.length > 0) return referenceMeasurements;
  return collectCanonicalArtifacts(records);
}

function readLatestArchivedRecords(): RunRecord[] {
  const latest = findLatestResultsDirectory();
  if (!latest) return [];
  return readArchivedRecords(latest);
}

// ---- Spend --------------------------------------------------------------------

function printPlan(cells: readonly Cell[]): void {
  const arms = new Set(cells.map((cell) => cell.arm.id));
  const scenarios = new Set(cells.map((cell) => cell.scenario.id));
  const models = new Set(cells.map((cell) => cell.model));

  console.log(
    `Planned: ${cells.length} runs — ${arms.size} arms x ${scenarios.size} scenarios x ${models.size} models`,
  );

  const estimate = estimateSpendUsd(cells);
  console.log(
    `Estimated spend: ~$${estimate.totalUsd.toFixed(2)} (${estimate.basis}). ` +
      "A repair turn costs extra, so treat this as a floor.",
  );
}

type SpendEstimate = { totalUsd: number; basis: string };

function estimateSpendUsd(cells: readonly Cell[]): SpendEstimate {
  const priorCostByModel = costPerRunFromLatestArchive();

  const totalUsd = cells.reduce((runningTotal, cell) => {
    const measuredPrior = priorCostByModel.get(cell.model);
    return runningTotal + (measuredPrior ?? FALLBACK_COST_PER_RUN_USD[cell.model]);
  }, 0);

  const basis =
    priorCostByModel.size > 0
      ? "per-run cost measured from the most recent archive"
      : "ROUGH PRIOR — no archive to measure against; the actual cost is printed after the run";

  return { totalUsd, basis };
}

function costPerRunFromLatestArchive(): Map<EvalModel, number> {
  const records = readLatestArchivedRecords();
  const costPerRun = new Map<EvalModel, number>();
  if (records.length === 0) return costPerRun;

  for (const model of everyModel()) {
    const modelRecords = records.filter((record) => record.model === model);
    if (modelRecords.length === 0) continue;

    const spend = summarizeSpend(modelRecords);
    costPerRun.set(model, spend.coldCacheUsd / modelRecords.length);
  }

  return costPerRun;
}

function printActualSpend(records: readonly RunRecord[]): void {
  const spend = summarizeSpend(records);
  console.log(`\nActual cost across ${spend.runs} runs:`);
  console.log(`  cold-cache (token math):  $${spend.coldCacheUsd.toFixed(4)}`);
  console.log(`  warm-cache (token math):  $${spend.warmCacheUsd.toFixed(4)}`);
  console.log(`  as reported by the CLI:   $${spend.reportedUsd.toFixed(4)}`);
}

async function confirmSpend(skipConfirmation: boolean): Promise<boolean> {
  if (skipConfirmation) return true;

  if (!process.stdin.isTTY) {
    throw new Error("not a TTY: pass --yes to confirm the spend non-interactively");
  }

  const answer = prompt("Proceed? [y/N]");
  return answer?.trim().toLowerCase() === "y";
}

// ---- Meta ---------------------------------------------------------------------

function buildMeta(
  resultsDirectory: string,
  records: readonly RunRecord[],
  harnessConstantByModel: ReadonlyMap<EvalModel, HarnessConstant>,
): ReportMeta {
  return {
    generatedAt: new Date().toISOString(),
    // The dated ids the aliases resolve to are not exposed on the RunRecord, so
    // they are left unrecorded rather than guessed — the report prints "NOT
    // RECORDED IN THE ARCHIVE" instead of a model id nobody verified.
    modelIds: {},
    claudeCliVersion: null,
    scenarios: scenarioSummariesFor(records),
    harnessConstantsByModel: Object.fromEntries(harnessConstantByModel),
    archiveRelativePath: relative(process.cwd(), resultsDirectory),
    bootstrap: DEFAULT_BOOTSTRAP_OPTIONS,
  };
}

function scenarioSummariesFor(records: readonly RunRecord[]): ScenarioSummary[] {
  const scenarioIds = new Set(records.map((record) => record.scenarioId));

  return [...scenarioIds].flatMap((scenarioId) => {
    const scenario = everyScenario.find((candidate) => candidate.id === scenarioId);
    if (!scenario) return [];

    return [
      {
        id: scenario.id,
        title: scenario.title,
        exercisesLadder: scenario.exercisesLadder,
        sourceFileRelativePaths: scenario.sourceFiles.map((file) => file.relativePath),
        sourceFileBytes: sumSourceFileBytes(scenario),
      },
    ];
  });
}

function sumSourceFileBytes(scenario: EvalScenario): number {
  return scenario.sourceFiles.reduce((runningTotal, file) => {
    if (!fileExists(file.absolutePath)) return runningTotal;
    return runningTotal + statSync(file.absolutePath).size;
  }, 0);
}

// ---- Parsing ------------------------------------------------------------------

function parseArms(value: string | undefined): Arm[] {
  if (!value) throw new Error(`--arms is required. Known arms: ${everyArmId().join(", ")}`);

  return splitList(value).map((armIdText) => {
    const armId = toArmId(armIdText);
    if (!armId) {
      throw new Error(`unknown arm "${armIdText}". Known arms: ${everyArmId().join(", ")}`);
    }

    const arm = armFor(armId);
    if (!arm) throw new Error(`arm "${armId}" is declared but not implemented in evals/arms`);
    return arm;
  });
}

function parseScenarios(value: string | undefined): EvalScenario[] {
  if (!value) {
    throw new Error(`--scenarios is required. Known scenarios: ${everyScenarioId().join(", ")}`);
  }

  return splitList(value).map((scenarioId) => {
    const scenario = everyScenario.find((candidate) => candidate.id === scenarioId);
    if (!scenario) {
      throw new Error(
        `unknown scenario "${scenarioId}". Known scenarios: ${everyScenarioId().join(", ")}`,
      );
    }
    return scenario;
  });
}

function parseModels(value: string): EvalModel[] {
  return splitList(value).map(parseModel);
}

function parseModel(value: string): EvalModel {
  const model = everyModel().find((candidate) => candidate === value);
  if (!model) {
    throw new Error(`unknown model "${value}". Known models: ${everyModel().join(", ")}`);
  }
  return model;
}

function parseReplicates(value: string | undefined): number {
  if (value === undefined) return DEFAULT_REPLICATES;

  const replicates = Number.parseInt(value, 10);
  if (!Number.isFinite(replicates) || replicates < 1) {
    throw new Error(`--replicates must be a positive integer, got "${value}"`);
  }
  return replicates;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function toArmId(value: string): ArmId | null {
  return everyArmId().find((armId) => armId === value) ?? null;
}

function toCommand(value: string | undefined): Command | null {
  const commands = Object.values(Command);
  return commands.find((command) => command === value) ?? null;
}

function everyArmId(): ArmId[] {
  return Object.values(ArmId);
}

function everyModel(): EvalModel[] {
  return Object.values(EvalModel);
}

function everyScenarioId(): string[] {
  return everyScenario.map((scenario) => scenario.id);
}

// Only the parchment and scrambled arms author through the canvas tool; the
// rival formats write a file, so the daemon is not booted for them.
function usesTheCanvasDaemon(armId: ArmId): boolean {
  const arm = armFor(armId);
  return arm?.surface === AuthoringSurface.CanvasTool;
}

// ---- Files --------------------------------------------------------------------

function createResultsDirectory(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = join(EvalPaths.results, timestamp);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function findLatestResultsDirectory(): string | null {
  if (!directoryExists(EvalPaths.results)) return null;

  const timestamps = readdirSync(EvalPaths.results, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const latest = timestamps[timestamps.length - 1];
  if (!latest) return null;
  return join(EvalPaths.results, latest);
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, JSON_INDENT), TEXT_ENCODING);
}

function readJson<Value>(path: string): Value {
  return JSON.parse(readFileSync(path, TEXT_ENCODING));
}

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function describeCell(cell: Cell): string {
  return `${cell.arm.id} / ${cell.scenario.id} / ${cell.model} / rep ${cell.replicate}`;
}

function printUsage(): void {
  const armList = everyArmId().join(", ");
  const modelList = everyModel().join(", ");
  const priceLines = everyModel().map((model) => {
    const pricing = ModelPricing[model];
    return `    ${model}: $${pricing.inputPerMillionUsd}/M in, $${pricing.outputPerMillionUsd}/M out`;
  });

  console.log(
    [
      "Usage: bun run evals/cli.ts <command> [flags]",
      "",
      "Commands:",
      "  pilot    --arms <ids> --scenarios <ids> [--model <id>] [--replicates <n>] [--yes]",
      "  matrix   [--arms <ids>] [--scenarios <ids>] [--models <ids>] [--replicates <n>] [--yes]",
      "  density  [--reference-artifacts <dir>]        static, zero spend",
      "  report   --from <resultsDir>                  offline, zero spend",
      "",
      "Flags:",
      "  --harness-baseline <n>   Tokens in the Claude Code system prompt, measured by a control",
      "                           run. Without it, the report DERIVES an upper bound and says so.",
      "",
      `Arms:   ${armList}`,
      `Models: ${modelList}`,
      ...priceLines,
    ].join("\n"),
  );
}

await main();
