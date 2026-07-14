// The aggregator's contract, stated in tests: what the grammar accepts, what it
// computes, and — the part a chart lives or dies on — that a bucket with traffic
// but no matches plots a real zero instead of disappearing.

import { describe, it, expect } from "bun:test";
import {
  aggregateLog,
  parseBucketInterval,
  BUCKET_INTERVAL_EXAMPLES,
  type LogReferenceOptions,
} from "./logs.ts";

const NO_OPTIONS: LogReferenceOptions = {
  groupBy: null,
  match: null,
  parser: null,
  pattern: null,
  series: null,
  metric: null,
};

function query(overrides: Partial<LogReferenceOptions>): LogReferenceOptions {
  return { ...NO_OPTIONS, ...overrides };
}

function aggregate(text: string, overrides: Partial<LogReferenceOptions>) {
  const result = aggregateLog(text, query(overrides));
  if (!result.ok) throw new Error(`aggregation failed: ${result.error}`);
  return result.value;
}

function errorOf(text: string, overrides: Partial<LogReferenceOptions>): string {
  const result = aggregateLog(text, query(overrides));
  if (result.ok) throw new Error("expected the aggregation to be rejected");
  return result.error;
}

// One hour of log, two levels, one numeric field. Small enough to reason about
// by eye: the 09:10 bucket has an INFO line and no ERROR, so it must plot 0.
const LOG = [
  "2026-05-11T09:00:04.182Z INFO  [http] request_completed duration_ms=3",
  "2026-05-11T09:00:31.000Z ERROR [http] upstream_timeout duration_ms=15001",
  "2026-05-11T09:05:00.000Z WARN  [http] slow_response duration_ms=900",
  "2026-05-11T09:10:00.000Z INFO  [http] request_completed duration_ms=7",
  "2026-05-11T09:20:00.000Z ERROR [store] write_failed duration_ms=120",
  "2026-05-11T09:20:30.000Z ERROR [store] write_failed duration_ms=240",
  "",
].join("\n");

describe("parseBucketInterval", () => {
  it("accepts a duration in any unit — the ten-minute bucket the old enum could not express", () => {
    expect(parseBucketInterval("10m")).toEqual({ ok: true, value: { ms: 600_000, alignmentOffsetMs: 0 } });
    expect(parseBucketInterval("30s")).toEqual({ ok: true, value: { ms: 30_000, alignmentOffsetMs: 0 } });
    expect(parseBucketInterval("1h")).toEqual({ ok: true, value: { ms: 3_600_000, alignmentOffsetMs: 0 } });
    expect(parseBucketInterval("1d")).toEqual({ ok: true, value: { ms: 86_400_000, alignmentOffsetMs: 0 } });
  });

  // The grammar it replaced still runs: every spec written against hour|day|week
  // means exactly what it meant before.
  it("keeps the hour/day/week words as aliases of 1h/1d/1w", () => {
    expect(parseBucketInterval("hour")).toEqual(parseBucketInterval("1h"));
    expect(parseBucketInterval("day")).toEqual(parseBucketInterval("1d"));
    expect(parseBucketInterval("week")).toEqual(parseBucketInterval("1w"));
  });

  it("rejects a non-interval by naming the grammar", () => {
    const result = parseBucketInterval("10 minutes");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("<count><unit>");
  });

  it("rejects a zero-length or unit-less bucket", () => {
    expect(parseBucketInterval("0m").ok).toBe(false);
    expect(parseBucketInterval("10").ok).toBe(false);
    expect(parseBucketInterval(null).ok).toBe(false);
  });

  // The sentence a model is shown cannot outlive the code that parses it. Every
  // bucket the exported grammar advertises is a bucket the parser really takes —
  // the previous grammar promised hour|day|week and could not answer a question
  // asked in ten minutes, and a model handed it rationally bypassed the whole
  // reference.
  it.each([...BUCKET_INTERVAL_EXAMPLES])("advertises %s, and parses it", (duration) => {
    expect(parseBucketInterval(duration).ok).toBe(true);
  });
});

