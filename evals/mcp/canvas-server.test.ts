// The eval's canvas server is the one component that could rig the benchmark
// without anybody noticing: it is OUR server, serving OUR arms, and every
// temptation runs in the direction of being kinder to a parchment document than
// the real product would be.
//
// It used to be a reimplementation, and that is exactly what went wrong: it drove
// a vendored compiler and a stubbed hydrator, so the benchmark measured a mirror.
// These tests pin the two properties that keep the replacement honest:
//
//   1. It FORKS NOTHING. A markup document goes through the shipped compiler and
//      the shipped validator, and comes out carrying the shipped reference
//      expressions — the ones the DAEMON resolves at push time, not the harness.
//   2. It is NO MORE PERMISSIVE than production. A genuinely invalid spec is
//      rejected, in the product's own words.
//
// Note what is NOT asserted here any more: that <GitDiff> comes back holding the
// bytes of the diff. It does not, and it must not — hydration happens in the
// daemon (src/daemon/hydrate), against the session's cwd, exactly as it does for
// a real user. Asserting bytes here would mean the harness had resolved the
// reference itself, which is the whole bug this rewrite removes. The daemon's own
// tests own that behaviour (src/daemon/hydrate/hydrate.test.ts,
// src/browser/log-reference-render.test.ts).

import { describe, expect, test } from "bun:test";
import {
  parseReferenceValue,
  referenceKeyOf,
  ReferenceExpressionKey,
} from "../../src/shared/expressions.ts";
import { ArmId } from "../types.ts";
import { renderableSpecOf, formatSpecRejection } from "./canvas-server.ts";

const GIT_DIFF_FIXTURE = "repo/src/server.ts";

// Fails the test loudly instead of asserting non-null: a null spec here means the
// server rejected a document it should have accepted, and that is the finding.
function acceptedElementsOf(renderable: ReturnType<typeof renderableSpecOf>) {
  if (renderable.spec === null) {
    throw new Error(`expected an accepted spec, got issues: ${renderable.issues.join("; ")}`);
  }
  return Object.values(renderable.spec.elements);
}

describe("the shipped markup dialect, driven end to end", () => {
  test("a markup document compiles to a valid spec", () => {
    const renderable = renderableSpecOf({
      armId: ArmId.ParchmentMarkupHigh,
      markup: "<section><h1>Latency</h1><p>All good.</p></section>",
    });

    expect(renderable.issues).toEqual([]);
    expect(renderable.spec).not.toBeNull();
  });

  test("a markup document the compiler rejects comes back as the compiler's issues", () => {
    const renderable = renderableSpecOf({
      armId: ArmId.ParchmentMarkupHigh,
      markup: "<section><Nonsense foo='1' /></section>",
    });

    expect(renderable.spec).toBeNull();
    expect(renderable.issues.length).toBeGreaterThan(0);
    expect(renderable.issues.join(" ")).toContain("unknown tag");
  });
});

// ---- The ladder: the model emits an INTENT, the daemon fetches the bytes ------

