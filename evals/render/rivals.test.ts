// THE TESTS THAT STOP US WINNING BY ACCIDENT.
//
// Every arm in this matrix is decoded by a translator we wrote. A bug in one of
// those translators does not look like a bug — it looks like a rival losing. That
// is the most dangerous failure mode available to a benchmark run by one of the
// contestants, and it has already happened once here (see the terse-json case
// below), so each rival's decoder is pinned to the behaviour that keeps it honest.

import { describe, expect, test } from "bun:test";
import { prepareSpec } from "../../src/daemon/spec-validation.ts";
import { ReferenceExpressionKey } from "../../src/shared/expressions.ts";
import { compileA2uiDocument } from "./a2ui.ts";
import { compileOpenUiDocument } from "./openui.ts";
import { REAL_VOCABULARY_INVERSE, decodeAuthoredDocument, detectReferenceUsage } from "./materialize.ts";
import { ArmId } from "../types.ts";

// ---- terse-json: the expansion must not touch the DATA -------------------------

describe("terse-json expands the spec envelope and nothing else", () => {
  // THE BUG THIS PINS. The terse notation abbreviates the spec's six structural
  // keys (r/e/s/t/p/c). An expansion that walked the tree renaming every "t" it
  // met would reach inside `props` and into the data itself: a chart row
  // {t: "09:00", c: 11} would come back as {type: "09:00", children: 11} and the
  // chart would plot nothing.
  //
  // terse-json is the arm most likely to BEAT parchment on density. A harness bug
  // that silently corrupts its data is therefore a FAKE WIN FOR US — the exact
  // species of error that makes a benchmark worthless.
  test("data fields named after the terse keys survive byte-for-byte", () => {
    const authored = JSON.stringify({
      r: "a",
      e: {
        a: { t: "Card", p: { title: "Errors" }, c: ["b"] },
        b: {
          t: "Chart",
          p: {
            kind: "bar",
            x: "t",
            y: "c",
            data: [
              { t: "09:00", c: 0, p: 1, r: 2, e: 3, s: 4 },
              { t: "09:30", c: 11, p: 1, r: 2, e: 3, s: 4 },
            ],
          },
        },
      },
      s: { form: { t: "seeded", c: "kept" } },
    });

    const decoded = decodeAuthoredDocument("terse-json", authored, REAL_VOCABULARY_INVERSE);

    expect(decoded.issues).toEqual([]);
    expect(decoded.spec?.elements.b?.props).toEqual({
      kind: "bar",
      x: "t",
      y: "c",
      data: [
        { t: "09:00", c: 0, p: 1, r: 2, e: 3, s: 4 },
        { t: "09:30", c: 11, p: 1, r: 2, e: 3, s: 4 },
      ],
    });
    expect(decoded.spec?.state).toEqual({ form: { t: "seeded", c: "kept" } });
  });

  test("the envelope and each element's own keys ARE expanded", () => {
    const authored = JSON.stringify({
      r: "a",
      e: { a: { t: "Heading", p: { text: "hi", level: "h1" } } },
    });

    const decoded = decodeAuthoredDocument("terse-json", authored, REAL_VOCABULARY_INVERSE);

    expect(decoded.spec?.root).toBe("a");
    expect(decoded.spec?.elements.a?.type).toBe("Heading");
    expect(prepareSpec(decoded.spec!).issues).toEqual([]);
  });
});

// ---- openui-lang: Query() IS a reference, and it must reach the daemon ----------

