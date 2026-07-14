// The daemon's hydration step, stubbed at eval scope.
//
// THE FIDELITY LADDER IS THIS FILE. A high-fidelity arm authors an INTENT —
// "diff this file", "table this CSV" — and the daemon supplies the bytes at push
// time. A low-fidelity arm has no such door: it must paste the bytes itself, and
// pays for every one of them in output tokens. Whether that difference is worth
// one or two orders of magnitude is exactly what the eval measures, so what the
// hydrator can and cannot resolve is a load-bearing part of the claim.
//
// Two of the authoring tags below — GitDiff and LogStream — do not exist in the
// product catalog at all. They are AUTHORING-side intents that lower here into
// real catalog components (DiffViewer, Chart) whose required props the model
// never had to emit. The real engine lives on an unmerged branch; this is the
// same lowering, sized for the eval's four scenarios.
//
// SAFETY: every path resolves inside evals/fixtures/, or it throws. A model that
// authors src="../../../../etc/passwd" gets an issue back and no read happens.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { JsonRenderSpec, UIElement } from "../../src/shared/types.ts";
import { EvalPaths } from "../config.ts";

// TODO(evals/catalog/vocabulary.ts): the catalog agent owns REFERENCE_PROPS.
// These names are the grammar the arms are emitting today; swap this block for
// that module's export the moment it lands, so the arms' authoring vocabulary
// and the hydrator's reader cannot drift apart.
export const REFERENCE_PROPS = {
  // GitDiff / CodeBlock: the file the intent is about, relative to evals/fixtures.
  File: "file",
  // DataTable / Chart: the data file, relative to evals/fixtures.
  Src: "src",
  // GitDiff: the revision to diff against (default HEAD~1), and its counterpart.
  Base: "base",
  Head: "head",
  // GitDiff, alternate spelling: a full "HEAD~1..HEAD" range.
  Diff: "diff",
  // CodeBlock: a 1-based inclusive line range, "40-80".
  Lines: "lines",
} as const;

// The authoring components a reference can arrive on. GitDiff and LogStream are
// authoring-only; DataTable, CodeBlock and Chart are real catalog components
// that a high-fidelity arm may address with a reference prop instead of data.
export const ReferenceComponent = {
  GitDiff: "GitDiff",
  LogStream: "LogStream",
  DataTable: "DataTable",
  CodeBlock: "CodeBlock",
  Chart: "Chart",
  DiffViewer: "DiffViewer",
} as const;

export type ReferenceComponent = (typeof ReferenceComponent)[keyof typeof ReferenceComponent];

// WHICH PROPS MEAN "GO AND FETCH THIS". Getting this wrong in the permissive
// direction would silently destroy the experiment: a LOW-fidelity arm pastes
// `before` and `after` into a DiffViewer and also names the `file` — and `file`
// is a real DiffViewer prop, not a reference. Treating its presence as a
// reference would have the hydrator re-fetch the bytes from git and hand the
// low-fidelity arm the high-fidelity arm's result for free, making the two rungs
// indistinguishable. So each component names ONLY the props that mean "fetch".
const FETCHING_PROPS_BY_COMPONENT = {
  // Authoring-only tags: they exist for no other purpose than to be hydrated.
  [ReferenceComponent.GitDiff]: [REFERENCE_PROPS.File, REFERENCE_PROPS.Base, REFERENCE_PROPS.Head, REFERENCE_PROPS.Diff],
  [ReferenceComponent.LogStream]: [REFERENCE_PROPS.File, REFERENCE_PROPS.Src],
  // `file` is a REAL DiffViewer prop (the diff's title). Only a revision makes it
  // a reference.
  [ReferenceComponent.DiffViewer]: [REFERENCE_PROPS.Base, REFERENCE_PROPS.Head, REFERENCE_PROPS.Diff],
  [ReferenceComponent.DataTable]: [REFERENCE_PROPS.Src],
  [ReferenceComponent.CodeBlock]: [REFERENCE_PROPS.File, REFERENCE_PROPS.Src, REFERENCE_PROPS.Lines],
  [ReferenceComponent.Chart]: [REFERENCE_PROPS.Src, REFERENCE_PROPS.File],
} as const satisfies Record<ReferenceComponent, readonly string[]>;

// The authoring-only tags are always references: the catalog has no such
// component, so an unhydrated one is not a thing that can render at all. When
// they arrive malformed, the resolver says so rather than passing them through
// to a daemon that would only report "unknown component type".
const ALWAYS_REFERENCE_COMPONENTS: readonly ReferenceComponent[] = [
  ReferenceComponent.GitDiff,
  ReferenceComponent.LogStream,
];