describe("the reference tags reach the daemon as the references it resolves", () => {
  test("<GitDiff> becomes a DiffViewer carrying an element-level $diff", () => {
    const renderable = renderableSpecOf({
      armId: ArmId.ParchmentMarkupHigh,
      markup: `<GitDiff file="${GIT_DIFF_FIXTURE}" base="HEAD~1" />`,
    });

    expect(renderable.issues).toEqual([]);
    const diffViewer = acceptedElementsOf(renderable).find((element) => element.type === "DiffViewer");

    expect(diffViewer?.props[ReferenceExpressionKey.Diff]).toBe(GIT_DIFF_FIXTURE);
    expect(diffViewer?.props.base).toBe("HEAD~1");
    // The heavy props are ABSENT, and the validator let that pass — which is the
    // entire ladder: the model never emitted a line of the file.
    expect(diffViewer?.props.before).toBeUndefined();
    expect(diffViewer?.props.after).toBeUndefined();
  });

  test("<DataTable src> becomes a $csv in rows, with no columns for the model to guess", () => {
    const renderable = renderableSpecOf({
      armId: ArmId.ParchmentMarkupHigh,
      markup: `<DataTable src="data/results.csv" />`,
    });

    expect(renderable.issues).toEqual([]);
    const table = acceptedElementsOf(renderable).find((element) => element.type === "DataTable");

    expect(referenceKeyOf(parseReferenceValue(table?.props.rows))).toBe(ReferenceExpressionKey.Csv);
    expect(table?.props.columns).toBeUndefined();
  });

  // THE ONE THE OLD HARNESS COULD NOT EXPRESS. The vendored grammar took
  // groupBy="hour|day|week" and had no `match`, so a ten-minute error-rate chart
  // was unaskable and the model rationally bypassed the reference. It is askable
  // now, and this is the shipped compiler saying so.
  test("<LogStream match groupBy='10m'> becomes a Chart carrying an aggregating $log", () => {
    const renderable = renderableSpecOf({
      armId: ArmId.ParchmentMarkupHigh,
      markup: `<LogStream file="logs/app.log" match="ERROR" groupBy="10m" kind="bar" />`,
    });

    expect(renderable.issues).toEqual([]);
    const chart = acceptedElementsOf(renderable).find((element) => element.type === "Chart");
    const reference = parseReferenceValue(chart?.props.data);

    expect(referenceKeyOf(reference)).toBe(ReferenceExpressionKey.Log);
    expect(reference?.groupBy).toBe("10m");
    expect(reference?.match).toBe("ERROR");
    // The daemon supplies the axes, because only the daemon has read the file.
    expect(chart?.props.x).toBeUndefined();
    expect(chart?.props.y).toBeUndefined();
  });

  test("a <LogStream> that aggregates without a bucket is rejected, not silently tailed", () => {
    const renderable = renderableSpecOf({
      armId: ArmId.ParchmentMarkupHigh,
      markup: `<LogStream file="logs/app.log" match="ERROR" />`,
    });

    expect(renderable.spec).toBeNull();
    expect(renderable.issues.join(" ")).toContain("groupBy");
  });
});

describe("stock behaviour: no more permissive than the real product", () => {
  // If this test ever goes green-by-passing, the eval is rigged: a spec the
  // product would refuse must be refused here too.
  test("an unknown component type is REJECTED, exactly as production rejects it", () => {
    const renderable = renderableSpecOf({
      armId: ArmId.ParchmentJsonHigh,
      spec: {
        root: "a",
        elements: { a: { type: "TotallyMadeUpComponent", props: {}, children: [] } },
      },
    });

    expect(renderable.spec).toBeNull();
    expect(renderable.issues.join(" ")).toContain("unknown component type");
  });

  test("a component missing a required prop is REJECTED", () => {
    // Chart with no data and no kind is an empty box, and production says so.
    const renderable = renderableSpecOf({
      armId: ArmId.ParchmentJsonHigh,
      spec: { root: "c", elements: { c: { type: "Chart", props: {}, children: [] } } },
    });

    expect(renderable.spec).toBeNull();
    expect(renderable.issues.length).toBeGreaterThan(0);
  });

  test("the rejection is phrased in the product's own words", () => {
    const rejection = formatSpecRejection(['elements/a: unknown component type "Foo"']);

    expect(rejection).toBe(
      'spec rejected (1 issue):\n- elements/a: unknown component type "Foo"\n' +
        "Fix these exact issues and re-push with the same slotId.",
    );
  });

  test("the plural is right, because a sloppy harness message reads as a sloppy product", () => {
    expect(formatSpecRejection(["one", "two"])).toContain("spec rejected (2 issues):");
  });
});

