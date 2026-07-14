import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES_DIR = import.meta.dirname;

const DIFF_BASE_REF = "HEAD~1";
const DIFF_HEAD_REF = "HEAD";
const DIFF_TARGET_FILE = "src/server.ts";
const TEXT_ENCODING = "utf8";

export const FIXTURE_PATHS = {
  gitRepo: join(FIXTURES_DIR, "repo"),
  gitDiffTarget: join(FIXTURES_DIR, "repo", DIFF_TARGET_FILE),
  csv: join(FIXTURES_DIR, "data", "results.csv"),
  log: join(FIXTURES_DIR, "logs", "app.log"),
} as const;

export function readGitDiffFixture(): string {
  const gitArguments = [
    "diff",
    DIFF_BASE_REF,
    DIFF_HEAD_REF,
    "--",
    DIFF_TARGET_FILE,
  ];
  return execFileSync("git", gitArguments, {
    cwd: FIXTURE_PATHS.gitRepo,
    encoding: TEXT_ENCODING,
  });
}

export function readCsvFixture(): string {
  return readFileSync(FIXTURE_PATHS.csv, TEXT_ENCODING);
}

export function readLogFixture(): string {
  return readFileSync(FIXTURE_PATHS.log, TEXT_ENCODING);
}

/**
 * Ground truth a rubric asserts against a real browser DOM. Every number below was
 * measured from the fixture files, not estimated. Each block records the command
 * that produced it so the facts can be re-derived after any fixture edit.
 */
export const FIXTURE_FACTS = {
  // head -1 data/results.csv
  // tail -n +2 data/results.csv | wc -l                 => 50
  // awk -F, 'NR>1 && $8=="true"' data/results.csv | wc -l => 31
  csv: {
    path: FIXTURE_PATHS.csv,
    headerColumns: [
      "run_id",
      "scenario",
      "model",
      "arm",
      "tokens_in",
      "tokens_out",
      "latency_ms",
      "passed",
    ],
    dataRowCount: 50,
    passedRowCount: 31,
    // awk -F, '$1=="r007"||$1=="r023"||$1=="r044"{print $1","$2","$6}' data/results.csv
    // Each triple must appear as three cells within one rendered table row.
    sampleRows: [
      { runId: "r007", scenario: "git_diff_review", tokensOut: 604 },
      { runId: "r023", scenario: "log_error_chart", tokensOut: 1921 },
      { runId: "r044", scenario: "mermaid_render", tokensOut: 612 },
    ],
  },

  // wc -l < logs/app.log        => 100
  // grep -c ' ERROR ' logs/app.log => 22
  // grep -c ' WARN '  logs/app.log => 18
  // grep -c ' INFO '  logs/app.log => 60
  log: {
    path: FIXTURE_PATHS.log,
    totalLineCount: 100,
    errorCount: 22,
    warnCount: 18,
    infoCount: 60,
    windowStart: "2026-05-11T09:00:04.182Z",
    windowEnd: "2026-05-11T09:59:41.204Z",
    // Every line falls in a single hour, so a time chart must bucket below hour scale.
    hoursInWindow: ["09"],
    // grep ' ERROR ' logs/app.log | sed -E 's/^.*T([0-9]{2}):([0-9])[0-9]:.*$/\1:\20/' | sort | uniq -c
    // The 09:30 bucket is the spike a rendered error-rate chart must show as the peak.
    errorsByTenMinuteBucket: [
      { bucketStart: "09:00", errorCount: 0 },
      { bucketStart: "09:10", errorCount: 1 },
      { bucketStart: "09:20", errorCount: 5 },
      { bucketStart: "09:30", errorCount: 11 },
      { bucketStart: "09:40", errorCount: 4 },
      { bucketStart: "09:50", errorCount: 1 },
    ],
    peakErrorBucketStart: "09:30",
  },

  // git -C repo diff HEAD~1 HEAD -- src/server.ts | wc -l        => 250
  // git -C repo diff --numstat HEAD~1 HEAD -- src/server.ts      => 126  24
  // git -C repo diff HEAD~1 HEAD -- src/server.ts | grep -c '^@@' => 11
  gitDiff: {
    repoPath: FIXTURE_PATHS.gitRepo,
    filePath: DIFF_TARGET_FILE,
    command: "git diff HEAD~1 HEAD -- src/server.ts",
    addedLineCount: 126,
    removedLineCount: 24,
    totalDiffLineCount: 250,
    hunkCount: 11,

    // A rendered diff must prove BOTH sides. Monaco virtualizes (~19 lines mounted)
    // and intercepts scrolling, so a rubric can only assert lines that land in the
    // first viewport. Both lines below sit in the first 12 lines of their file:
    //   git show HEAD~1:src/server.ts | grep -n 'CACHE_TTL_MS = 30_000'      => 11
    //   git show HEAD:src/server.ts   | grep -n 'REQUEST_TIMEOUT_MS = 15_000' => 12
    addedCodeLine: "const REQUEST_TIMEOUT_MS = 15_000;",
    removedCodeLine: "const CACHE_TTL_MS = 30_000;",

    // Removed at original line 223, far below any virtualized viewport. Asserting it
    // only makes sense for arms that dump every line into the DOM (raw html/jsx), so
    // it doubles as a "full content was pasted" signal.
    //   git show HEAD~1:src/server.ts | grep -n 'inventory.deleteItem' => 223
    removedCodeLineDeep: "await inventory.deleteItem(item.id);",
  },
} as const;
