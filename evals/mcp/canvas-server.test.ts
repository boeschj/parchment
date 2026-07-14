// The eval's canvas server is the one component that could rig the benchmark
// without anybody noticing: it is OUR server, serving OUR arms, and every
// temptation runs in the direction of being kinder to a parchment document than
// the real product would be.
//
// So these tests pin the two properties that keep it honest:
//   1. It ADDS exactly two things (markup, reference tags) — the unmerged
//      features under test.
//   2. It is otherwise NO MORE PERMISSIVE than production. A genuinely invalid
//      spec is rejected, in the product's own words.

import { describe, expect, test } from "bun:test";
import { FIXTURE_FACTS } from "../fixtures/index.ts";
import { ArmId } from "../types.ts";
import { buildRenderableSpec, formatSpecRejection } from "./canvas-server.ts";

const GIT_DIFF_FIXTURE = "repo/src/server.ts";

// Fails the test loudly instead of asserting non-null: a null spec here means the
// server rejected a document it should have accepted, and that is the finding.
function acceptedElementsOf(renderable: ReturnType<typeof buildRenderableSpec>) {
  if (renderable.spec === null) {
    throw new Error(`expected an accepted spec, got issues: ${renderable.issues.join("; ")}`);
  }
  return Object.values(renderable.spec.elements);
}

describe("previewed feature 1: markup", () => {
  test("a markup document compiles to a valid spec", () => {
    const renderable = buildRenderableSpec({
      armId: ArmId.ParchmentMarkupHigh,
      markup: "<section><h1>Latency</h1><p>All good.</p></section>",
    });

    expect(renderable.issues).toEqual([]);
    expect(renderable.spec).not.toBeNull();
  });

  test("a markup document the compiler rejects comes back as the compiler's issues", () => {
    const renderable = buildRenderableSpec({
      armId: ArmId.ParchmentMarkupHigh,
      markup: "<section><Nonsense foo='1' /></section>",
    });

    expect(renderable.spec).toBeNull();
    expect(renderable.issues.length).toBeGreaterThan(0);
    expect(renderable.issues.join(" ")).toContain("unknown tag");
  });
});

describe("previewed feature 2: reference tags hydrate from disk", () => {
  test("<GitDiff> becomes a DiffViewer carrying both real sides of the diff", () => {
    const renderable = buildRenderableSpec({
      armId: ArmId.ParchmentMarkupHigh,
      markup: `<GitDiff file="${GIT_DIFF_FIXTURE}" base="HEAD~1" />`,
    });

    expect(renderable.issues).toEqual([]);
    const diffViewer = acceptedElementsOf(renderable).find((element) => element.type === "DiffViewer");

    expect(diffViewer).toBeDefined();
    expect(String(diffViewer?.props.after)).toContain(FIXTURE_FACTS.gitDiff.addedCodeLine);
    expect(String(diffViewer?.props.before)).toContain(FIXTURE_FACTS.gitDiff.removedCodeLine);
  });

  test("<DataTable src> becomes real columns and every row of the CSV", () => {
    const renderable = buildRenderableSpec({
      armId: ArmId.ParchmentMarkupHigh,
      markup: `<DataTable src="data/results.csv" />`,
    });

    expect(renderable.issues).toEqual([]);
    const table = acceptedElementsOf(renderable).find((element) => element.type === "DataTable");
    const rows = table?.props.rows;

    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(FIXTURE_FACTS.csv.dataRowCount);
  });

  test("<LogStream> becomes a Chart with the fixture's hand-counted error buckets", () => {
    const renderable = buildRenderableSpec({
      armId: ArmId.ParchmentMarkupHigh,
      markup: `<LogStream file="logs/app.log" watch />`,
    });

    expect(renderable.issues).toEqual([]);
    const chart = acceptedElementsOf(renderable).find((element) => element.type === "Chart");

    expect(chart?.props.data).toEqual([...FIXTURE_FACTS.log.errorsByTenMinuteBucket]);
  });

  test("a reference escaping the fixture root is an issue, and nothing is read", () => {
    const renderable = buildRenderableSpec({
      armId: ArmId.ParchmentMarkupHigh,
      markup: `<DataTable src="../../package.json" />`,
    });

    expect(renderable.spec).toBeNull();
    expect(renderable.issues.join(" ")).toContain("resolves outside");
  });
});

describe("stock behaviour: no more permissive than the real product", () => {
  // If this test ever goes green-by-passing, the eval is rigged: a spec the
  // product would refuse must be refused here too.
  test("an unknown component type is REJECTED, exactly as production rejects it", () => {
    const renderable = buildRenderableSpec({
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
    const renderable = buildRenderableSpec({
      armId: ArmId.ParchmentJsonHigh,
      spec: { root: "c", elements: { c: { type: "Chart", props: {}, children: [] } } },
    });

    expect(renderable.spec).toBeNull();
    expect(renderable.issues.length).toBeGreaterThan(0);
  });

  test("the rejection is phrased in the product's own words", () => {
    const rejection = formatSpecRejection(["elements/a: unknown component type \"Foo\""]);

    expect(rejection).toBe(
      'spec rejected (1 issue):\n- elements/a: unknown component type "Foo"\n' +
        "Fix these exact issues and re-push with the same slotId.",
    );
  });

  test("the plural is right, because a sloppy harness message reads as a sloppy product", () => {
    expect(formatSpecRejection(["one", "two"])).toContain("spec rejected (2 issues):");
  });
});

describe("the document must be unambiguous", () => {
  test("neither markup nor spec is an issue, not a crash", () => {
    const renderable = buildRenderableSpec({ armId: ArmId.ParchmentMarkupHigh });

    expect(renderable.spec).toBeNull();
    expect(renderable.issues.join(" ")).toContain("neither");
  });

  test("both markup and spec is an issue: the harness never guesses which one the model meant", () => {
    const renderable = buildRenderableSpec({
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

    const renderable = buildRenderableSpec({ armId: ArmId.TerseJson, spec: JSON.parse(terse) });

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

    const renderable = buildRenderableSpec({ armId: ArmId.TerseJson, spec: terse });

    expect(renderable.issues).toEqual([]);
    const chart = renderable.spec?.elements.chart;
    expect(chart?.props.x).toBe("t");
    expect(chart?.props.data).toEqual([
      { t: "09:00", c: 3, p: 1 },
      { t: "09:10", c: 5, p: 2 },
    ]);
  });
});