// ---- The spec arms reach the same rung by the same grammar ---------------------
//
// A JSON arm cannot author <GitDiff> — no such component exists in the spec
// grammar. It authors the expression itself, and the validator must accept it with
// the heavy props absent, or the arm loses a run it never had a chance at.

describe("a JSON arm authors the reference expressions directly", () => {
  test("a $csv in DataTable.rows validates with no columns — the daemon supplies them", () => {
    const renderable = renderableSpecOf({
      armId: ArmId.ParchmentJsonHigh,
      spec: {
        root: "t",
        elements: {
          t: { type: "DataTable", props: { rows: { $csv: "data/results.csv" } }, children: [] },
        },
      },
    });

    expect(renderable.issues).toEqual([]);
    expect(renderable.spec).not.toBeNull();
  });

  test("an element-level $diff on a DiffViewer validates with no before/after", () => {
    const renderable = renderableSpecOf({
      armId: ArmId.ParchmentJsonHigh,
      spec: {
        root: "d",
        elements: {
          d: {
            type: "DiffViewer",
            props: { $diff: GIT_DIFF_FIXTURE, base: "HEAD~1" },
            children: [],
          },
        },
      },
    });

    expect(renderable.issues).toEqual([]);
    expect(renderable.spec).not.toBeNull();
  });
});

describe("the document must be unambiguous", () => {
  test("neither markup nor spec is an issue, not a crash", () => {
    const renderable = renderableSpecOf({ armId: ArmId.ParchmentMarkupHigh });

    expect(renderable.spec).toBeNull();
    expect(renderable.issues.join(" ")).toContain("neither");
  });

  test("both markup and spec is an issue: the harness never guesses which one the model meant", () => {
    const renderable = renderableSpecOf({
      armId: ArmId.ParchmentMarkupHigh,
      markup: "<section>hi</section>",
      spec: { root: "a", elements: {} },
    });

    expect(renderable.spec).toBeNull();
    expect(renderable.issues.join(" ")).toContain("both");
  });
});

describe("the terse arm", () => {
  // The terse arm is the one most likely to BEAT parchment on density. A harness
  // bug that broke it would be a FAKE WIN for us, so its decode is pinned here.
  test("all six structural keys expand (r, e, t, p, c, s)", () => {
    const terse = JSON.stringify({
      r: "card",
      e: {
        card: { t: "Card", p: { title: "Latency" }, c: ["h"] },
        h: { t: "Heading", p: { text: "Error budget" } },
      },
      s: { seeded: true },
    });

    const renderable = renderableSpecOf({ armId: ArmId.TerseJson, spec: JSON.parse(terse) });

    expect(renderable.issues).toEqual([]);
    expect(renderable.spec?.root).toBe("card");
    expect(renderable.spec?.elements.card?.type).toBe("Card");
    expect(renderable.spec?.elements.card?.children).toEqual(["h"]);
    expect(renderable.spec?.elements.h?.props.text).toBe("Error budget");
    expect(renderable.spec?.state).toEqual({ seeded: true });
  });

  // The bug this pins: a recursive key-rewrite would reach into the DATA and
  // rename a row's "t" key to "type", and the chart would plot nothing.
  test("expansion never reaches inside props or data", () => {
    const terse = {
      r: "chart",
      e: {
        chart: {
          t: "Chart",
          p: {
            kind: "line",
            x: "t",
            y: "c",
            data: [
              { t: "09:00", c: 3, p: 1 },
              { t: "09:10", c: 5, p: 2 },
            ],
          },
        },
      },
    };

    const renderable = renderableSpecOf({ armId: ArmId.TerseJson, spec: terse });

    expect(renderable.issues).toEqual([]);
    const chart = renderable.spec?.elements.chart;
    expect(chart?.props.x).toBe("t");
    expect(chart?.props.data).toEqual([
      { t: "09:00", c: 3, p: 1 },
      { t: "09:10", c: 5, p: 2 },
    ]);
  });
});
