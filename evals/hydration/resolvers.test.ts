// The hydrator is checked against the REAL fixtures and the hand-counted ground
// truth in evals/fixtures/index.ts (FIXTURE_FACTS). Every number below was
// derived from the fixture files by a shell command recorded next to it there,
// so a test failing here means the hydrator and the bytes on disk disagree —
// and the fixture, not the test, says who is wrong.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FIXTURE_FACTS } from "../fixtures/index.ts";
import type { UIElement } from "../../src/shared/types.ts";
import {
  FixturePathEscapeError,
  countErrorsByTimeBucket,
  hydrateSpec,
  parseCsv,
  resolveElement,
  resolveFixturePath,
} from "./resolvers.ts";

const GIT_DIFF_FIXTURE_PATH = "repo/src/server.ts";
const CSV_FIXTURE_PATH = "data/results.csv";
const LOG_FIXTURE_PATH = "logs/app.log";

function referenceElement(type: string, props: Record<string, unknown>): UIElement {
  return { type, props, children: [] };
}

function propsOf(element: UIElement): Record<string, unknown> {
  return element.props;
}

describe("GitDiff → DiffViewer", () => {
  test("fills the real before/after props from the fixture repo", () => {
    const authored = referenceElement("GitDiff", {
      file: GIT_DIFF_FIXTURE_PATH,
      base: "HEAD~1",
    });

    const resolved = resolveElement(authored, "diff");
    const props = propsOf(resolved.element);

    expect(resolved.issues).toEqual([]);
    expect(resolved.element.type).toBe("DiffViewer");
    expect(props.file).toBe(GIT_DIFF_FIXTURE_PATH);
    expect(typeof props.before).toBe("string");
    expect(typeof props.after).toBe("string");
  });

  test("the after side carries the added line and the before side carries the removed one", () => {
    const authored = referenceElement("GitDiff", { file: GIT_DIFF_FIXTURE_PATH });

    const props = propsOf(resolveElement(authored, "diff").element);
    const before = String(props.before);
    const after = String(props.after);

    expect(after).toContain(FIXTURE_FACTS.gitDiff.addedCodeLine);
    expect(after).not.toContain(FIXTURE_FACTS.gitDiff.removedCodeLine);
    expect(before).toContain(FIXTURE_FACTS.gitDiff.removedCodeLine);
    expect(before).not.toContain(FIXTURE_FACTS.gitDiff.addedCodeLine);
  });

  test("accepts the range spelling diff=\"HEAD~1..HEAD\" as well as base=", () => {
    const rangeAuthored = referenceElement("GitDiff", {
      file: GIT_DIFF_FIXTURE_PATH,
      diff: "HEAD~1..HEAD",
    });
    const baseAuthored = referenceElement("GitDiff", {
      file: GIT_DIFF_FIXTURE_PATH,
      base: "HEAD~1",
      head: "HEAD",
    });

    const fromRange = propsOf(resolveElement(rangeAuthored, "diff").element);
    const fromBase = propsOf(resolveElement(baseAuthored, "diff").element);

    expect(fromRange.before).toBe(fromBase.before);
    expect(fromRange.after).toBe(fromBase.after);
  });

  test("the authoring-only reference props never reach the catalog component", () => {
    const authored = referenceElement("GitDiff", { file: GIT_DIFF_FIXTURE_PATH, base: "HEAD~1" });

    const props = propsOf(resolveElement(authored, "diff").element);

    expect(props.base).toBeUndefined();
    expect(props.diff).toBeUndefined();
    expect(props.src).toBeUndefined();
  });
});

describe("DataTable src → columns + rows", () => {
  test("reads every row of the CSV and infers its columns", () => {
    const authored = referenceElement("DataTable", { src: CSV_FIXTURE_PATH });

    const resolved = resolveElement(authored, "table");
    const props = propsOf(resolved.element);
    const columns = props.columns as { key: string; type: string }[];
    const rows = props.rows as Record<string, unknown>[];

    expect(resolved.issues).toEqual([]);
    expect(columns.map((column) => column.key)).toEqual([...FIXTURE_FACTS.csv.headerColumns]);
    expect(rows).toHaveLength(FIXTURE_FACTS.csv.dataRowCount);
  });

  test("a sample row's values survive the round trip, numbers as numbers", () => {
    const table = parseCsv(readCsv());
    const [sample] = FIXTURE_FACTS.csv.sampleRows;
    if (sample === undefined) throw new Error("the CSV fixture declares no sample rows");

    const row = table.rows.find((candidate) => candidate.run_id === sample.runId);

    expect(row).toBeDefined();
    expect(row?.scenario).toBe(sample.scenario);
    expect(row?.tokens_out).toBe(sample.tokensOut);
  });

  test("the numeric columns are typed for the sort comparator", () => {
    const table = parseCsv(readCsv());
    const tokensOut = table.columns.find((column) => column.key === "tokens_out");

    expect(tokensOut?.type).toBe("number");
  });
});

