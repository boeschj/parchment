// The log aggregator behind {$log}: a log file in, chart rows out. This is the
// rung of the ladder the reference components were missing — a reference that
// only NAMES a file is worth nothing when the answer is six numbers the model
// would have had to compute anyway. So the daemon computes them: it reads every
// line, keeps the ones that match, extracts fields, buckets them by a real time
// interval, and aggregates.
//
// The line grammar is NOT new. Field extraction is the same `parser:
// jsonl|regex|number` (+ a `pattern` of named groups) that canvas_live's
// file-tail sources already speak (../live/parse.ts, ../live/types.ts), and the
// parse itself is literally parseTailLine. A log line means the same thing to a
// tailed source and to an aggregated one; two grammars for one job would be a
// bug in the product, not a feature.
//
// Everything here is pure: text in, rows out. The filesystem lives in paths.ts,
// so the push-time hydrator and the live re-aggregation on file change run the
// exact same function over the exact same bytes.

import { APPEND_VALUE_KEY, parseTailLine } from "../live/parse.ts";
import { TailLineParser } from "../live/types.ts";

// ---- The authoring grammar --------------------------------------------------

// `metric="p95:duration_ms"` — an aggregation over a captured numeric field.
export const LogAggregation = {
  Sum: "sum",
  Avg: "avg",
  Min: "min",
  Max: "max",
  P50: "p50",
  P95: "p95",
  P99: "p99",
} as const;

export type LogAggregation = (typeof LogAggregation)[keyof typeof LogAggregation];

const LOG_AGGREGATIONS = Object.values(LogAggregation);

const PERCENTILE_OF: Partial<Record<LogAggregation, number>> = {
  [LogAggregation.P50]: 50,
  [LogAggregation.P95]: 95,
  [LogAggregation.P99]: 99,
};

// `metric="count"` (the default) and `metric="rate"` need no field: they count
// the lines that matched.
export const LogMetricKind = {
  Count: "count",
  Rate: "rate",
  Numeric: "numeric",
} as const;

export type LogMetricKind = (typeof LogMetricKind)[keyof typeof LogMetricKind];

type LogMetric =
  | { kind: typeof LogMetricKind.Count }
  | { kind: typeof LogMetricKind.Rate }
  | { kind: typeof LogMetricKind.Numeric; aggregation: LogAggregation; field: string };

// The x key of every row. Constant, because the model does not choose it — it is
// the bucket, and the daemon supplies `x` to the Chart.
export const LOG_BUCKET_KEY = "bucket";

const LOG_COUNT_KEY = "count";
const LOG_RATE_KEY = "rate";
const METRIC_FIELD_SEPARATOR = ":";

// Time fields, in the order they are trusted. A `(?<t>…)` capture (or a JSONL
// `t`/`time`/`timestamp` key) is the author's explicit answer to "when did this
// line happen"; the ISO scan below is the fallback that makes the common log
// format work with no configuration at all.
const TIMESTAMP_FIELDS = ["t", "ts", "time", "timestamp"] as const;

// "2026-05-11T09:00:04.182Z", "2026-05-11 09:00:04+02:00", "2026-05-11T09:00:04".
const ISO_TIMESTAMP_PATTERN =
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/;

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;

const MS_PER_DURATION_UNIT = {
  s: MS_PER_SECOND,
  m: MS_PER_MINUTE,
  h: MS_PER_HOUR,
  d: MS_PER_DAY,
  w: MS_PER_WEEK,
} as const;

type DurationUnit = keyof typeof MS_PER_DURATION_UNIT;

const DURATION_PATTERN = /^(\d+)([smhdw])$/;

// The three words `groupBy` used to accept, kept as aliases of the durations
// that replaced them, so every spec written against the old enum still runs.
const NAMED_DURATIONS: Readonly<Record<string, string>> = {
  second: "1s",
  minute: "1m",
  hour: "1h",
  day: "1d",
  week: "1w",
};

// Epoch-aligned buckets fall where a reader expects for every unit but the week:
// 1970-01-01 was a Thursday, so week buckets would start on Thursdays. Shift
// them onto Monday (UTC).
const EPOCH_TO_MONDAY_OFFSET_MS = 4 * MS_PER_DAY;