describe("aggregateLog — counting matched lines", () => {
  it("counts matching lines per bucket and supplies the chart's x and y", () => {
    const result = aggregate(LOG, { groupBy: "10m", match: "ERROR" });
    expect(result.x).toBe("bucket");
    expect(result.y).toBe("count");
    expect(result.rows).toEqual([
      { bucket: "09:00", count: 1 },
      { bucket: "09:10", count: 0 },
      { bucket: "09:20", count: 2 },
    ]);
  });

  // The whole reason the window comes from every timestamped line rather than
  // from the matching ones: a quiet ten minutes is a data point, not a gap.
  it("plots zero for a bucket that has lines but no matches", () => {
    const rows = aggregate(LOG, { groupBy: "10m", match: "ERROR" }).rows;
    expect(rows[1]).toEqual({ bucket: "09:10", count: 0 });
  });

  it("counts every timestamped line when no match is given", () => {
    const rows = aggregate(LOG, { groupBy: "1h" }).rows;
    expect(rows).toEqual([{ bucket: "09:00", count: 6 }]);
  });

  it("reads match as a regex", () => {
    const rows = aggregate(LOG, { groupBy: "1h", match: "ERROR|WARN" }).rows;
    expect(rows).toEqual([{ bucket: "09:00", count: 4 }]);
  });
});

describe("aggregateLog — one series per captured field", () => {
  it("splits the chart by a named capture and names the series after the file's own values", () => {
    const result = aggregate(LOG, {
      groupBy: "10m",
      pattern: "\\s(?<level>ERROR|WARN)\\s",
      series: "level",
    });
    expect(result.y).toEqual(["ERROR", "WARN"]);
    expect(result.rows).toEqual([
      { bucket: "09:00", ERROR: 1, WARN: 1 },
      { bucket: "09:10", ERROR: 0, WARN: 0 },
      { bucket: "09:20", ERROR: 2, WARN: 0 },
    ]);
  });

  // A line the series field never matched belongs to no series — an INFO line
  // has no place on an ERROR-vs-WARN chart, and must not become a third one.
  it("drops lines that captured no series field", () => {
    const result = aggregate(LOG, {
      groupBy: "1h",
      pattern: "\\s(?<level>ERROR|WARN)\\s",
      series: "level",
    });
    expect(result.y).toEqual(["ERROR", "WARN"]);
    expect(result.rows).toEqual([{ bucket: "09:00", ERROR: 3, WARN: 1 }]);
  });

  it("refuses a series with no parser to capture it", () => {
    expect(errorOf(LOG, { groupBy: "10m", series: "level" })).toContain("needs fields to group by");
  });
});

describe("aggregateLog — numeric metrics over a captured value", () => {
  const PATTERN = "duration_ms=(?<duration_ms>\\d+)";

  it("aggregates a captured number per bucket", () => {
    const result = aggregate(LOG, { groupBy: "10m", pattern: PATTERN, metric: "max:duration_ms" });
    expect(result.y).toBe("max_duration_ms");
    expect(result.rows).toEqual([
      { bucket: "09:00", max_duration_ms: 15001 },
      { bucket: "09:10", max_duration_ms: 7 },
      { bucket: "09:20", max_duration_ms: 240 },
    ]);
  });

  it("computes avg and percentiles from the values the file contained", () => {
    expect(aggregate(LOG, { groupBy: "1h", pattern: PATTERN, metric: "avg:duration_ms" }).rows).toEqual([
      { bucket: "09:00", avg_duration_ms: 2711.833 },
    ]);
    expect(aggregate(LOG, { groupBy: "1h", pattern: PATTERN, metric: "p95:duration_ms" }).rows).toEqual([
      { bucket: "09:00", p95_duration_ms: 15001 },
    ]);
    expect(aggregate(LOG, { groupBy: "1h", pattern: PATTERN, metric: "p50:duration_ms" }).rows).toEqual([
      { bucket: "09:00", p50_duration_ms: 120 },
    ]);
  });

  // An empty bucket counted zero lines — a fact. It has no p95 — that is not
  // zero, it is nothing, so the series breaks rather than lying with a value.
  it("leaves a bucket with no samples null rather than plotting a zero it never measured", () => {
    const rows = aggregate(LOG, {
      groupBy: "10m",
      match: "ERROR",
      pattern: PATTERN,
      metric: "avg:duration_ms",
    }).rows;
    expect(rows[1]).toEqual({ bucket: "09:10", avg_duration_ms: null });
  });

  it("rates the matching lines per minute", () => {
    expect(aggregate(LOG, { groupBy: "10m", match: "ERROR", metric: "rate" }).rows).toEqual([
      { bucket: "09:00", rate: 0.1 },
      { bucket: "09:10", rate: 0 },
      { bucket: "09:20", rate: 0.2 },
    ]);
  });

  it("names the metric grammar when it does not recognize one", () => {
    expect(errorOf(LOG, { groupBy: "10m", metric: "median(duration)" })).toContain(`metric="median(duration)"`);
  });
});