describe("LogStream → Chart", () => {
  test("aggregates the log into the fixture's hand-counted ten-minute error buckets", () => {
    const authored = referenceElement("LogStream", { file: LOG_FIXTURE_PATH, watch: true });

    const resolved = resolveElement(authored, "chart");
    const props = propsOf(resolved.element);

    expect(resolved.issues).toEqual([]);
    expect(resolved.element.type).toBe("Chart");
    expect(props.data).toEqual([...FIXTURE_FACTS.log.errorsByTenMinuteBucket]);
    expect(props.x).toBe("bucketStart");
    expect(props.y).toBe("errorCount");
  });

  test("the aggregate's total matches the fixture's error count, and the peak is the spike", () => {
    const buckets = countErrorsByTimeBucket(readLog());

    const total = buckets.reduce((sum, bucket) => sum + bucket.errorCount, 0);
    const peak = buckets.reduce((highest, bucket) =>
      bucket.errorCount > highest.errorCount ? bucket : highest,
    );

    expect(total).toBe(FIXTURE_FACTS.log.errorCount);
    expect(peak.bucketStart).toBe(FIXTURE_FACTS.log.peakErrorBucketStart);
  });

  test("quiet buckets are emitted as zeroes, not dropped", () => {
    const buckets = countErrorsByTimeBucket(readLog());
    const quietBucket = buckets.find((bucket) => bucket.bucketStart === "09:00");

    expect(quietBucket).toEqual({ bucketStart: "09:00", errorCount: 0 });
  });
});

describe("CodeBlock file + lines → code", () => {
  test("slices the requested 1-based inclusive range into code", () => {
    const authored = referenceElement("CodeBlock", {
      file: GIT_DIFF_FIXTURE_PATH,
      lines: "1-3",
    });

    const resolved = resolveElement(authored, "code");
    const props = propsOf(resolved.element);
    const wholeFile = readFixture(GIT_DIFF_FIXTURE_PATH).split("\n");

    expect(resolved.issues).toEqual([]);
    expect(props.code).toBe(wholeFile.slice(0, 3).join("\n"));
    expect(props.startLine).toBe(1);
    expect(props.language).toBe("typescript");
    expect(props.title).toBe(GIT_DIFF_FIXTURE_PATH);
  });

  test("a malformed line range is an issue, not a crash", () => {
    const authored = referenceElement("CodeBlock", {
      file: GIT_DIFF_FIXTURE_PATH,
      lines: "not-a-range",
    });

    const resolved = resolveElement(authored, "code");

    expect(resolved.issues).toHaveLength(1);
    expect(resolved.issues[0]).toContain("line range");
  });
});

describe("the fixture root is the only readable directory", () => {
  test("a traversing path throws rather than reading", () => {
    expect(() => resolveFixturePath("../../package.json")).toThrow(FixturePathEscapeError);
  });

  test("an absolute path outside the fixtures throws rather than reading", () => {
    expect(() => resolveFixturePath("/etc/passwd")).toThrow(FixturePathEscapeError);
  });

  test("an escaping reference in a spec becomes an issue, and no file is read", () => {
    const spec = {
      root: "table",
      elements: { table: referenceElement("DataTable", { src: "../../package.json" }) },
    };

    const hydrated = hydrateSpec(spec);

    expect(hydrated.issues).toHaveLength(1);
    expect(hydrated.issues[0]).toContain("resolves outside");
    expect(hydrated.spec.elements.table?.props.rows).toBeUndefined();
  });
});

describe("elements without references", () => {
  test("a pasted low-fidelity table passes through untouched", () => {
    const pasted = referenceElement("DataTable", {
      columns: [{ key: "a", header: "A" }],
      rows: [{ a: 1 }],
    });

    const spec = { root: "table", elements: { table: pasted } };
    const hydrated = hydrateSpec(spec);

    expect(hydrated.issues).toEqual([]);
    expect(hydrated.spec.elements.table).toEqual(pasted);
  });

  // THE EXPERIMENT-DESTROYING CASE. `file` is a real DiffViewer prop, so a
  // low-fidelity arm that PASTED its before/after also names the file. If the
  // hydrator treated that as a reference it would re-fetch the bytes from git —
  // handing the low-fidelity arm the high-fidelity arm's result for free, and
  // making the two rungs of the ladder indistinguishable in the results.
  test("a low-fidelity DiffViewer that pasted before/after is NOT re-fetched", () => {
    const pasted = referenceElement("DiffViewer", {
      file: GIT_DIFF_FIXTURE_PATH,
      before: "the model pasted this",
      after: "and pasted this",
    });

    const resolved = resolveElement(pasted, "diff");

    expect(resolved.issues).toEqual([]);
    expect(resolved.element).toEqual(pasted);
    expect(propsOf(resolved.element).before).toBe("the model pasted this");
  });

  test("a DiffViewer naming a revision IS a reference, and gets hydrated", () => {
    const referenced = referenceElement("DiffViewer", {
      file: GIT_DIFF_FIXTURE_PATH,
      base: "HEAD~1",
    });

    const props = propsOf(resolveElement(referenced, "diff").element);

    expect(String(props.after)).toContain(FIXTURE_FACTS.gitDiff.addedCodeLine);
  });
});

// ---- fixture readers --------------------------------------------------------

function readFixture(relativePath: string): string {
  return readFileSync(resolveFixturePath(relativePath), "utf8");
}

function readCsv(): string {
  return readFileSync(FIXTURE_FACTS.csv.path, "utf8");
}

function readLog(): string {
  return readFileSync(FIXTURE_FACTS.log.path, "utf8");
}