// A window/interval pair can ask for an unbounded number of points (a year of
// log at 30s is a million). Refuse, naming the fix, rather than melt the browser.
const MAX_LOG_BUCKETS = 2000;

// One line per distinct value of `series`. Past a dozen a chart is unreadable,
// so the biggest series win and the tail is reported in a note.
const MAX_LOG_SERIES = 12;

const VALUE_DECIMALS = 3;

// ---- Inputs and outputs -----------------------------------------------------

// The raw sibling options of a {$log}. Strings, exactly as authored — parsing
// and rejecting them is this module's job, so every caller reports the same
// errors.
export type LogReferenceOptions = {
  groupBy: string | null;
  match: string | null;
  parser: string | null;
  pattern: string | null;
  series: string | null;
  metric: string | null;
};

export type LogChartRow = Record<string, string | number | null>;

// Chart-ready: `rows` is Chart.data, and `x`/`y` are the props the daemon
// supplies alongside it (shared/expressions.ts declares the contract).
export type LogAggregationResult = {
  rows: LogChartRow[];
  x: string;
  y: string | string[];
  notes: string[];
};

export type LogAggregated =
  | { ok: true; value: LogAggregationResult }
  | { ok: false; error: string };

type BucketInterval = {
  ms: number;
  alignmentOffsetMs: number;
};

type LogQuery = {
  interval: BucketInterval;
  matcher: RegExp | null;
  parser: TailLineParser | null;
  pattern: RegExp | null;
  seriesField: string | null;
  metric: LogMetric;
};

type LogEvent = {
  timestampMs: number;
  fields: Record<string, unknown>;
  matched: boolean;
};

type BucketSlot = { count: number; samples: number[] };

// bucket start (epoch ms) → series key → what fell in it.
type BucketIndex = Map<number, Map<string, BucketSlot>>;

// ---- The pipeline -----------------------------------------------------------

export function aggregateLog(text: string, options: LogReferenceOptions): LogAggregated {
  const query = parseLogQuery(options);
  if (!query.ok) return query;

  const events = readEvents(text, query.value);
  if (events.length === 0) {
    return { ok: false, error: noTimestampedLinesError() };
  }

  const bucketStarts = bucketStartsAcross(events, query.value.interval);
  if (!bucketStarts.ok) return bucketStarts;

  const members = events.filter((event) => event.matched);
  const seriesKeys = resolveSeriesKeys(members, query.value);
  const buckets = indexBuckets(members, query.value);
  const label = bucketLabeller(bucketStarts.value, query.value.interval);

  const rows = bucketStarts.value.map((bucketStart) =>
    buildRow(label(bucketStart), buckets.get(bucketStart), seriesKeys.keys, query.value),
  );

  return {
    ok: true,
    value: {
      rows,
      x: LOG_BUCKET_KEY,
      y: yPropFor(seriesKeys.keys, query.value),
      notes: [...skippedLineNotes(text, events), ...seriesKeys.notes],
    },
  };
}

// `y` is one key when there is one series and the list of keys when `series`
// split it — exactly Chart's own union, so the prop needs no massaging.
function yPropFor(seriesKeys: readonly string[], query: LogQuery): string | string[] {
  if (query.seriesField === null) return metricKeyOf(query.metric);
  return [...seriesKeys];
}

// ---- Parsing the query ------------------------------------------------------

function parseLogQuery(options: LogReferenceOptions): { ok: true; value: LogQuery } | { ok: false; error: string } {
  const interval = parseBucketInterval(options.groupBy);
  if (!interval.ok) return interval;

  const matcher = compileOptionalPattern(options.match, "match");
  if (!matcher.ok) return matcher;

  const pattern = compileOptionalPattern(options.pattern, "pattern");
  if (!pattern.ok) return pattern;

  const parser = parseLineParser(options.parser, pattern.value);
  if (!parser.ok) return parser;

  const metric = parseMetric(options.metric);
  if (!metric.ok) return metric;

  const seriesField = trimmedOrNull(options.series);
  const fieldsAvailable = parser.value !== null;
  if (seriesField !== null && !fieldsAvailable) {
    return { ok: false, error: seriesWithoutFieldsError(seriesField) };
  }
  if (metric.value.kind === LogMetricKind.Numeric && !fieldsAvailable) {
    return { ok: false, error: metricWithoutFieldsError(metric.value.field) };
  }

  return {
    ok: true,
    value: {
      interval: interval.value,
      matcher: matcher.value,
      parser: parser.value,
      pattern: pattern.value,
      seriesField,
      metric: metric.value,
    },
  };
}

