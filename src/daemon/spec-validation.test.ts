import { describe, expect, it } from "bun:test";
import { applySpecPatch, type JsonPatch, type Spec } from "@json-render/core";
import { prepareSpec } from "./spec-validation.ts";
import { STARTER_TEMPLATES } from "../shared/templates/index.ts";
import { demoSpec } from "../../scripts/demo-live.ts";
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

  it("5b. chart with a static empty data array: names both ways out", () => {
    const { issues } = prepareSpec(
      spec({
        root: "page",
        elements: {
          page: { type: "Stack", props: {}, children: ["c"] },
          c: { type: "Chart", props: { kind: "line", x: "day", y: "revenue", data: [] }, children: [] },
        },
      }),
    );
    expect(issues).toEqual([
      "elements/c/props/data: Chart data is an empty array — the chart paints one blank mark with no axis labels, " +
        "and a static [] can never fill. " +
        'Seed the rows you are plotting (e.g. "data": [{"day": "Mon", "runs": 12}]), or, if the rows arrive later, ' +
        'bind data to state ("data": {"$state": "/series"}) and seed "series" in the spec-level "state" — ' +
        "a bound chart may start empty, a literal one may not.",
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

  // The empty-at-first chart is the whole reason a static [] is rejected rather
  // than repaired: a chart with no rows YET is a bound chart, and it must stay
  // renderable from the moment the spec lands, before any row exists.
  it("accepts a {$state}-bound chart whose seeded rows are still empty", () => {
    const { issues } = prepareSpec(
      spec({
        root: "page",
        state: { series: [] },
        elements: {
          page: { type: "Stack", props: {}, children: ["c"] },
          c: {
            type: "Chart",
            props: { kind: "line", x: "t", y: "ms", data: { $state: "/series" } },
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

describe("canvas_patch cookbook — the five worked edits apply and validate", () => {
  // Mirror of the canvas_patch tool: applySpecPatch loop -> prepareSpec. Locks
  // the five examples in references/patch-cookbook.md (also verified live against
  // a daemon slot on CANVAS_PORT=7813).
  const base: JsonRenderSpec = {
    root: "page",
    elements: {
      page: { type: "Stack", props: { gap: "lg" }, children: ["title", "m1", "tbl", "details", "chart"] },
      title: { type: "Heading", props: { text: "Latency review", level: "h1" }, children: [] },
      m1: { type: "Metric", props: { label: "p99", value: "412 ms" }, children: [] },
      tbl: {
        type: "DataTable",
        props: {
          columns: [{ key: "route", header: "Route" }, { key: "p99", header: "p99", type: "number" }],
          rows: [{ route: "/api", p99: 120 }],
        },
        children: [],
      },
      details: { type: "Card", props: { title: "Details" }, visible: true, children: [] },
      chart: { type: "Chart", props: { kind: "line", x: "day", y: "revenue", data: [{ day: "Mon", revenue: 1240 }] }, children: [] },
    },
  };

  function applyCookbookPatch(patches: JsonPatch[]): JsonRenderSpec {
    let patched = base as unknown as Spec;
    for (const patch of patches) patched = applySpecPatch(patched, patch);
    const { spec, issues } = prepareSpec(patched as unknown as JsonRenderSpec);
    expect(issues).toEqual([]);
    return spec;
  }

  it("1. change a metric value", () => {
    const s = applyCookbookPatch([{ op: "replace", path: "/elements/m1/props/value", value: "388 ms" }]);
    expect(s.elements.m1?.props.value).toBe("388 ms");
  });

  it("2. add a DataTable row", () => {
    const s = applyCookbookPatch([{ op: "add", path: "/elements/tbl/props/rows/-", value: { route: "/checkout", p99: 512 } }]);
    expect(s.elements.tbl?.props.rows).toEqual([{ route: "/api", p99: 120 }, { route: "/checkout", p99: 512 }]);
  });

  it("3. toggle visibility", () => {
    const s = applyCookbookPatch([{ op: "replace", path: "/elements/details/visible", value: false }]);
    expect(s.elements.details?.visible).toBe(false);
  });

  it("4. append a chart point", () => {
    const s = applyCookbookPatch([{ op: "add", path: "/elements/chart/props/data/-", value: { day: "Tue", revenue: 1380 } }]);
    expect(s.elements.chart?.props.data).toEqual([{ day: "Mon", revenue: 1240 }, { day: "Tue", revenue: 1380 }]);
  });

  it("5. retitle", () => {
    const s = applyCookbookPatch([{ op: "replace", path: "/elements/title/props/text", value: "Q3 latency review" }]);
    expect(s.elements.title?.props.text).toBe("Q3 latency review");
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

// A single element wrapped in the minimal valid spec so a prop coercion can be
// asserted in isolation.
function oneElement(type: string, props: Record<string, unknown>): JsonRenderSpec {
  return { root: "el", elements: { el: { type, props, children: [] } } };
}

describe("prepareSpec — enum synonym auto-repair", () => {
  it("numeric Stack gap → nearest spacing token, no rejection", () => {
    const { spec: prepared, issues, repairs } = prepareSpec(oneElement("Stack", { gap: 16 }));
    expect(issues).toEqual([]);
    expect(prepared.elements.el?.props.gap).toBe("md");
    expect(repairs).toEqual(['elements/el/props/gap: coerced 16 → "md"']);
  });

  it("numeric Stack gap 4 and 6 → sm (nearest, ties toward the more visible token)", () => {
    expect(prepareSpec(oneElement("Stack", { gap: 4 })).spec.elements.el?.props.gap).toBe("sm");
    expect(prepareSpec(oneElement("Stack", { gap: 6 })).spec.elements.el?.props.gap).toBe("sm");
    expect(prepareSpec(oneElement("Stack", { gap: 24 })).spec.elements.el?.props.gap).toBe("lg");
    expect(prepareSpec(oneElement("Stack", { gap: 40 })).spec.elements.el?.props.gap).toBe("xl");
  });

  it("numeric-string gap \"16\" → md (a stringified number reads as pixels)", () => {
    const { spec: prepared, issues } = prepareSpec(oneElement("Stack", { gap: "16" }));
    expect(issues).toEqual([]);
    expect(prepared.elements.el?.props.gap).toBe("md");
  });

  it("numeric Grid gap that maps to 'none' falls back to 'sm' (Grid has no none)", () => {
    // Grid's spacing enum omits "none"; a 2px gap nearest 'none' must still land
    // on a value Grid actually accepts.
    const { spec: prepared, issues } = prepareSpec(oneElement("Grid", { columns: 3, gap: 2 }));
    expect(issues).toEqual([]);
    expect(prepared.elements.el?.props.gap).toBe("sm");
  });

  it("spacing words small/medium/large → sm/md/lg", () => {
    expect(prepareSpec(oneElement("Stack", { gap: "small" })).spec.elements.el?.props.gap).toBe("sm");
    expect(prepareSpec(oneElement("Stack", { gap: "medium" })).spec.elements.el?.props.gap).toBe("md");
    expect(prepareSpec(oneElement("Stack", { gap: "large" })).spec.elements.el?.props.gap).toBe("lg");
  });

  it("Heading level 1 | \"1\" | \"H1\" → h1, and 5/6 clamp to h4", () => {
    expect(prepareSpec(oneElement("Heading", { text: "A", level: 1 })).spec.elements.el?.props.level).toBe("h1");
    expect(prepareSpec(oneElement("Heading", { text: "A", level: "1" })).spec.elements.el?.props.level).toBe("h1");
    expect(prepareSpec(oneElement("Heading", { text: "A", level: "H1" })).spec.elements.el?.props.level).toBe("h1");
    expect(prepareSpec(oneElement("Heading", { text: "A", level: 2 })).spec.elements.el?.props.level).toBe("h2");
    expect(prepareSpec(oneElement("Heading", { text: "A", level: 5 })).spec.elements.el?.props.level).toBe("h4");
    expect(prepareSpec(oneElement("Heading", { text: "A", level: 6 })).spec.elements.el?.props.level).toBe("h4");
  });

  it("Stack direction row → horizontal, column → vertical", () => {
    expect(prepareSpec(oneElement("Stack", { direction: "row" })).spec.elements.el?.props.direction).toBe("horizontal");
    expect(prepareSpec(oneElement("Stack", { direction: "column" })).spec.elements.el?.props.direction).toBe("vertical");
  });

  it("Button variant default → primary, destructive → danger", () => {
    expect(prepareSpec(oneElement("Button", { label: "Go", variant: "default" })).spec.elements.el?.props.variant).toBe("primary");
    expect(prepareSpec(oneElement("Button", { label: "Go", variant: "destructive" })).spec.elements.el?.props.variant).toBe("danger");
  });

  it("Badge variant danger/error → destructive, primary → default", () => {
    expect(prepareSpec(oneElement("Badge", { text: "P1", variant: "danger" })).spec.elements.el?.props.variant).toBe("destructive");
    expect(prepareSpec(oneElement("Badge", { text: "err", variant: "error" })).spec.elements.el?.props.variant).toBe("destructive");
    expect(prepareSpec(oneElement("Badge", { text: "ok", variant: "primary" })).spec.elements.el?.props.variant).toBe("default");
  });

  it("Text variant default → body, secondary → muted", () => {
    expect(prepareSpec(oneElement("Text", { text: "hi", variant: "default" })).spec.elements.el?.props.variant).toBe("body");
    expect(prepareSpec(oneElement("Text", { text: "hi", variant: "secondary" })).spec.elements.el?.props.variant).toBe("muted");
  });

  it("Chart xScale linear → category, timestamp → time", () => {
    const linear = prepareSpec(
      oneElement("Chart", { kind: "line", x: "t", y: "value", data: [{ t: 1, value: 2 }], xScale: "linear" }),
    );
    expect(linear.issues).toEqual([]);
    expect(linear.spec.elements.el?.props.xScale).toBe("category");
    const ts = prepareSpec(
      oneElement("Chart", { kind: "line", x: "t", y: "value", data: [{ t: 1, value: 2 }], xScale: "timestamp" }),
    );
    expect(ts.spec.elements.el?.props.xScale).toBe("time");
  });

  it("Steps items without a status validate (status is optional, renders neutral)", () => {
    const { issues } = prepareSpec(
      oneElement("Steps", {
        items: [{ title: "Deploy", description: "raised pool size" }, { title: "Recovered" }],
      }),
    );
    expect(issues).toEqual([]);
  });

  it("leaves genuinely ambiguous enum values untouched — still rejected with the fix", () => {
    const { spec: prepared, issues } = prepareSpec(oneElement("Button", { label: "Go", variant: "fancy" }));
    expect(prepared.elements.el?.props.variant).toBe("fancy");
    expect(issues).toEqual([
      'elements/el/props/variant: Invalid option: expected one of "primary"|"secondary"|"danger"',
    ]);
  });

  it("never coerces an expression-bound value", () => {
    const { spec: prepared, issues } = prepareSpec(
      spec({
        root: "page",
        state: { g: "md" },
        elements: {
          page: { type: "Stack", props: { gap: { $state: "/g" } }, children: [] },
        },
      }),
    );
    expect(issues).toEqual([]);
    expect(prepared.elements.page?.props.gap).toEqual({ $state: "/g" });
  });
});

describe("prepareSpec — observed bench failures now render on the first pass", () => {
  // Each spec below is the exact shape a sonnet run pushed and had REJECTED in
  // bench/results/2026-07-12T15-07-38-053Z. After the auto-repair they must
  // validate with zero issues — the whole point of the coercion layer.

  it("live-log-dashboard: gap 16 + level 1 + xScale 'linear' all repair", () => {
    const { issues } = prepareSpec(
      spec({
        root: "root",
        state: { errorRateSeries: [{ t: 1, value: 2 }] },
        elements: {
          root: { type: "Stack", props: { gap: 16 }, children: ["heading", "chart"] },
          heading: { type: "Heading", props: { level: 1, text: "Log Monitoring" }, children: [] },
          chart: {
            type: "Chart",
            props: { kind: "line", data: { $state: "/errorRateSeries" }, x: "t", y: "value", xScale: "linear", height: 260 },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([]);
  });

  it("validated-form: Button variant 'default' repairs to primary", () => {
    const { issues } = prepareSpec(
      spec({
        root: "card",
        state: { form: { name: "" } },
        elements: {
          card: { type: "Card", props: { title: "Create an account" }, children: ["submitBtn"] },
          submitBtn: {
            type: "Button",
            props: { label: "Sign up", variant: "default" },
            on: { press: { action: "canvas.submit", params: { id: "signup", payload: { $state: "/form" } } } },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([]);
  });

  it("status-dashboard: Stack gap 16 + Heading level 1 + two Grid gap 16 all repair", () => {
    const { issues } = prepareSpec(
      spec({
        root: "page",
        elements: {
          page: { type: "Stack", props: { gap: 16 }, children: ["heading", "kpiRow", "chartsGrid"] },
          heading: { type: "Heading", props: { text: "CI Status Dashboard", level: 1 }, children: [] },
          kpiRow: { type: "Grid", props: { columns: 3, gap: 16 }, children: [] },
          chartsGrid: { type: "Grid", props: { columns: 2, gap: 16 }, children: [] },
        },
      }),
    );
    expect(issues).toEqual([]);
  });

  it("incident-report: Heading levels 1 and 2 + Steps items missing status all repair", () => {
    const { issues } = prepareSpec(
      spec({
        root: "page",
        elements: {
          page: { type: "Stack", props: { gap: "lg" }, children: ["heading", "timelineHeading", "steps"] },
          heading: { type: "Heading", props: { text: "Checkout API Incident Postmortem", level: 1 }, children: [] },
          timelineHeading: { type: "Heading", props: { text: "Timeline", level: 2 }, children: [] },
          steps: {
            type: "Steps",
            props: {
              items: [
                { title: "14:02 — Deploy", description: "Deploy raised connection pool size to 5." },
                { title: "14:14 — Recovered", description: "Error rate returned to baseline." },
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

// Round-two dialect failures, observed verbatim in the post-redesign bench runs
// (bench/results/2026-07-12T19-52-*): the enum synonyms died and expressive
// models surfaced a NEW class — plausible dialect. Each case below is the real
// spec shape a model emitted; the assertion is that it renders first-pass.

describe("prepareSpec — observed dialect failures repair first-pass", () => {
  it("opus status-dashboard: gap 'xs' repairs to sm", () => {
    const { issues, repairs } = prepareSpec(
      spec({
        root: "header",
        elements: { header: { type: "Stack", props: { gap: "xs" }, children: [] } },
      }),
    );
    expect(issues).toEqual([]);
    expect(repairs).toContainEqual('elements/header/props/gap: coerced "xs" → "sm"');
  });

  it("opus status-dashboard: Metric delta as a number stringifies", () => {
    const { issues, repairs } = prepareSpec(
      spec({
        root: "kpiPass",
        elements: {
          kpiPass: {
            type: "Metric",
            props: { label: "Build Pass Rate", value: "94%", delta: 1.8, trend: "up" },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([]);
    expect(repairs).toContainEqual('elements/kpiPass/props/delta: coerced 1.8 → "1.8"');
  });

  it("sonnet status-dashboard: Chart data '$state.buildDuration' becomes the expression object", () => {
    const { issues, spec: repaired } = prepareSpec(
      spec({
        root: "buildDurationChart",
        state: { buildDuration: [] },
        elements: {
          buildDurationChart: {
            type: "Chart",
            props: { kind: "bar", data: "$state.buildDuration", xKey: "day", yKeys: ["minutes"] },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([]);
    const chartProps = repaired.elements["buildDurationChart"]!.props;
    expect(chartProps.data).toEqual({ $state: "/buildDuration" });
    expect(chartProps.x).toBe("day");
    expect(chartProps.y).toEqual(["minutes"]);
    expect(chartProps.xKey).toBeUndefined();
    expect(chartProps.yKeys).toBeUndefined();
  });

  it("sonnet csv-table: DataTable data→rows and columns label→header", () => {
    const { issues, spec: repaired } = prepareSpec(
      spec({
        root: "table",
        state: { rows: [] },
        elements: {
          table: {
            type: "DataTable",
            props: {
              data: "$state.rows",
              columns: [
                { key: "name", label: "Name" },
                { key: "role", label: "Role" },
              ],
            },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([]);
    const tableProps = repaired.elements["table"]!.props;
    expect(tableProps.rows).toEqual({ $state: "/rows" });
    expect(tableProps.data).toBeUndefined();
    expect(tableProps.columns).toEqual([
      { key: "name", header: "Name" },
      { key: "role", header: "Role" },
    ]);
  });

  it("opus validated-form: unknown component 'Form' aliases to Card", () => {
    const { issues, spec: repaired, repairs } = prepareSpec(
      spec({
        root: "form",
        state: { form: { name: "" } },
        elements: {
          form: { type: "Form", props: { title: "Sign up" }, children: ["name"] },
          name: {
            type: "Input",
            props: { label: "Name", name: "name", value: { $bindState: "/form/name" } },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([]);
    expect(repaired.elements["form"]!.type).toBe("Card");
    expect(repairs).toContainEqual('elements/form/type: coerced "Form" → "Card"');
  });

  it("$bindState shorthand string also converts", () => {
    const { issues, spec: repaired } = prepareSpec(
      spec({
        root: "field",
        state: { form: { email: "" } },
        elements: {
          field: {
            type: "Input",
            props: { label: "Email", name: "email", value: "$bindState./form/email" },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([]);
    expect(repaired.elements["field"]!.props.value).toEqual({ $bindState: "/form/email" });
  });

  it("shorthand pointing at an unseeded key still rejects with the seeding fix", () => {
    const { issues } = prepareSpec(
      spec({
        root: "chart",
        state: {},
        elements: {
          chart: {
            type: "Chart",
            props: { kind: "line", data: "$state.series", x: "t", y: "value" },
            children: [],
          },
        },
      }),
    );
    expect(issues.length).toBe(1);
    expect(issues[0]).toContain('"/series" is not seeded');
  });

  it("ordinary text starting with a dollar amount is untouched", () => {
    const { issues, spec: repaired } = prepareSpec(
      spec({
        root: "t",
        elements: {
          t: { type: "Text", props: { text: "$state of the art pricing: $12" }, children: [] },
        },
      }),
    );
    expect(issues).toEqual([]);
    expect(repaired.elements["t"]!.props.text).toBe("$state of the art pricing: $12");
  });
});

// Every spec below is verbatim from bench/results/2026-07-12T22-28-37-337Z (the
// run whose results were invalidated) or its opus companion
// bench/results/2026-07-12T22-32-01-708Z. ALL 24 of those specs passed
// validation and 23 of them rendered something broken — an empty chart, a blank
// diagram, a dead button — because the validator applied .partial() to every
// component schema and stripped expression props before parsing, so a prop the
// renderer never reads was indistinguishable from a prop it does. Each test
// below is one of those specs and the exact message the model now gets back.

describe("prepareSpec — everything we ship validates clean", () => {
  // The starter templates are seeded into every fresh install's library and the
  // demo spec is the first canvas most people ever see. If strict validation
  // rejects one of them, the strictness is wrong or the example is — either way
  // this fails before a user finds out.

  for (const template of STARTER_TEMPLATES) {
    it(`starter template "${template.name}" validates clean`, () => {
      expect(prepareSpec(template.spec).issues).toEqual([]);
    });
  }

  it("scripts/demo-live.ts spec validates clean", () => {
    expect(prepareSpec(demoSpec).issues).toEqual([]);
  });
});

describe("prepareSpec — a prop the renderer ignores is a rejection", () => {
  it("Chart {chartType, xKey, series}: names each unknown prop and each missing required one", () => {
    // status-dashboard-parchment-sonnet-rep1: rendered an empty chart, passed.
    const { issues } = prepareSpec(
      spec({
        root: "buildChart",
        state: { buildDuration: [{ day: "Mon", minutes: 12 }] },
        elements: {
          buildChart: {
            type: "Chart",
            props: {
              title: "Build Durations",
              chartType: "bar",
              xKey: "day",
              series: [{ key: "minutes", label: "Minutes" }],
            },
            children: [],
          },
        },
      }),
    );
    // xKey is a DECLARED alias — it normalizes to x and never appears here.
    expect(issues).toEqual([
      'elements/buildChart/props/chartType: unknown prop "chartType" for Chart — the renderer ignores it. ' +
        "Chart accepts: kind, data, x, y, title, height, xScale.",
      'elements/buildChart/props/series: unknown prop "series" for Chart — the renderer ignores it. ' +
        "Chart accepts: kind, data, x, y, title, height, xScale.",
      'elements/buildChart/props/kind: Chart requires "kind", which is missing — give it a value or bind it ' +
        '({"$state": "/path"}). Chart requires: kind, data, x, y.',
      'elements/buildChart/props/data: Chart requires "data", which is missing — give it a value or bind it ' +
        '({"$state": "/path"}). Chart requires: kind, data, x, y.',
      'elements/buildChart/props/y: Chart requires "y", which is missing — give it a value or bind it ' +
        '({"$state": "/path"}). Chart requires: kind, data, x, y.',
    ]);
  });

  it("MermaidEditor {code}: the diagram that rendered nothing", () => {
    // architecture-diagram-parchment-sonnet-rep1, all three reps identical.
    const { issues } = prepareSpec(
      spec({
        root: "editor",
        elements: {
          editor: {
            type: "MermaidEditor",
            props: { code: "graph LR\n  Client[Client] --> API[API]" },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([
      'elements/editor/props/code: unknown prop "code" for MermaidEditor — the renderer ignores it. ' +
        "MermaidEditor accepts: title, source, editable, showSource, comments, theme.",
      'elements/editor/props/source: MermaidEditor requires "source", which is missing — give it a value or ' +
        'bind it ({"$state": "/path"}). MermaidEditor requires: source.',
    ]);
  });

  it("Stack {padding}: a prop that never existed", () => {
    // Present in 7 of the 24 bench specs; silently dropped every time.
    const { issues } = prepareSpec(oneElement("Stack", { gap: "lg", padding: 16 }));
    expect(issues).toEqual([
      'elements/el/props/padding: unknown prop "padding" for Stack — the renderer ignores it. ' +
        "Stack accepts: direction, gap, align, justify, className.",
    ]);
  });

  it("Steps {steps} and Markdown {text}: near-miss names get a did-you-mean", () => {
    // incident-report-parchment-sonnet-rep1.
    const { issues } = prepareSpec(
      spec({
        root: "page",
        elements: {
          page: { type: "Stack", props: {}, children: ["timeline"] },
          timeline: {
            type: "Steps",
            props: { steps: [{ title: "14:02", description: "Deploy" }] },
            children: [],
          },
        },
      }),
    );
    expect(issues[0]).toContain('unknown prop "steps" for Steps');
    expect(issues[0]).toContain('Did you mean "items"?');
    expect(issues[1]).toContain('Steps requires "items"');
  });

  it("Callout {variant, text}: two unknown props, two missing required ones", () => {
    // incident-report-parchment-sonnet-rep2.
    const { issues } = prepareSpec(
      oneElement("Callout", { variant: "critical", title: "Verdict", text: "Checkout API returned 500s." }),
    );
    expect(issues).toHaveLength(4);
    expect(issues[0]).toContain('unknown prop "variant" for Callout');
    expect(issues[1]).toContain('unknown prop "text" for Callout');
    expect(issues[2]).toContain('Callout requires "tone"');
    expect(issues[3]).toContain('Callout requires "body"');
  });

  it("a misspelled prop gets the nearest known name", () => {
    const { issues } = prepareSpec(oneElement("DataTable", { colums: [], rows: [] }));
    expect(issues[0]).toContain('unknown prop "colums" for DataTable');
    expect(issues[0]).toContain('Did you mean "columns"?');
  });
});

describe("prepareSpec — required props are presence-checked, expressions satisfy them", () => {
  it("DataTable with columns but no rows: the table that rendered empty", () => {
    // csv-data-table-parchment-sonnet-rep1: rows were parked in `watch`, which
    // feeds nothing. Passed validation, rendered a header row and no data.
    const { issues } = prepareSpec(
      spec({
        root: "table",
        state: { rows: [{ name: "Ada Lovelace", role: "Engineer" }] },
        elements: {
          table: {
            type: "DataTable",
            props: { columns: [{ key: "name", header: "Name" }] },
            watch: { rows: "rows" },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([
      'elements/table/props/rows: DataTable requires "rows", which is missing — give it a value or bind it ' +
        '({"$state": "/path"}). DataTable requires: columns, rows.',
      'elements/table/watch/rows: "rows" is not a JSON Pointer state path. watch keys are pointers ("/series") ' +
        "whose value changes fire the bound actions — it does not feed props. To feed a prop from state, bind " +
        'the prop: "props": {"<prop>": {"$state": "/rows"}}.',
    ]);
  });

  it("the same DataTable, bound the way it should be, validates clean", () => {
    const { issues } = prepareSpec(
      spec({
        root: "table",
        state: { rows: [{ name: "Ada Lovelace", role: "Engineer" }] },
        elements: {
          table: {
            type: "DataTable",
            props: { columns: [{ key: "name", header: "Name" }], rows: { $state: "/rows" } },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([]);
  });

  it("an expression satisfies required-ness for every expression form", () => {
    const { issues } = prepareSpec(
      spec({
        root: "page",
        state: { series: [], latest: 0, kind: "line", label: "p99" },
        elements: {
          page: { type: "Stack", props: {}, children: ["m", "c", "h"] },
          m: {
            type: "Metric",
            props: { label: { $state: "/label" }, value: { $template: "${/latest} ms" } },
            children: [],
          },
          c: {
            type: "Chart",
            props: { kind: { $state: "/kind" }, data: { $state: "/series" }, x: "t", y: "ms" },
            children: [],
          },
          h: {
            type: "Heading",
            props: { text: { $cond: { path: "/latest", gt: 0 }, $then: "Live", $else: "Idle" } },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([]);
  });
});

// Validation runs BEFORE hydration, so it must know what hydration is about to
// supply — the contract in shared/expressions.ts (PropValueReferences) is the one
// table both passes read. Get this wrong and the flagship reference form is
// rejected for a `columns` array the model cannot write: it has never opened the
// file, which is the entire point of naming it instead of pasting it.
describe("prepareSpec — a reference supplies the props derivable from the file", () => {
  function dataTable(props: Record<string, unknown>): JsonRenderSpec {
    return { root: "t", elements: { t: { type: "DataTable", props, children: [] } } };
  }

  it("a $csv in rows satisfies columns — the daemon derives it from the header", () => {
    const { issues } = prepareSpec(dataTable({ rows: { $csv: "bench/results.csv" } }));
    expect(issues).toEqual([]);
  });

  it("the bare-string shorthand is the same reference and satisfies it too", () => {
    const { issues } = prepareSpec(dataTable({ rows: "$csv:bench/results.csv" }));
    expect(issues).toEqual([]);
  });

  it("an authored columns array is left exactly as written", () => {
    const columns = [{ key: "run", header: "Run" }];
    const { spec: prepared, issues } = prepareSpec(
      dataTable({ rows: { $csv: "bench/results.csv" }, columns }),
    );
    expect(issues).toEqual([]);
    expect(prepared.elements.t!.props.columns).toEqual(columns);
  });

  // The supply is not a blanket exemption: without a reference to derive from,
  // columns is still required, and rows still is too.
  it("still requires columns when rows is a literal array", () => {
    const { issues } = prepareSpec(dataTable({ rows: [{ run: "r1" }] }));
    expect(issues).toEqual([
      'elements/t/props/columns: DataTable requires "columns", which is missing — give it a value or bind it ' +
        '({"$state": "/path"}). DataTable requires: columns, rows.',
    ]);
  });

  // A Chart reading the same CSV gets its rows and nothing else. Which series to
  // plot is the model's editorial call, not a fact about the file — so x, y and
  // kind stay required, and saying so is correct, not a gap.
  it("supplies nothing to a Chart: kind, x and y remain the model's to choose", () => {
    const { issues } = prepareSpec({
      root: "c",
      elements: { c: { type: "Chart", props: { data: { $csv: "bench/results.csv" } }, children: [] } },
    });
    expect(issues).toHaveLength(3);
    expect(issues.join("\n")).toContain('Chart requires "kind"');
    expect(issues.join("\n")).toContain('Chart requires "x"');
    expect(issues.join("\n")).toContain('Chart requires "y"');
  });
});

describe("prepareSpec — events, actions and bindings must exist", () => {
  it("Button on.click: the submit button that did nothing", () => {
    // validated-form-parchment-sonnet-rep1/2/3 and both opus reps — every
    // single form in the corpus bound the event the renderer does not emit.
    const { issues } = prepareSpec(
      spec({
        root: "submitBtn",
        elements: {
          submitBtn: {
            type: "Button",
            props: { label: "Sign up" },
            on: { click: { action: "canvas.submit", params: { id: "signup" } } },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([
      'elements/submitBtn/on/click: Button does not emit "click", so this binding never fires. ' +
        'Button emits: press. Rebind it under "press".',
    ]);
  });

  it("an on binding on a component that emits nothing", () => {
    const { issues } = prepareSpec(
      spec({
        root: "card",
        elements: {
          card: {
            type: "Card",
            props: { title: "Deploy" },
            on: { press: { action: "canvas.submit", params: { id: "deploy" } } },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([
      "elements/card/on/press: Card emits no events, so this binding never fires. " +
        'Move it to a component that does (a Button emits "press").',
    ]);
  });

  it("an action no handler is registered for", () => {
    const { issues } = prepareSpec(
      spec({
        root: "btn",
        elements: {
          btn: {
            type: "Button",
            props: { label: "Save" },
            on: { press: { action: "submitForm", params: { id: "save" } } },
            children: [],
          },
        },
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('unknown action "submitForm" — no handler is registered');
    expect(issues[0]).toContain("Known actions: canvas.commentMermaid, canvas.flushPending, canvas.submit, canvas.intent, setState, pushState, removeState, validateForm, push, pop.");
  });

  it("a near-miss action name gets a did-you-mean", () => {
    const { issues } = prepareSpec(
      spec({
        root: "btn",
        elements: {
          btn: {
            type: "Button",
            props: { label: "Save" },
            on: { press: { action: "setSate", params: { statePath: "/x", value: 1 } } },
            children: [],
          },
        },
      }),
    );
    expect(issues[0]).toContain('Did you mean "setState"?');
  });

  it("$bindState hoisted to the element: the input that never bound", () => {
    // validated-form-parchment-sonnet-rep1 — "$bindState": {"value": "form.name"}
    // sat beside `type` and `props`, where the renderer never looks.
    const { issues } = prepareSpec(
      spec({
        root: "nameInput",
        state: { form: { name: "" } },
        elements: {
          nameInput: {
            type: "Input",
            props: { label: "Name", name: "name" },
            children: [],
            ...{ $bindState: { value: "form.name" } },
          },
        },
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('unknown element field "$bindState"');
    expect(issues[0]).toContain("An element carries only: type, props, children, on, visible, repeat, watch.");
  });

  it("$bindState on a prop that never writes back", () => {
    const { issues } = prepareSpec(
      spec({
        root: "page",
        state: { latest: 0, form: { name: "" } },
        elements: {
          page: { type: "Stack", props: {}, children: ["m", "i"] },
          m: {
            type: "Metric",
            props: { label: "p99", value: { $bindState: "/latest" } },
            children: [],
          },
          i: {
            type: "Input",
            props: { label: "Name", name: { $bindState: "/form/name" }, value: "" },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([
      "elements/m/props/value: $bindState on Metric.value never writes back. Metric is read-only — use " +
        '{"$state": "/path"} to read a value. $bindState belongs on a form component\'s value prop ' +
        "(Input/Textarea/Select/Checkbox/Switch/Slider/...).",
      "elements/i/props/name: $bindState on Input.name never writes back. Input writes back only through " +
        '"value" — move the binding to props/value, or use {"$state": "/path"} for a read-only value.',
    ]);
  });
});

describe("prepareSpec — form checks must be real and reachable", () => {
  it("an unknown check type", () => {
    const { issues } = prepareSpec(
      spec({
        root: "email",
        state: { form: { email: "" } },
        elements: {
          email: {
            type: "Input",
            props: {
              label: "Email",
              name: "email",
              value: { $bindState: "/form/email" },
              checks: [
                { type: "required", message: "Required" },
                { type: "isEmail", message: "Enter a valid email" },
              ],
            },
            children: [],
          },
        },
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('elements/email/props/checks/1/type: unknown check "isEmail".');
    expect(issues[0]).toContain('Did you mean "email"?');
  });

  it("checks on a field that is not bound never run", () => {
    const { issues } = prepareSpec(
      spec({
        root: "email",
        elements: {
          email: {
            type: "Input",
            props: {
              label: "Email",
              name: "email",
              checks: [{ type: "required", message: "Required" }],
            },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([
      "elements/email/props/checks: checks only run on a $bindState-bound field, and Input.value is not bound — " +
        'nothing validates. Bind it: "value": {"$bindState": "/form/email"}.',
    ]);
  });

  it("a correctly bound, correctly checked form validates clean", () => {
    const { issues } = prepareSpec(
      spec({
        root: "card",
        state: { form: { email: "" } },
        elements: {
          card: { type: "Card", props: { title: "Sign up" }, children: ["email", "submit"] },
          email: {
            type: "Input",
            props: {
              label: "Email",
              name: "email",
              type: "email",
              value: { $bindState: "/form/email" },
              checks: [
                { type: "required", message: "Email is required" },
                { type: "email", message: "Enter a valid email" },
              ],
              validateOn: "blur",
            },
            children: [],
          },
          submit: {
            type: "Button",
            props: { label: "Sign up" },
            on: { press: { action: "canvas.submit", params: { id: "signup", payload: { $state: "/form" } } } },
            children: [],
          },
        },
      }),
    );
    expect(issues).toEqual([]);
  });
});