export function referenceComponentOf(type: string): ReferenceComponent | null {
  const components = Object.values(ReferenceComponent);
  return components.find((component) => component.toLowerCase() === type.toLowerCase()) ?? null;
}

// Shared by the spec walk (props) and the markup lowering (HTML attributes), so
// the two can never disagree about what counts as a reference.
export function isReferenceProps(
  component: ReferenceComponent,
  propNames: readonly string[],
): boolean {
  if (ALWAYS_REFERENCE_COMPONENTS.includes(component)) return true;

  const fetchingProps: readonly string[] = FETCHING_PROPS_BY_COMPONENT[component];
  return propNames.some((propName) => fetchingProps.includes(propName.toLowerCase()));
}

// What each authoring intent lowers to.
const CatalogComponent = {
  DiffViewer: "DiffViewer",
  DataTable: "DataTable",
  CodeBlock: "CodeBlock",
  Chart: "Chart",
} as const;

const DEFAULT_DIFF_BASE = "HEAD~1";
const DEFAULT_DIFF_HEAD = "HEAD";
const DIFF_RANGE_SEPARATOR = "..";

const LINE_RANGE_SEPARATOR = "-";
const FIRST_LINE_NUMBER = 1;

const LOG_BUCKET_MINUTES = 10;
const MINUTES_PER_MS = 60_000;
const LOG_ERROR_LEVEL = "ERROR";

// The keys the aggregated log chart plots. They match FIXTURE_FACTS.log
// .errorsByTenMinuteBucket so the fixture's hand-counted ground truth and the
// hydrator's output are directly comparable — if they ever disagree, one of them
// is wrong and the test says which.
const LOG_CHART_X_KEY = "bucketStart";
const LOG_CHART_Y_KEY = "errorCount";
const LOG_CHART_KIND = "bar";

const CSV_DELIMITER = ",";
const BOOLEAN_LITERALS = ["true", "false"] as const;

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  json: "json",
  sh: "shell",
  md: "markdown",
  csv: "text",
  log: "text",
};

export class FixturePathEscapeError extends Error {
  constructor(requestedPath: string) {
    super(
      `refusing to read "${requestedPath}": it resolves outside ${EvalPaths.fixtures}. ` +
        `The hydrator reads fixture files and nothing else.`,
    );
    this.name = "FixturePathEscapeError";
  }
}

export type HydrationResult = {
  spec: JsonRenderSpec;
  // Arm-facing: an unresolvable reference is the arm's own toolchain telling it
  // what it got wrong, and it feeds RepairSignal.toolchainIssues verbatim.
  issues: string[];
};

export type ResolvedElement = {
  element: UIElement;
  issues: string[];
};

// ---- The walk ---------------------------------------------------------------

export function hydrateSpec(spec: JsonRenderSpec): HydrationResult {
  const issues: string[] = [];
  const elements: Record<string, UIElement> = {};

  for (const [key, element] of Object.entries(spec.elements)) {
    const resolved = resolveElement(element, key);
    elements[key] = resolved.element;
    issues.push(...resolved.issues);
  }

  return { spec: { ...spec, elements }, issues };
}

// An element that carries no reference prop is already hydrated — a
// low-fidelity arm's pasted DataTable passes through untouched, which is what
// makes the two rungs comparable at all.
export function resolveElement(element: UIElement, elementKey: string): ResolvedElement {
  if (!isReferenceElement(element)) return { element, issues: [] };

  try {
    return resolveReference(element, elementKey);
  } catch (error) {
    return { element, issues: [`elements/${elementKey}: ${messageOf(error)}`] };
  }
}

export function isReferenceElement(element: UIElement): boolean {
  const component = referenceComponentOf(element.type);
  if (component === null) return false;

  const stringPropNames = Object.entries(element.props)
    .filter(([, value]) => typeof value === "string")
    .map(([propName]) => propName);

  return isReferenceProps(component, stringPropNames);
}

function resolveReference(element: UIElement, elementKey: string): ResolvedElement {
  const component = referenceComponentOf(element.type);

  if (component === ReferenceComponent.GitDiff) return resolveGitDiff(element);
  if (component === ReferenceComponent.DiffViewer) return resolveGitDiff(element);
  if (component === ReferenceComponent.LogStream) return resolveLogStream(element);
  if (component === ReferenceComponent.Chart) return resolveLogStream(element);
  if (component === ReferenceComponent.DataTable) return resolveDataTable(element);
  if (component === ReferenceComponent.CodeBlock) return resolveCodeBlock(element);

  return {
    element,
    issues: [
      `elements/${elementKey}: <${element.type}> carries a reference prop, but nothing knows how to ` +
        `hydrate it. Reference-capable components: ${Object.values(ReferenceComponent).join(", ")}.`,
    ],
  };
}