// "10m", "30s", "1h", "1d", "1w" — and the words `hour`/`day`/`week` the first
// grammar shipped with.
export function parseBucketInterval(
  raw: string | null,
): { ok: true; value: BucketInterval } | { ok: false; error: string } {
  const trimmed = (raw ?? "").trim().toLowerCase();
  if (trimmed.length === 0) {
    return { ok: false, error: missingGroupByError() };
  }
  const duration = NAMED_DURATIONS[trimmed] ?? trimmed;
  const match = duration.match(DURATION_PATTERN);
  const count = Number(match?.[1] ?? "");
  const unit = match?.[2];
  if (!isDurationUnit(unit) || !Number.isInteger(count) || count <= 0) {
    return { ok: false, error: badGroupByError(trimmed) };
  }
  const ms = count * MS_PER_DURATION_UNIT[unit];
  const alignmentOffsetMs = unit === "w" ? EPOCH_TO_MONDAY_OFFSET_MS : 0;
  return { ok: true, value: { ms, alignmentOffsetMs } };
}

function isDurationUnit(unit: string | undefined): unit is DurationUnit {
  return unit !== undefined && Object.prototype.hasOwnProperty.call(MS_PER_DURATION_UNIT, unit);
}

// "count" | "rate" | "<agg>:<field>".
function parseMetric(raw: string | null): { ok: true; value: LogMetric } | { ok: false; error: string } {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0 || trimmed === LOG_COUNT_KEY) {
    return { ok: true, value: { kind: LogMetricKind.Count } };
  }
  if (trimmed === LOG_RATE_KEY) {
    return { ok: true, value: { kind: LogMetricKind.Rate } };
  }
  const [rawAggregation = "", rawField = ""] = trimmed.split(METRIC_FIELD_SEPARATOR);
  const aggregation = rawAggregation.trim().toLowerCase();
  const field = rawField.trim();
  if (!isLogAggregation(aggregation) || field.length === 0) {
    return { ok: false, error: badMetricError(trimmed) };
  }
  return { ok: true, value: { kind: LogMetricKind.Numeric, aggregation, field } };
}

function isLogAggregation(candidate: string): candidate is LogAggregation {
  return LOG_AGGREGATIONS.some((aggregation) => aggregation === candidate);
}

// The file-tail contract, verbatim: `regex` needs a `pattern`, and a `pattern`
// alone means `regex`. No parser and no pattern means the lines are only
// counted — a $log that asks "how many ERROR lines" needs no fields at all.
function parseLineParser(
  raw: string | null,
  pattern: RegExp | null,
): { ok: true; value: TailLineParser | null } | { ok: false; error: string } {
  const trimmed = (raw ?? "").trim().toLowerCase();
  if (trimmed.length === 0) {
    return { ok: true, value: pattern === null ? null : TailLineParser.Regex };
  }
  if (!isTailLineParser(trimmed)) {
    return { ok: false, error: badParserError(trimmed) };
  }
  if (trimmed === TailLineParser.Regex && pattern === null) {
    return { ok: false, error: regexParserWithoutPatternError() };
  }
  return { ok: true, value: trimmed };
}

function isTailLineParser(candidate: string): candidate is TailLineParser {
  return Object.values(TailLineParser).some((parser) => parser === candidate);
}

function compileOptionalPattern(
  raw: string | null,
  attribute: string,
): { ok: true; value: RegExp | null } | { ok: false; error: string } {
  const source = trimmedOrNull(raw);
  if (source === null) return { ok: true, value: null };
  try {
    return { ok: true, value: new RegExp(source) };
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    return { ok: false, error: `${attribute}="${source}" is not a valid regex (${detail}).` };
  }
}

