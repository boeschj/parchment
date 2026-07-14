// The three reference documents compiled end to end. Each golden asserts the
// contract the dialect promises: the markup compiles with no issues, the spec it
// produces survives prepareSpec with ZERO issues (so canvas_render would accept
// it unchanged), and the exact spec is snapshotted so any drift in the tag table,
// key scheme, or attribute handling shows up as a reviewable diff.

import { describe, expect, test } from "bun:test";
import { compileMarkup } from "./index.ts";
import { prepareSpec } from "../spec-validation.ts";
import {
  DASHBOARD_MARKUP,
  MIXED_REPORT_MARKUP,
  REFERENCE_REVIEW_MARKUP,
  SIGNUP_FORM_MARKUP,
} from "./goldens.fixture.ts";

const GOLDENS = [
  { name: "dashboard", markup: DASHBOARD_MARKUP },
  { name: "signup-form", markup: SIGNUP_FORM_MARKUP },
  { name: "mixed-report", markup: MIXED_REPORT_MARKUP },
  { name: "reference-review", markup: REFERENCE_REVIEW_MARKUP },
];

for (const golden of GOLDENS) {
  describe(`golden: ${golden.name}`, () => {
    test("compiles with no issues", () => {
      expect(compileMarkup(golden.markup).issues).toEqual([]);
    });

    test("passes prepareSpec with zero issues", () => {
      const compiled = compileMarkup(golden.markup);
      expect(prepareSpec(compiled.spec).issues).toEqual([]);
    });

    test("compiles to the expected spec", () => {
      const prepared = prepareSpec(compileMarkup(golden.markup).spec);
      expect(prepared.spec).toMatchSnapshot();
    });

    test("is cheaper to author than the JSON spec it produces", () => {
      const prepared = prepareSpec(compileMarkup(golden.markup).spec);
      const specChars = JSON.stringify(prepared.spec).length;
      expect(golden.markup.length).toBeLessThan(specChars);
    });
  });
}

describe("golden: dashboard", () => {
  const spec = prepareSpec(compileMarkup(DASHBOARD_MARKUP).spec).spec;

  test("seeds the chart's state from the <state> element", () => {
    expect(Object.keys(spec.state ?? {})).toEqual(["ci"]);
    expect(spec.elements["chart-2"]?.props.data).toEqual({ $state: "/ci" });
  });

  test("the metric row and the intent button survive", () => {
    const types = Object.values(spec.elements).map((element) => element.type);
    expect(types.filter((type) => type === "Metric")).toHaveLength(3);
    expect(spec.elements["button-5"]?.on?.press).toEqual([
      { action: "canvas.intent", params: { id: "rerun-pipeline", params: { pipeline: "ci", cache: false } } },
    ]);
  });

  test("the jobs table became a DataTable with numeric columns", () => {
    const table = spec.elements["datatable-4"];
    expect(table?.type).toBe("DataTable");
    expect(table?.props.columns).toEqual([
      { key: "job", header: "Job" },
      { key: "p99_ms", header: "p99 ms", type: "number", align: "right" },
      { key: "calls", header: "Calls", type: "number", align: "right" },
    ]);
  });
});

describe("golden: signup-form", () => {
  const spec = prepareSpec(compileMarkup(SIGNUP_FORM_MARKUP).spec).spec;

  test("every input is two-way bound to seeded form state", () => {
    expect(spec.state).toEqual({ form: { name: "", email: "", password: "", plan: "Starter" } });
    expect(spec.elements["input-0"]?.props.value).toEqual({ $bindState: "/form/name" });
    expect(spec.elements["input-1"]?.props.value).toEqual({ $bindState: "/form/email" });
    expect(spec.elements["input-2"]?.props.value).toEqual({ $bindState: "/form/password" });
  });

  test("native validation attributes became catalog checks", () => {
    expect(spec.elements["input-2"]?.props.checks).toEqual([
      { type: "required", message: "Required" },
      { type: "minLength", args: { value: 8 }, message: "Must be at least 8 characters" },
    ]);
  });

  test("the submit button carries a canvas.submit binding", () => {
    expect(spec.elements["button-5"]?.on?.press).toEqual([
      { action: "canvas.submit", params: { id: "signup", payload: { $state: "/form" } } },
    ]);
  });
});

// The ladder's payoff, asserted end to end: not one byte of the diff, the source
// excerpt, the benchmark rows, or the log tail appears in the authored document.
describe("golden: reference-review", () => {
  const spec = prepareSpec(compileMarkup(REFERENCE_REVIEW_MARKUP).spec).spec;

  test("every heavy element is a reference, not pasted content", () => {
    expect(spec.elements["diffviewer-2"]?.props).toEqual({ $diff: "src/api/cache.ts", base: "HEAD~1" });
    expect(spec.elements["codeblock-4"]?.props.code).toEqual({
      $file: "src/api/cache.ts",
      lines: "40-80",
    });
    expect(spec.elements["datatable-6"]?.props.rows).toEqual({ $csv: "bench/results.csv" });
    expect(spec.elements["chart-7"]?.props.data).toEqual({ $csv: "bench/results.csv" });
    expect(spec.elements["terminal-9"]?.props.output).toEqual({ $file: "logs/app.log", watch: true });
  });

  test("the whole review costs well under a thousand characters to author", () => {
    expect(REFERENCE_REVIEW_MARKUP.length).toBeLessThan(1000);
  });
});

describe("golden: mixed-report", () => {
  const spec = prepareSpec(compileMarkup(MIXED_REPORT_MARKUP).spec).spec;

  test("prose folds into Markdown while code keeps its own widget", () => {
    const types = Object.values(spec.elements).map((element) => element.type);
    expect(types).toContain("Markdown");
    expect(types).toContain("CodeBlock");
    expect(types).toContain("Terminal");
  });

  test("escaped angle brackets survive into the code verbatim", () => {
    expect(spec.elements["codeblock-4"]?.props.code).toContain("Promise<string | null>");
  });

  test("the report needs no state", () => {
    expect(spec.state).toBeUndefined();
  });
});