// ---- GitDiff → DiffViewer ---------------------------------------------------

function resolveGitDiff(element: UIElement): ResolvedElement {
  const filePath = requiredStringProp(element, REFERENCE_PROPS.File);
  const absolutePath = resolveFixturePath(filePath);
  const repoRoot = findGitRepoRoot(absolutePath);
  const pathInRepo = relative(repoRoot, absolutePath);
  const revisions = revisionsOf(element);

  const before = readFileAtRevision(repoRoot, revisions.base, pathInRepo);
  const after = readFileAtRevision(repoRoot, revisions.head, pathInRepo);

  return {
    element: {
      ...element,
      type: CatalogComponent.DiffViewer,
      props: { ...withoutReferenceProps(element.props), file: filePath, before, after },
    },
    issues: [],
  };
}

type DiffRevisions = { base: string; head: string };

// Two spellings are accepted because two arms authored them: base="HEAD~1" and
// the range form diff="HEAD~1..HEAD". Neither is more correct; refusing one
// would be the harness picking a winner on syntax.
function revisionsOf(element: UIElement): DiffRevisions {
  const range = optionalStringProp(element, REFERENCE_PROPS.Diff);
  if (range !== null) return parseRevisionRange(range);

  return {
    base: optionalStringProp(element, REFERENCE_PROPS.Base) ?? DEFAULT_DIFF_BASE,
    head: optionalStringProp(element, REFERENCE_PROPS.Head) ?? DEFAULT_DIFF_HEAD,
  };
}

function parseRevisionRange(range: string): DiffRevisions {
  const [base, head] = range.split(DIFF_RANGE_SEPARATOR);
  const hasBothEnds = base !== undefined && base.length > 0 && head !== undefined && head.length > 0;
  if (!hasBothEnds) {
    throw new Error(
      `"${REFERENCE_PROPS.Diff}=${range}" is not a revision range. Expected "<base>..<head>", e.g. "HEAD~1..HEAD".`,
    );
  }
  return { base, head };
}

function findGitRepoRoot(absolutePath: string): string {
  const fixturesRoot = realpathSync(EvalPaths.fixtures);
  let candidate = dirname(absolutePath);

  while (candidate.startsWith(fixturesRoot)) {
    if (existsSync(join(candidate, ".git"))) return candidate;
    candidate = dirname(candidate);
  }

  throw new Error(`no git repository contains "${absolutePath}" inside ${fixturesRoot}.`);
}

function readFileAtRevision(repoRoot: string, revision: string, pathInRepo: string): string {
  try {
    return execFileSync("git", ["show", `${revision}:${pathInRepo}`], {
      cwd: repoRoot,
      encoding: "utf8",
    });
  } catch (error) {
    throw new Error(`git show ${revision}:${pathInRepo} failed in ${repoRoot} — ${messageOf(error)}`);
  }
}

// ---- LogStream → Chart ------------------------------------------------------

function resolveLogStream(element: UIElement): ResolvedElement {
  const logPath = referenceFilePropOf(element);
  const absolutePath = resolveFixturePath(logPath);
  const logText = readFileSync(absolutePath, "utf8");
  const data = countErrorsByTimeBucket(logText);

  return {
    element: {
      ...element,
      type: CatalogComponent.Chart,
      props: {
        ...withoutReferenceProps(element.props),
        kind: LOG_CHART_KIND,
        data,
        x: LOG_CHART_X_KEY,
        y: LOG_CHART_Y_KEY,
      },
    },
    issues: [],
  };
}

export type LogErrorBucket = { [LOG_CHART_X_KEY]: string; [LOG_CHART_Y_KEY]: number };

