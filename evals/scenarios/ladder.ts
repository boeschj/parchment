// The fidelity-ladder scenarios: the headline experiment.
//
// Each one is a real coding-agent task whose SOURCE DATA LIVES ON DISK. That is
// the whole point. An arm that can reference a path emits ~15 tokens; an arm
// with no reference mechanism must read the file and paste its contents, which
// is thousands of tokens of OUTPUT — the expensive kind. Every arm is handed the
// same fixtures and judged by the same browser rubric, so the gap is measured
// rather than asserted.
//
// The aggregation is stated IN THE PROMPT, identically for every arm (bucket the
// log into ten minutes; render all fifty rows). This is deliberate: it makes the
// ground truth deterministic, so the rubric can be strict without punishing an
// arm merely for choosing a different-but-reasonable bucketing. The ladder is
// what is under test here, not the model's taste in histograms.

import { AssertionKind, type AcceptanceSpec } from "../../bench/acceptance/types.ts";
import { FIXTURE_FACTS, FIXTURE_PATHS } from "../fixtures/index.ts";
import type { EvalScenario, SourceFile } from "../types.ts";

// Paths as the model sees them, relative to the run's working directory. The
// harness copies the fixtures in, so these resolve for a model with Read access.
const RelativeFixturePath = {
  GitRepo: "repo",
  DiffTarget: "repo/src/server.ts",
  Csv: "data/results.csv",
  Log: "logs/app.log",
} as const;

// A page that painted nothing is not a pass, however cleanly it painted nothing.
const NON_EMPTY_CONTENT = {
  kind: AssertionKind.ContentNonEmpty,
  minVisibleTextLength: 200,
  minContentHeightPx: 120,
} as const;

const CLEAN_RENDER = [
  { kind: AssertionKind.NoConsoleErrors },
  { kind: AssertionKind.NoErrorBoundary },
] as const;

// ---- 1. Git diff of a real ~240-line change --------------------------------
//
// The ladder's sharpest edge. parchment's DiffViewer requires `before` AND
// `after` as strings, so a low-fidelity arm must paste the ENTIRE file twice.
// A high-fidelity arm names the file and the revision range and the daemon runs
// git itself. raw-html and raw-jsx have no reference mechanism at all: they must
// Read the file and inline it. That structural difference IS the finding.

const gitDiffSourceFiles: readonly SourceFile[] = [
  {
    relativePath: RelativeFixturePath.DiffTarget,
    absolutePath: FIXTURE_PATHS.gitDiffTarget,
    description: "The TypeScript server file whose last commit is under review.",
  },
] as const;

const gitDiffAcceptance: AcceptanceSpec = {
  scenarioId: "ladder-git-diff",
  title: "Diff of a real 240-line change, rendered",
  assertions: [
    NON_EMPTY_CONTENT,
    ...CLEAN_RENDER,
    {
      kind: AssertionKind.TextPresent,
      description: "names the file under review and paints both sides of the change",
      values: [
        FIXTURE_FACTS.gitDiff.filePath,
        FIXTURE_FACTS.gitDiff.addedCodeLine,
        FIXTURE_FACTS.gitDiff.removedCodeLine,
      ],
    },
  ],
};

export const gitDiffLadderScenario: EvalScenario = {
  id: "ladder-git-diff",
  title: "Show the diff of a real file with changed lines highlighted",
  request: `Show me the diff of ${RelativeFixturePath.DiffTarget} between HEAD~1 and HEAD, as a side-by-side diff view with the changed lines highlighted. The git repository is at ./${RelativeFixturePath.GitRepo}. Both the original and the modified version of the file must be visible in the rendered diff.`,
  inlineData: null,
  sourceFiles: gitDiffSourceFiles,
  exercisesLadder: true,
  acceptance: gitDiffAcceptance,
};

// ---- 2. A 50-row CSV on disk, as a sortable table --------------------------

const csvSourceFiles: readonly SourceFile[] = [
  {
    relativePath: RelativeFixturePath.Csv,
    absolutePath: FIXTURE_PATHS.csv,
    description: "Benchmark results: 50 data rows, 8 columns.",
  },
] as const;

// Each required row is checked for CO-OCCURRENCE within a single <tr>, so a page
// that prints the ids in one place and the token counts in another does not pass.
const csvRequiredRows: string[][] = FIXTURE_FACTS.csv.sampleRows.map((row) => [
  row.runId,
  row.scenario,
  String(row.tokensOut),
]);

const csvAcceptance: AcceptanceSpec = {
  scenarioId: "ladder-csv-table",
  title: "Every row of a 50-row CSV, rendered as a table",
  assertions: [
    NON_EMPTY_CONTENT,
    ...CLEAN_RENDER,
    {
      kind: AssertionKind.TableRows,
      description: "renders all 50 data rows with their real cell values",
      minDataRows: FIXTURE_FACTS.csv.dataRowCount,
      requiredRows: csvRequiredRows,
    },
    {
      kind: AssertionKind.TextPresent,
      description: "labels the columns",
      values: [...FIXTURE_FACTS.csv.headerColumns],
    },
  ],
};

export const csvTableLadderScenario: EvalScenario = {
  id: "ladder-csv-table",
  title: "Render a 50-row CSV on disk as a sortable table",
  request: `Render the CSV at ./${RelativeFixturePath.Csv} as a sortable data table. Show every one of its ${FIXTURE_FACTS.csv.dataRowCount} data rows, with a column for each of its ${FIXTURE_FACTS.csv.headerColumns.length} columns.`,
  inlineData: null,
  sourceFiles: csvSourceFiles,
  exercisesLadder: true,
  acceptance: csvAcceptance,
};

// ---- 3. A 100-line log on disk, as an error-rate chart ----------------------
//
// The bucketing is prescribed so the ground truth is exact: six ten-minute
// buckets across a single hour, peaking at 09:30. An arm that paints one bar for
// the whole window has not charted a rate over time and does not pass.

const logSourceFiles: readonly SourceFile[] = [
  {
    relativePath: RelativeFixturePath.Log,
    absolutePath: FIXTURE_PATHS.log,
    description: "Application log: 100 lines, one hour, 22 ERROR lines clustered mid-window.",
  },
] as const;

const logBucketCount = FIXTURE_FACTS.log.errorsByTenMinuteBucket.length;

const logAcceptance: AcceptanceSpec = {
  scenarioId: "ladder-log-chart",
  title: "Error rate over time, charted from a log on disk",
  assertions: [
    NON_EMPTY_CONTENT,
    ...CLEAN_RENDER,
    {
      kind: AssertionKind.Charts,
      description: "plots one point per ten-minute bucket, bound to the log's real error counts",
      minCharts: 1,
      minDataPointsPerChart: logBucketCount,
      requiredAxisLabels: [FIXTURE_FACTS.log.peakErrorBucketStart],
    },
  ],
};

export const logChartLadderScenario: EvalScenario = {
  id: "ladder-log-chart",
  title: "Chart the error rate over time from a log file on disk",
  request: `Read the application log at ./${RelativeFixturePath.Log} and render a chart of the ERROR rate over time. Bucket the log into ten-minute buckets (09:00, 09:10, 09:20, 09:30, 09:40, 09:50) and plot the number of ERROR lines in each bucket, labelling the x-axis with the bucket start times.`,
  inlineData: null,
  sourceFiles: logSourceFiles,
  exercisesLadder: true,
  acceptance: logAcceptance,
};

export const ladderScenarios = [
  gitDiffLadderScenario,
  csvTableLadderScenario,
  logChartLadderScenario,
] as const;
