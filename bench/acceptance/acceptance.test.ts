// Tests for the rubric itself.
//
// A rubric nobody has tried to fool is not a rubric. Each fixture below is an
// artifact engineered to slip past a weaker check — the type-counting validator
// this harness replaces would have PASSED most of them — and each test asserts
// the rubric catches it, and names the right reason.
//
// These run against real headless Chromium over file:// fixtures. The parchment
// arm is exercised the same way (same specs, same assertions) by
// bench/acceptance/replay.ts, which needs a live daemon and so is a script
// rather than a unit test.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { acceptArtifact, createAcceptanceBrowser, type AcceptanceBrowser } from "./index.ts";
import { ArtifactKind } from "./types.ts";

const FIXTURES_DIR = join(import.meta.dir, "fixtures");
const SCREENSHOT_DIR = join(import.meta.dir, "..", ".runs", "acceptance-tests");

let browser: AcceptanceBrowser;

beforeAll(async () => {
  browser = await createAcceptanceBrowser();
});

afterAll(async () => {
  await browser.close();
});

async function judge(scenarioId: string, fixture: string) {
  return acceptArtifact({
    scenarioId,
    artifact: { kind: ArtifactKind.HtmlFile, filePath: join(FIXTURES_DIR, fixture) },
    screenshotPath: join(SCREENSHOT_DIR, `${scenarioId}-${fixture}.png`),
    browser,
  });
}

function reasonsText(reasons: string[]): string {
  return reasons.join(" | ").toLowerCase();
}

describe("status-dashboard rubric", () => {
  test("passes a dashboard whose charts actually plot the data", async () => {
    const result = await judge("status-dashboard", "good-dashboard.html");
    expect(result.reasons).toEqual([]);
    expect(result.passed).toBe(true);
  });

  test("catches charts that rendered axes and labels but zero data points", async () => {
    const result = await judge("status-dashboard", "chart-with-no-data.html");
    expect(result.passed).toBe(false);
    expect(reasonsText(result.reasons)).toContain("chart");
    // The failure must be about missing DATA, not about a missing chart element:
    // the page has two <svg>s with all seven day labels.
    expect(reasonsText(result.reasons)).toContain("data points");
  });

  test("catches a page that threw while rendering", async () => {
    const result = await judge("status-dashboard", "broken-dashboard.html");
    expect(result.passed).toBe(false);
    expect(reasonsText(result.reasons)).toContain("console error");
    expect(reasonsText(result.reasons)).toContain("something went wrong");
  });

  test("records the evidence behind its verdict", async () => {
    const result = await judge("status-dashboard", "good-dashboard.html");
    expect(result.domFacts.svgs).toHaveLength(2);
    // 7 bars and a 7-vertex polyline: both encodings read as 7 data points.
    expect(result.domFacts.svgs.map((svg) => svg.dataPointCount)).toEqual([7, 7]);
    expect(result.domFacts.consoleErrors).toEqual([]);
    expect(result.screenshotPath).toContain(".png");
  });
});

describe("csv-data-table rubric", () => {
  test("passes a table holding every CSV row", async () => {
    const result = await judge("csv-data-table", "good-table.html");
    expect(result.reasons).toEqual([]);
    expect(result.passed).toBe(true);
  });

  test("catches a table missing rows, even when the names appear in prose", async () => {
    const result = await judge("csv-data-table", "table-missing-rows.html");
    expect(result.passed).toBe(false);
    const reasons = reasonsText(result.reasons);
    expect(reasons).toContain("alan turing");
    expect(reasons).toContain("margaret hamilton");
    // Ada and Grace ARE in the table, so they must not be reported missing.
    expect(reasons).not.toContain("ada lovelace");
    expect(result.domFacts.tables[0]?.dataRowCount).toBe(2);
  });
});

describe("architecture-diagram rubric", () => {
  test("passes a diagram with all three nodes connected", async () => {
    const result = await judge("architecture-diagram", "good-diagram.html");
    expect(result.reasons).toEqual([]);
    expect(result.passed).toBe(true);
  });

  test("catches labelled nodes that were never connected", async () => {
    const result = await judge("architecture-diagram", "diagram-unconnected.html");
    expect(result.passed).toBe(false);
    expect(reasonsText(result.reasons)).toContain("not connected");
  });
});

describe("validated-form rubric", () => {
  test("passes a form that refuses an empty name and a 3-character password", async () => {
    const result = await judge("validated-form", "good-form.html");
    expect(result.reasons).toEqual([]);
    expect(result.passed).toBe(true);
    // Every corrupted field was refused natively.
    expect(result.domFacts.formValidation?.fields.every((field) => field.nativeInvalid)).toBe(true);
  });

  test("catches a structurally perfect form that validates nothing", async () => {
    const result = await judge("validated-form", "form-without-validation.html");
    expect(result.passed).toBe(false);

    const reasons = reasonsText(result.reasons);
    // The structural half passes — all three fields, right types, right button —
    // so the ONLY failure may be the behavioural one.
    expect(reasons).toContain("accepted invalid input");
    expect(reasons).toContain("name");
    expect(reasons).toContain("password");
    // type="email" makes the browser refuse "not-an-email" all by itself, so a
    // page-wide "did anything get refused?" check would have passed this page.
    // The email field must NOT be listed among the accepted ones.
    const emailField = result.domFacts.formValidation?.fields.find((field) => field.label === "email");
    expect(emailField?.nativeInvalid).toBe(true);
  });
});