// Empty buckets are emitted, not skipped: a chart that silently drops the quiet
// ten minutes before an incident is a chart that lies about the incident's shape.
export function countErrorsByTimeBucket(logText: string): LogErrorBucket[] {
  const entries = parseLogEntries(logText);
  if (entries.length === 0) return [];

  const timestamps = entries.map((entry) => entry.timestampMs);
  const firstBucketMs = floorToBucket(Math.min(...timestamps));
  const lastBucketMs = floorToBucket(Math.max(...timestamps));

  const errorCountByBucket = new Map<number, number>();
  for (const entry of entries) {
    if (entry.level !== LOG_ERROR_LEVEL) continue;
    const bucketMs = floorToBucket(entry.timestampMs);
    errorCountByBucket.set(bucketMs, (errorCountByBucket.get(bucketMs) ?? 0) + 1);
  }

  const buckets: LogErrorBucket[] = [];
  const bucketWidthMs = LOG_BUCKET_MINUTES * MINUTES_PER_MS;
  for (let bucketMs = firstBucketMs; bucketMs <= lastBucketMs; bucketMs += bucketWidthMs) {
    buckets.push({
      [LOG_CHART_X_KEY]: formatBucketLabel(bucketMs),
      [LOG_CHART_Y_KEY]: errorCountByBucket.get(bucketMs) ?? 0,
    });
  }
  return buckets;
}

type LogEntry = { timestampMs: number; level: string };

const LOG_LINE_PATTERN = /^(\S+)\s+(\w+)\s/;

function parseLogEntries(logText: string): LogEntry[] {
  return logText
    .split("\n")
    .map(parseLogLine)
    .filter(isPresent);
}

function parseLogLine(line: string): LogEntry | null {
  const match = line.match(LOG_LINE_PATTERN);
  if (match === null) return null;

  const [, rawTimestamp, level] = match;
  if (rawTimestamp === undefined || level === undefined) return null;

  const timestampMs = Date.parse(rawTimestamp);
  if (Number.isNaN(timestampMs)) return null;

  return { timestampMs, level };
}

function floorToBucket(timestampMs: number): number {
  const bucketWidthMs = LOG_BUCKET_MINUTES * MINUTES_PER_MS;
  return Math.floor(timestampMs / bucketWidthMs) * bucketWidthMs;
}

