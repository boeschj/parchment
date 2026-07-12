import { describe, expect, it } from "bun:test";
import { prepareSpec } from "./spec-validation.ts";
import type { JsonRenderSpec } from "../shared/types.ts";

// The six single-pass rejection cases from the W3 brief. Each spec is a
// realistic mistake a model makes once; the assertions lock the exact message
// (element key + path + fix) so a regression that makes a message vaguer fails
// here. Two of the six are silently auto-repaired — the strongest single-pass
// outcome — and their tests lock the repair instead of a message.

function spec(partial: JsonRenderSpec): JsonRenderSpec {
  return partial;
}

describe("prepareSpec — single-pass rejection messages", () => {
  it("1. missing child key: names the undefined key and both fixes", () => {
    const { issues } = prepareSpec(
      spec({
        root: "page",
        elements: { page: { type: "Stack", props: {}, children: ["kpis"] } },
      }),
    );
    expect(issues).toEqual([
      'elements/page: children references "kpis", which is not defined in "elements". ' +
        'Add an element with key "kpis", or remove "kpis" from elements/page/children.',
    ]);
  });

  it("2. unseeded $state path: names the element/prop, the path, and how to seed it", () => {
    const { issues } = prepareSpec(
      spec({
        root: "page",
        state: {},
        elements: {
          page: { type: "Stack", props: {}, children: ["m"] },
          m: {
            type: "Metric",
            props: { label: "Now", value: { $template: "${/latest} ms" } },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([
      'elements/m/props/value: binds to state path "/latest" but "/latest" is not seeded ' +
        'in the spec-level "state" object. Add "latest" to "state" (e.g. "state": {"latest": ...}) ' +
        "so the binding resolves.",
    ]);
  });

  it("3. on/repeat inside props: auto-repaired to element level, no rejection", () => {
    const { spec: prepared, issues } = prepareSpec(
      spec({
        root: "page",
        state: { items: [] },
        elements: {
          page: { type: "Stack", props: {}, children: ["btn", "list"] },
          btn: {
            type: "Button",
            props: { label: "Go", on: { press: { action: "canvas.submit", params: { id: "go" } } } },
            children: [],
          },
          list: {
            type: "Card",
            props: { repeat: { statePath: "/items", key: "id" } },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([]);
    expect(prepared.elements.btn?.props.on).toBeUndefined();
    expect(prepared.elements.btn?.on).toBeDefined();
    expect(prepared.elements.list?.props.repeat).toBeUndefined();
    expect(prepared.elements.list?.repeat).toEqual({ statePath: "/items", key: "id" });
  });

  it("4. leaf missing children: auto-repaired to [], no rejection", () => {
    const { spec: prepared, issues } = prepareSpec(
      spec({
        root: "page",
        elements: {
          page: { type: "Stack", props: {}, children: ["h"] },
          h: { type: "Heading", props: { text: "Hi", level: "h1" } },
        },
      }),
    );
    expect(issues).toEqual([]);
    expect(prepared.elements.h?.children).toEqual([]);
  });

  it("5. chart values as strings not numbers: names the series, value, and row", () => {
    const { issues } = prepareSpec(
      spec({
        root: "page",
        elements: {
          page: { type: "Stack", props: {}, children: ["c"] },
          c: {
            type: "Chart",
            props: { kind: "line", x: "day", y: "revenue", data: [{ day: "Mon", revenue: "1200" }] },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([
      'elements/c/props/data: Chart series "revenue" has a non-numeric value "1200" at row 0. ' +
        'Chart plots raw numbers (e.g. 57, not "57" or "57%"). Convert the series values to numbers; ' +
        "keep preformatted strings for Metric or DataTable.",
    ]);
  });

  it("6. duplicate intent id: names the element and the repeated id", () => {
    const { issues } = prepareSpec(
      spec({
        root: "page",
        elements: {
          page: { type: "Stack", props: {}, children: ["a", "b"] },
          a: {
            type: "Button",
            props: { label: "Retry" },
            on: { press: { action: "canvas.intent", params: { id: "retry" } } },
            children: [],
          },
          b: {
            type: "Button",
            props: { label: "Retry again" },
            on: { press: { action: "canvas.intent", params: { id: "retry" } } },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([
      'elements/b: duplicate intent id "retry" — intent ids must be unique per slot',
    ]);
  });
});

describe("prepareSpec — no false rejections", () => {
  it("accepts a live dashboard with expression-bound Metric and Chart", () => {
    const { issues } = prepareSpec(
      spec({
        root: "page",
        state: { series: [], latest: 0 },
        elements: {
          page: { type: "Stack", props: { gap: "lg" }, children: ["kpis", "trend"] },
          kpis: { type: "Grid", props: { columns: 3 }, children: ["now"] },
          now: {
            type: "Metric",
            props: { label: "Current", value: { $template: "${/latest} ms" } },
            children: [],
          },
          trend: {
            type: "Chart",
            props: { kind: "line", x: "t", y: "ms", xScale: "time", data: { $state: "/series" } },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([]);
  });

  it("does not flag a static chart whose series values are numbers", () => {
    const { issues } = prepareSpec(
      spec({
        root: "page",
        elements: {
          page: { type: "Stack", props: {}, children: ["c"] },
          c: {
            type: "Chart",
            props: {
              kind: "area",
              x: "time",
              y: ["input", "output"],
              data: [
                { time: "09:00", input: 120_000, output: 40_000 },
                { time: "10:00", input: 180_000, output: 62_000 },
              ],
            },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([]);
  });
});

describe("prepareSpec — rejection is not noisy", () => {
  // Regression for the old formatSpecIssues path, which prepended a header line
  // and double-bulleted, inflating a single structural error into "2 issues".
  it("reports exactly one issue for one missing child, with no header line", () => {
    const { issues } = prepareSpec(
      spec({
        root: "page",
        elements: { page: { type: "Stack", props: {}, children: ["ghost"] } },
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).not.toContain("The generated UI spec");
    expect(issues[0]?.startsWith("- ")).toBe(false);
  });
});