describe("openui-lang's Query lowers onto the daemon's own reference grammar", () => {
  // If this breaks, OpenUI silently loses its content-avoidance mechanism and
  // parchment "wins" the ladder. It is the single most self-serving bug this
  // codebase could contain.
  test("a Query plucked into a DataTable becomes a $csv the daemon hydrates", () => {
    const decoded = compileOpenUiDocument(
      [
        `root = Card([tbl], "Benchmark Results")`,
        `csv = Query("read_csv", {path: "data/results.csv"}, {rows: [], columns: []})`,
        `tbl = DataTable("Benchmark Results", csv.columns, csv.rows)`,
      ].join("\n"),
    );

    expect(decoded.issues).toEqual([]);
    expect(decoded.spec?.elements.tbl?.props.rows).toEqual({ $csv: "data/results.csv" });
    // The daemon SUPPLIES `columns` from the file's header. Leaving the model's
    // pluck in place would leave a raw reference object where the column list
    // belongs, and hydration never overwrites a prop the author wrote.
    expect(decoded.spec?.elements.tbl?.props.columns).toBeUndefined();
    expect(prepareSpec(decoded.spec!).issues).toEqual([]);
  });

  test("a Query plucked into a DiffViewer becomes an element-level $diff", () => {
    const decoded = compileOpenUiDocument(
      [
        `root = Card([dv], "Review")`,
        `gd = Query("git_diff", {file: "repo/src/server.ts", base: "HEAD~1"}, {before: "", after: ""})`,
        `dv = DiffViewer(gd.file, gd.before, gd.after)`,
      ].join("\n"),
    );

    expect(decoded.spec?.elements.dv?.props).toEqual({
      [ReferenceExpressionKey.Diff]: "repo/src/server.ts",
      base: "HEAD~1",
    });
    expect(prepareSpec(decoded.spec!).issues).toEqual([]);
  });

  test("a Query plucked into a Chart becomes a $log the daemon aggregates", () => {
    const decoded = compileOpenUiDocument(
      [
        `root = Card([c], "Errors")`,
        `agg = Query("log_series", {file: "logs/app.log", groupBy: "10m", match: "ERROR"}, {data: []})`,
        `c = Chart("bar", agg.data, agg.x, agg.y, "ERROR rate")`,
      ].join("\n"),
    );

    expect(decoded.spec?.elements.c?.props.data).toEqual({
      $log: "logs/app.log",
      groupBy: "10m",
      match: "ERROR",
    });
    expect(prepareSpec(decoded.spec!).issues).toEqual([]);
  });

  // OpenUI's arguments are positional, so a model reaching the fifth must write
  // something in the third — and its vendor's own idiom for "skipped" is `null`
  // (their generated prompt: `Select("dateRange", [...], null, null, $dateRange)`).
  // Forwarding that null makes the product's validator reject
  // `required field "columns" cannot be null`, and the arm loses a run for
  // obeying its own documentation.
  test("a null positional argument means SKIPPED, not null", () => {
    const decoded = compileOpenUiDocument(
      [
        `root = Card([tbl], "Benchmark Results")`,
        `csv = Query("read_csv", {path: "data/results.csv"}, {rows: []})`,
        `tbl = DataTable("Benchmark Results", null, csv.rows)`,
      ].join("\n"),
    );

    expect(decoded.issues).toEqual([]);
    expect(prepareSpec(decoded.spec!).issues).toEqual([]);
  });

  test("an arm that pasted its data instead is reported as NOT having climbed", () => {
    const pasted = [
      `root = Card([c], "Errors")`,
      `c = Chart("bar", [{b: "09:00", n: 0}, {b: "09:30", n: 11}], "b", "n", "ERROR rate")`,
    ].join("\n");

    expect(detectReferenceUsage(ArmId.OpenUiLang, pasted).usedReference).toBe(false);
  });

  test("an arm that used its Query IS reported as having climbed", () => {
    const referenced = [
      `root = Card([tbl], "Results")`,
      `csv = Query("read_csv", {path: "data/results.csv"}, {rows: []})`,
      `tbl = DataTable("Results", null, csv.rows)`,
    ].join("\n");

    const usage = detectReferenceUsage(ArmId.OpenUiLang, referenced);
    expect(usage.usedReference).toBe(true);
    expect(usage.referenceKindsUsed).toEqual([ReferenceExpressionKey.Csv]);
  });
});