function formatBucketLabel(bucketMs: number): string {
  const bucketStart = new Date(bucketMs);
  const hours = String(bucketStart.getUTCHours()).padStart(2, "0");
  const minutes = String(bucketStart.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

// ---- DataTable src → columns + rows -----------------------------------------

function resolveDataTable(element: UIElement): ResolvedElement {
  const csvPath = referenceFilePropOf(element);
  const absolutePath = resolveFixturePath(csvPath);
  const csvText = readFileSync(absolutePath, "utf8");
  const table = parseCsv(csvText);

  return {
    element: {
      ...element,
      type: CatalogComponent.DataTable,
      props: { ...withoutReferenceProps(element.props), columns: table.columns, rows: table.rows },
    },
    issues: [],
  };
}

export type CsvColumn = { key: string; header: string; type: string };
export type CsvTable = { columns: CsvColumn[]; rows: Record<string, unknown>[] };

export function parseCsv(csvText: string): CsvTable {
  const lines = csvText.split("\n").filter((line) => line.trim().length > 0);
  const headerLine = lines[0];
  if (headerLine === undefined) throw new Error("the CSV is empty: no header row.");

  const headers = headerLine.split(CSV_DELIMITER).map((header) => header.trim());
  const rawRows = lines.slice(1).map((line) => line.split(CSV_DELIMITER));

  const rows = rawRows.map((cells) => buildRow(headers, cells));
  const columns = headers.map((header) => ({
    key: header,
    header,
    type: inferColumnType(rows, header),
  }));

  return { columns, rows };
}

function buildRow(headers: string[], cells: string[]): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  headers.forEach((header, index) => {
    row[header] = coerceCell(cells[index] ?? "");
  });
  return row;
}

function coerceCell(rawCell: string): unknown {
  const cell = rawCell.trim();
  if (isNumericString(cell)) return Number(cell);
  return cell;
}

// The column type is the DataTable's sort comparator hint, so it is inferred
// from what the column actually holds rather than declared by the author.
function inferColumnType(rows: Record<string, unknown>[], header: string): string {
  const values = rows.map((row) => row[header]);
  const isNumeric = values.length > 0 && values.every((value) => typeof value === "number");
  if (isNumeric) return "number";

  const isBoolean = values.length > 0 && values.every(isBooleanLiteral);
  if (isBoolean) return "boolean";

  return "string";
}

function isBooleanLiteral(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const literals: readonly string[] = BOOLEAN_LITERALS;
  return literals.includes(value.toLowerCase());
}

const NUMERIC_STRING_PATTERN = /^-?\d+(\.\d+)?$/;

function isNumericString(value: string): boolean {
  return NUMERIC_STRING_PATTERN.test(value);
}

// ---- CodeBlock file + lines → code ------------------------------------------

function resolveCodeBlock(element: UIElement): ResolvedElement {
  const filePath = requiredStringProp(element, REFERENCE_PROPS.File);
  const absolutePath = resolveFixturePath(filePath);
  const fileText = readFileSync(absolutePath, "utf8");
  const range = lineRangeOf(element, fileText);
  const code = sliceLines(fileText, range);

  return {
    element: {
      ...element,
      type: CatalogComponent.CodeBlock,
      props: {
        ...withoutReferenceProps(element.props),
        code,
        title: filePath,
        startLine: range.startLine,
        language: languageOf(filePath),
      },
    },
    issues: [],
  };
}

type LineRange = { startLine: number; endLine: number };

function lineRangeOf(element: UIElement, fileText: string): LineRange {
  const rawRange = optionalStringProp(element, REFERENCE_PROPS.Lines);
  const lastLine = fileText.split("\n").length;
  if (rawRange === null) return { startLine: FIRST_LINE_NUMBER, endLine: lastLine };

  const [rawStart, rawEnd] = rawRange.split(LINE_RANGE_SEPARATOR);
  const startLine = Number(rawStart);
  const endLine = Number(rawEnd);
  const isWellFormed =
    Number.isInteger(startLine) &&
    Number.isInteger(endLine) &&
    startLine >= FIRST_LINE_NUMBER &&
    endLine >= startLine;

  if (!isWellFormed) {
    throw new Error(
      `"${REFERENCE_PROPS.Lines}=${rawRange}" is not a line range. Expected "<start>-<end>", 1-based and inclusive, e.g. "40-80".`,
    );
  }
  return { startLine, endLine };
}

function sliceLines(fileText: string, range: LineRange): string {
  const lines = fileText.split("\n");
  return lines.slice(range.startLine - FIRST_LINE_NUMBER, range.endLine).join("\n");
}

function languageOf(filePath: string): string {
  const extension = filePath.split(".").at(-1) ?? "";
  return LANGUAGE_BY_EXTENSION[extension.toLowerCase()] ?? "text";
}

// ---- Paths ------------------------------------------------------------------

// The one safety property in this file. realpath is taken on BOTH ends so a
// symlink planted inside the fixtures tree cannot point out of it: containment
// is checked between real paths, never between the strings the model authored.
export function resolveFixturePath(referencedPath: string): string {
  const fixturesRoot = realpathSync(EvalPaths.fixtures);
  const candidate = resolve(fixturesRoot, referencedPath);

  if (!existsSync(candidate)) {
    assertInsideFixtures(candidate, fixturesRoot, referencedPath);
    throw new Error(`"${referencedPath}" does not exist under ${fixturesRoot}.`);
  }

  const realPath = realpathSync(candidate);
  assertInsideFixtures(realPath, fixturesRoot, referencedPath);
  return realPath;
}

function assertInsideFixtures(candidate: string, fixturesRoot: string, referencedPath: string): void {
  const isInside = candidate === fixturesRoot || candidate.startsWith(`${fixturesRoot}${sep}`);
  if (!isInside) throw new FixturePathEscapeError(referencedPath);
}

// ---- Props ------------------------------------------------------------------

// A file reference arrives as `file` on GitDiff/CodeBlock and as `src` on
// DataTable/Chart. Both are the same intent — name a file, get its bytes.
function referenceFilePropOf(element: UIElement): string {
  const src = optionalStringProp(element, REFERENCE_PROPS.Src);
  if (src !== null) return src;
  return requiredStringProp(element, REFERENCE_PROPS.File);
}

function requiredStringProp(element: UIElement, propName: string): string {
  const value = optionalStringProp(element, propName);
  if (value !== null) return value;

  throw new Error(`<${element.type}> needs a "${propName}" attribute naming a file under evals/fixtures/.`);
}

function optionalStringProp(element: UIElement, propName: string): string | null {
  const value = element.props[propName];
  if (typeof value !== "string") return null;
  if (value.trim().length === 0) return null;
  return value;
}

// The reference props are the AUTHORING vocabulary; the catalog components have
// never heard of them, and prepareSpec would reject them as unknown props.
function withoutReferenceProps(props: Record<string, unknown>): Record<string, unknown> {
  const referencePropNames: readonly string[] = Object.values(REFERENCE_PROPS);
  const entries = Object.entries(props).filter(([name]) => !referencePropNames.includes(name));
  return Object.fromEntries(entries);
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