function trimmedOrNull(raw: string | null): string | null {
  const trimmed = (raw ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

// ---- Lines → events ---------------------------------------------------------

// Every line that carries a time becomes an event. `match` decides which events
// the METRIC counts, not which ones exist — the window (and therefore the empty
// buckets) is a property of the file, so a ten-minute stretch with traffic but
// no errors plots a real zero instead of vanishing from the chart.
function readEvents(text: string, query: LogQuery): LogEvent[] {
  const events: LogEvent[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    const fields = extractFields(line, query);
    const timestampMs = timestampOf(line, fields);
    if (timestampMs === null) continue;
    events.push({ timestampMs, fields, matched: isMatch(line, query.matcher) });
  }
  return events;
}

function isMatch(line: string, matcher: RegExp | null): boolean {
  if (matcher === null) return true;
  return matcher.test(line);
}

function extractFields(line: string, query: LogQuery): Record<string, unknown> {
  if (query.parser === null) return {};
  const parsed = parseTailLine(line, query.parser, query.pattern);
  if (!parsed.ok) return {};
  return asFields(parsed.value);
}

// A regex line parses to its named groups and a JSONL line to its object — both
// already field records. A `number` line parses to a bare number, which live's
// own append convention names `value`; a $log follows it, so
// `metric="avg:value"` reads a file of bare numbers.
function asFields(value: unknown): Record<string, unknown> {
  if (typeof value === "number") return { [APPEND_VALUE_KEY]: value };
  if (isFieldRecord(value)) return value;
  return {};
}

function isFieldRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestampOf(line: string, fields: Record<string, unknown>): number | null {
  const captured = capturedTimestamp(fields);
  if (captured !== null) return captured;
  const scanned = line.match(ISO_TIMESTAMP_PATTERN);
  if (scanned === null) return null;
  return epochMsOf(scanned[0]);
}

function capturedTimestamp(fields: Record<string, unknown>): number | null {
  for (const field of TIMESTAMP_FIELDS) {
    const value = fields[field];
    if (value === undefined) continue;
    const epochMs = epochMsOf(value);
    if (epochMs !== null) return epochMs;
  }
  return null;
}

// A captured time is either epoch milliseconds (a number, the shape live's own
// streaming points carry) or a date string any Date can parse.
function epochMsOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

// ---- Events → buckets -------------------------------------------------------

function bucketStartOf(timestampMs: number, interval: BucketInterval): number {
  const shifted = timestampMs + interval.alignmentOffsetMs;
  const floored = Math.floor(shifted / interval.ms) * interval.ms;
  return floored - interval.alignmentOffsetMs;
}

// Every bucket between the file's first and last timestamped line, including the
// ones nothing matched in. A chart with a hole where the quiet ten minutes were
// is a wrong chart.
function bucketStartsAcross(
  events: readonly LogEvent[],
  interval: BucketInterval,
): { ok: true; value: number[] } | { ok: false; error: string } {
  const timestamps = events.map((event) => event.timestampMs);
  const firstBucket = bucketStartOf(Math.min(...timestamps), interval);
  const lastBucket = bucketStartOf(Math.max(...timestamps), interval);
  const bucketCount = (lastBucket - firstBucket) / interval.ms + 1;
  if (bucketCount > MAX_LOG_BUCKETS) {
    return { ok: false, error: tooManyBucketsError(bucketCount, interval) };
  }
  const starts: number[] = [];
  for (let start = firstBucket; start <= lastBucket; start += interval.ms) {
    starts.push(start);
  }
  return { ok: true, value: starts };
}

function indexBuckets(members: readonly LogEvent[], query: LogQuery): BucketIndex {
  const buckets: BucketIndex = new Map();
  for (const event of members) {
    const seriesKey = seriesKeyOf(event, query);
    if (seriesKey === null) continue;
    const bucketStart = bucketStartOf(event.timestampMs, query.interval);
    const slot = slotAt(buckets, bucketStart, seriesKey);
    slot.count += 1;
    const sample = numericSampleOf(event, query.metric);
    if (sample !== null) slot.samples.push(sample);
  }
  return buckets;
}

function slotAt(buckets: BucketIndex, bucketStart: number, seriesKey: string): BucketSlot {
  const series = buckets.get(bucketStart) ?? new Map<string, BucketSlot>();
  buckets.set(bucketStart, series);
  const slot = series.get(seriesKey) ?? { count: 0, samples: [] };
  series.set(seriesKey, slot);
  return slot;
}

// With no `series`, every matching line lands in the one series the metric names.
// With one, a line that never captured that field belongs to no series and is
// dropped — an INFO line has no place on an ERROR-vs-WARN chart.
function seriesKeyOf(event: LogEvent, query: LogQuery): string | null {
  if (query.seriesField === null) return metricKeyOf(query.metric);
  const value = event.fields[query.seriesField];
  if (value === undefined || value === null) return null;
  const key = String(value).trim();
  if (key.length === 0) return null;
  if (key === LOG_BUCKET_KEY) return null;
  return key;
}

function numericSampleOf(event: LogEvent, metric: LogMetric): number | null {
  if (metric.kind !== LogMetricKind.Numeric) return null;
  const value = event.fields[metric.field];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// ---- Buckets → rows ---------------------------------------------------------

type SeriesKeys = { keys: string[]; notes: string[] };

// The chart's series are whatever the FILE contained — the model never guessed
// them. Biggest first, so a legend reads in the order a human would rank it, and
// capped, because twelve lines is already a lot of lines.
function resolveSeriesKeys(members: readonly LogEvent[], query: LogQuery): SeriesKeys {
  if (query.seriesField === null) return { keys: [metricKeyOf(query.metric)], notes: [] };

  const totals = new Map<string, number>();
  for (const event of members) {
    const key = seriesKeyOf(event, query);
    if (key === null) continue;
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  const ranked = [...totals.entries()]
    .sort(([leftKey, leftTotal], [rightKey, rightTotal]) =>
      rightTotal - leftTotal || leftKey.localeCompare(rightKey),
    )
    .map(([key]) => key);

  if (ranked.length <= MAX_LOG_SERIES) return { keys: ranked, notes: [] };
  return {
    keys: ranked.slice(0, MAX_LOG_SERIES),
    notes: [
      `series="${query.seriesField}" has ${ranked.length} distinct values; plotted the ${MAX_LOG_SERIES} largest`,
    ],
  };
}

function buildRow(
  label: string,
  series: Map<string, BucketSlot> | undefined,
  seriesKeys: readonly string[],
  query: LogQuery,
): LogChartRow {
  const row: LogChartRow = { [LOG_BUCKET_KEY]: label };
  for (const key of seriesKeys) {
    row[key] = metricValueOf(series?.get(key), query);
  }
  return row;
}

// An empty bucket counts zero lines — that is a fact. It has no p95 — that is
// not zero, it is nothing, so the series breaks rather than dipping to a value
// the file never contained.
function metricValueOf(slot: BucketSlot | undefined, query: LogQuery): number | null {
  const count = slot?.count ?? 0;
  if (query.metric.kind === LogMetricKind.Count) return count;
  if (query.metric.kind === LogMetricKind.Rate) {
    return round(count / (query.interval.ms / MS_PER_MINUTE));
  }
  const samples = slot?.samples ?? [];
  if (samples.length === 0) return null;
  return round(aggregate(samples, query.metric.aggregation));
}

function aggregate(samples: readonly number[], aggregation: LogAggregation): number {
  const percentile = PERCENTILE_OF[aggregation];
  if (percentile !== undefined) return percentileOf(samples, percentile);
  if (aggregation === LogAggregation.Sum) return sumOf(samples);
  if (aggregation === LogAggregation.Avg) return sumOf(samples) / samples.length;
  if (aggregation === LogAggregation.Min) return Math.min(...samples);
  return Math.max(...samples);
}

function sumOf(samples: readonly number[]): number {
  return samples.reduce((total, sample) => total + sample, 0);
}

// Nearest-rank: the smallest sample at or above the requested percentile of the
// sorted samples. No interpolation — a p95 of a real distribution is a value the
// file actually contained.
function percentileOf(samples: readonly number[], percentile: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.ceil((percentile / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index] ?? 0;
}

function round(value: number): number {
  const scale = 10 ** VALUE_DECIMALS;
  return Math.round(value * scale) / scale;
}

function metricKeyOf(metric: LogMetric): string {
  if (metric.kind === LogMetricKind.Count) return LOG_COUNT_KEY;
  if (metric.kind === LogMetricKind.Rate) return LOG_RATE_KEY;
  return `${metric.aggregation}_${metric.field}`;
}

// ---- Bucket labels ----------------------------------------------------------

// The x axis a human reads: "09:30" for an hour of log, "2026-05-11" for a
// month of it, and "05-11 09:30" only when a sub-day bucket would otherwise
// print the same label on two different days.
function bucketLabeller(
  bucketStarts: readonly number[],
  interval: BucketInterval,
): (bucketStart: number) => string {
  if (interval.ms >= MS_PER_DAY) return (bucketStart) => isoDateOf(bucketStart);

  const showsSeconds = interval.ms < MS_PER_MINUTE;
  const spansDays = new Set(bucketStarts.map(isoDateOf)).size > 1;
  return (bucketStart) => {
    const time = showsSeconds ? isoSecondsOf(bucketStart) : isoMinutesOf(bucketStart);
    if (!spansDays) return time;
    return `${isoMonthDayOf(bucketStart)} ${time}`;
  };
}

// Buckets are UTC: a chart of a log must not move because the daemon's TZ did.
function isoDateOf(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function isoMonthDayOf(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(5, 10);
}

function isoMinutesOf(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(11, 16);
}

function isoSecondsOf(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(11, 19);
}

// ---- Notes and errors -------------------------------------------------------

// Lines the daemon could not place in time are invisible in the chart, so it
// says so rather than quietly plotting a subset of the file.
function skippedLineNotes(text: string, events: readonly LogEvent[]): string[] {
  const lineCount = text.split("\n").filter((line) => line.trim().length > 0).length;
  const skipped = lineCount - events.length;
  if (skipped <= 0) return [];
  return [`${skipped} of ${lineCount} lines carried no timestamp and were skipped`];
}

function missingGroupByError(): string {
  return `a $log needs groupBy="<interval>" — the time bucket to aggregate into, e.g. "10m", "30s", "1h", "1d".`;
}

function badGroupByError(raw: string): string {
  return (
    `groupBy="${raw}" is not an interval. Write a duration: <count><unit> where unit is ` +
    `s, m, h, d, or w — "30s", "10m", "1h", "1d", "2w" (hour/day/week also work).`
  );
}

function badMetricError(raw: string): string {
  return (
    `metric="${raw}" is not a metric. Use "count" (default), "rate" (matching lines per minute), ` +
    `or "<${LOG_AGGREGATIONS.join("|")}>:<field>" over a field the parser captured, e.g. "p95:duration_ms".`
  );
}

function badParserError(raw: string): string {
  return `parser="${raw}" is unknown — one of ${Object.values(TailLineParser).join(", ")}.`;
}

function regexParserWithoutPatternError(): string {
  return `parser="regex" needs pattern="…" with named groups, e.g. pattern="level=(?<level>\\w+)".`;
}

function seriesWithoutFieldsError(seriesField: string): string {
  return (
    `series="${seriesField}" needs fields to group by, but no parser captured any. ` +
    `Add pattern="…(?<${seriesField}>…)…", or parser="jsonl" if each line is JSON.`
  );
}

function metricWithoutFieldsError(field: string): string {
  return (
    `metric names the field "${field}", but no parser captured any fields. ` +
    `Add pattern="…(?<${field}>[0-9.]+)…", or parser="jsonl" if each line is JSON.`
  );
}

function noTimestampedLinesError(): string {
  return (
    `no line in this file carries a timestamp, so it cannot be bucketed by time. A line is timed by an ` +
    `ISO-8601 timestamp anywhere in it, or by a t/ts/time/timestamp field the parser captured — add ` +
    `pattern="…(?<t>…)…", or parser="jsonl" if each line is JSON.`
  );
}

function tooManyBucketsError(bucketCount: number, interval: BucketInterval): string {
  const minutes = Math.round(interval.ms / MS_PER_MINUTE);
  return (
    `this file spans ${Math.ceil(bucketCount)} buckets of ${minutes} minute(s), over the ${MAX_LOG_BUCKETS} ` +
    `point cap — widen groupBy (a chart with that many points is unreadable anyway).`
  );
}