// ---- a2ui: the envelope, the adjacency list, and the data model ------------------

describe("a2ui decodes its own v1.0 envelope", () => {
  const stream = [
    { version: "v1.0", createSurface: { surfaceId: "canvas", catalogId: "parchment" } },
    {
      version: "v1.0",
      updateComponents: {
        surfaceId: "canvas",
        components: [
          { id: "root", component: "Card", title: "Errors", children: ["c"] },
          { id: "c", component: "Chart", kind: "bar", data: { path: "/points" }, x: "bucket", y: "count" },
        ],
      },
    },
    {
      version: "v1.0",
      updateDataModel: {
        surfaceId: "canvas",
        path: "/points",
        value: [
          { bucket: "09:00", count: 0 },
          { bucket: "09:30", count: 11 },
        ],
      },
    },
  ];

  test("the flat component list becomes a flat element map, tree intact", () => {
    const decoded = compileA2uiDocument(JSON.stringify(stream));

    expect(decoded.issues).toEqual([]);
    expect(decoded.spec?.root).toBe("root");
    expect(decoded.spec?.elements.root?.children).toEqual(["c"]);
    expect(decoded.spec?.elements.c?.type).toBe("Chart");
  });

  // A2UI's DataBinding and json-render's $state are the SAME JSON Pointer into the
  // SAME document. Mapping one onto the other is a translation, not a favour.
  test("a data-model binding becomes a $state pointer, and the data becomes state", () => {
    const decoded = compileA2uiDocument(JSON.stringify(stream));

    expect(decoded.spec?.elements.c?.props.data).toEqual({ $state: "/points" });
    expect(decoded.spec?.state).toEqual({
      points: [
        { bucket: "09:00", count: 0 },
        { bucket: "09:30", count: 11 },
      ],
    });
  });

  // Their spec publishes the stream as JSONL and their prompt asks for a JSON
  // array. Both are real A2UI; refusing one would fail the arm on a technicality.
  test("JSONL is accepted as readily as a JSON array", () => {
    const jsonl = stream.map((message) => JSON.stringify(message)).join("\n");
    const decoded = compileA2uiDocument(jsonl);

    expect(decoded.issues).toEqual([]);
    expect(decoded.spec?.elements.c?.type).toBe("Chart");
  });

  test("`child` (a single id) is honoured as well as `children`", () => {
    const decoded = compileA2uiDocument(
      JSON.stringify([
        {
          version: "v1.0",
          updateComponents: {
            surfaceId: "canvas",
            components: [
              { id: "root", component: "Card", title: "One", child: "h" },
              { id: "h", component: "Heading", text: "hi", level: "h1" },
            ],
          },
        },
      ]),
    );

    expect(decoded.spec?.elements.root?.children).toEqual(["h"]);
    expect(prepareSpec(decoded.spec!).issues).toEqual([]);
  });

  test("a stream with no root is refused in A2UI's own terms", () => {
    const decoded = compileA2uiDocument(
      JSON.stringify([
        {
          version: "v1.0",
          updateComponents: {
            surfaceId: "canvas",
            components: [{ id: "h", component: "Heading", text: "hi", level: "h1" }],
          },
        },
      ]),
    );

    expect(decoded.spec).toBeNull();
    expect(decoded.issues[0]).toContain('"id": "root"');
  });

  // A2UI has NO content-avoidance mechanism — verified against its schema, not
  // assumed. Nothing in this adapter may invent one for it, and nothing may
  // report one it does not have.
  test("no A2UI document ever reads as having used a reference", () => {
    const decoded = compileA2uiDocument(JSON.stringify(stream));
    expect(decoded.spec).not.toBeNull();

    expect(detectReferenceUsage(ArmId.A2ui, JSON.stringify(stream)).usedReference).toBe(false);
  });
});