describe("aggregateLog — the file-tail parser grammar, reused", () => {
  const JSONL = [
    `{"t":"2026-05-11T09:00:00.000Z","level":"error","ms":12}`,
    `{"t":"2026-05-11T09:04:00.000Z","level":"info","ms":4}`,
    `{"t":"2026-05-11T09:12:00.000Z","level":"error","ms":30}`,
  ].join("\n");

  it("parses JSONL lines and times them by their own t field", () => {
    const result = aggregate(JSONL, { groupBy: "10m", parser: "jsonl", series: "level" });
    expect(result.y).toEqual(["error", "info"]);
    expect(result.rows).toEqual([
      { bucket: "09:00", error: 1, info: 1 },
      { bucket: "09:10", error: 1, info: 0 },
    ]);
  });

  it("aggregates a JSONL numeric field", () => {
    expect(aggregate(JSONL, { groupBy: "1h", parser: "jsonl", metric: "sum:ms" }).rows).toEqual([
      { bucket: "09:00", sum_ms: 46 },
    ]);
  });

  // file-tail's rule, verbatim: regex without a pattern is not a parser.
  it("refuses parser=regex with no pattern, in the same words file-tail does", () => {
    expect(errorOf(LOG, { groupBy: "10m", parser: "regex" })).toContain("named groups");
  });

  it("names the three parsers when handed a fourth", () => {
    expect(errorOf(LOG, { groupBy: "10m", parser: "logfmt" })).toContain("jsonl, regex, number");
  });
});

describe("aggregateLog — timestamps", () => {
  it("times a line by a captured t when the line has no ISO timestamp", () => {
    const epochLog = ["1778835600000 ERROR boom", "1778836200000 ERROR boom"].join("\n");
    const rows = aggregate(epochLog, {
      groupBy: "10m",
      match: "ERROR",
      pattern: "^(?<t>\\d{13})",
    }).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ count: 1 });
  });

  it("skips untimed lines and says how many", () => {
    const withNoise = `a stack trace line with no time\n${LOG}`;
    const result = aggregate(withNoise, { groupBy: "1h", match: "ERROR" });
    expect(result.rows).toEqual([{ bucket: "09:00", count: 3 }]);
    expect(result.notes).toEqual(["1 of 7 lines carried no timestamp and were skipped"]);
  });

  it("rejects a file it cannot place in time at all, naming the escape hatch", () => {
    expect(errorOf("no timestamps here\nnor here", { groupBy: "10m" })).toContain("(?<t>");
  });
});

describe("aggregateLog — bucket labels", () => {
  it("labels sub-minute buckets to the second", () => {
    const rows = aggregate(LOG, { groupBy: "30s", match: "upstream_timeout" }).rows;
    expect(rows[0]).toEqual({ bucket: "09:00:00", count: 0 });
    expect(rows[1]).toEqual({ bucket: "09:00:30", count: 1 });
  });

  it("labels day buckets by date", () => {
    const rows = aggregate(LOG, { groupBy: "1d" }).rows;
    expect(rows).toEqual([{ bucket: "2026-05-11", count: 6 }]);
  });

  // Two days of ten-minute buckets would print "09:00" twice; the date
  // disambiguates it, and only then.
  it("prefixes the date only when sub-day buckets would collide across days", () => {
    const twoDays = [
      "2026-05-11T09:00:00.000Z ERROR boom",
      "2026-05-12T09:00:00.000Z ERROR boom",
    ].join("\n");
    const rows = aggregate(twoDays, { groupBy: "1h", match: "ERROR" }).rows;
    expect(rows[0]).toEqual({ bucket: "05-11 09:00", count: 1 });
    expect(rows.at(-1)).toEqual({ bucket: "05-12 09:00", count: 1 });
  });

  it("refuses a window that would plot more points than a chart can carry", () => {
    const wide = ["2020-01-01T00:00:00.000Z start", "2026-01-01T00:00:00.000Z end"].join("\n");
    expect(errorOf(wide, { groupBy: "30s" })).toContain("widen groupBy");
  });
});
