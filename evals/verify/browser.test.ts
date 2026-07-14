// The browser path, exercised against real headless Chromium and real files on
// disk. checks.test.ts proves the rubric judges DomFacts correctly; this proves
// the DomFacts we hand it are the ones a browser actually painted — including
// the two things the in-page probe structurally cannot see (console errors and
// uncaught exceptions), and the one thing we must never score (a missing
// content root).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ArtifactKind, AssertionKind, type AcceptanceSpec, type Artifact } from "../../bench/acceptance/types.ts";
import { closeBrowser, probeArtifact } from "./browser.ts";
import { checkAcceptance } from "./index.ts";

const BROWSER_TEST_TIMEOUT_MS = 60_000;
const BAR_COUNT = 7;
const DATA_ROW_COUNT = 3;
const MIN_VISIBLE_TEXT_CHARS = 60;
const MIN_CONTENT_HEIGHT_PX = 200;

const TEMP_ROOT = join(import.meta.dir, ".tmp");

let runDir = "";
let screenshotDir = "";

beforeAll(() => {
  mkdirSync(TEMP_ROOT, { recursive: true });
  runDir = mkdtempSync(join(TEMP_ROOT, "run-"));
  screenshotDir = join(runDir, "screenshots");
});

afterAll(async () => {
  await closeBrowser();
  rmSync(runDir, { recursive: true, force: true });
});

describe("probeArtifact", () => {
  test(
    "reduces a real painted page to the facts the rubric scores",
    async () => {
      const artifact = writeHtmlArtifact("dashboard.html", DASHBOARD_HTML);

      const { facts, screenshotPath } = await probeArtifact(artifact, {
        screenshotDir,
        screenshotName: "dashboard",
      });

      const [chart] = facts.svgs;
      expect(facts.svgs).toHaveLength(1);
      expect(chart?.dataPointCount).toBe(BAR_COUNT);
      expect(chart?.markCountsByTag.rect).toBe(BAR_COUNT);
      expect(chart?.textLabels).toContain("Revenue");
      expect(chart?.heightPx).toBeGreaterThan(0);

      const [table] = facts.tables;
      expect(facts.tables).toHaveLength(1);
      expect(table?.dataRowCount).toBe(DATA_ROW_COUNT);
      expect(table?.headerCells).toEqual(["Name", "Deals"]);
      expect(table?.rows).toContainEqual(["Ada Lovelace", "42"]);
      expect(table?.rows).toContainEqual(["Grace Hopper", "37"]);

      expect(facts.visibleText).toContain("Ada Lovelace");
      expect(facts.contentHeightPx).toBeGreaterThan(0);
      expect(facts.consoleErrors).toEqual([]);
      expect(facts.errorBoundaryTexts).toEqual([]);

      expect(statSync(screenshotPath).size).toBeGreaterThan(0);
    },
    BROWSER_TEST_TIMEOUT_MS,
  );

  test(
    "collects console errors and uncaught exceptions, which the DOM never shows",
    async () => {
      const artifact = writeHtmlArtifact("crashing.html", CRASHING_HTML);

      const { facts } = await probeArtifact(artifact, { screenshotDir, screenshotName: "crashing" });

      expect(facts.consoleErrors).toContain("boom: could not load the report");
      expect(facts.consoleErrors.some((error) => error.includes("uncaught: kaboom"))).toBe(true);
    },
    BROWSER_TEST_TIMEOUT_MS,
  );

  test(
    "throws rather than scoring a page whose content root is missing",
    async () => {
      const dashboard = writeHtmlArtifact("dashboard.html", DASHBOARD_HTML);
      // The same painted page, addressed as a parchment canvas: its content root
      // is the slot section, which a plain HTML file does not have. A missing
      // root must never reduce to empty facts and quietly pass.
      const canvasWithoutSlot: Artifact = {
        kind: ArtifactKind.ParchmentCanvas,
        canvasUrl: pathToFileURL(dashboard.filePath).href,
      };

      const probe = probeArtifact(canvasWithoutSlot, { screenshotDir, screenshotName: "missing-root" });

      await expect(probe).rejects.toThrow(/content root "section\.scroll-fade-top" was never found/);
    },
    BROWSER_TEST_TIMEOUT_MS,
  );
});

describe("checkAcceptance", () => {
  test(
    "passes a page that really painted the data",
    async () => {
      const artifact = writeHtmlArtifact("dashboard.html", DASHBOARD_HTML);

      const result = await checkAcceptance(artifact, dashboardSpec(), { screenshotDir });

      expect(result.reasons).toEqual([]);
      expect(result.passed).toBe(true);
      expect(result.scenarioId).toBe("q3-dashboard");
      expect(result.domFacts.svgs[0]?.dataPointCount).toBe(BAR_COUNT);
      expect(statSync(result.screenshotPath).size).toBeGreaterThan(0);
    },
    BROWSER_TEST_TIMEOUT_MS,
  );

  test(
    "fails the same rubric when the chart is drawn but never plotted",
    async () => {
      const artifact = writeHtmlArtifact("empty-chart.html", EMPTY_CHART_HTML);

      const result = await checkAcceptance(artifact, dashboardSpec(), { screenshotDir });

      expect(result.passed).toBe(false);
      const chartReason = result.reasons.find((reason) => reason.startsWith("charts"));
      expect(chartReason).toContain("expected >=1 chart(s) with >=7 data points");
      expect(chartReason).toContain("dataPointCounts [2]");
    },
    BROWSER_TEST_TIMEOUT_MS,
  );
});

function dashboardSpec(): AcceptanceSpec {
  return {
    scenarioId: "q3-dashboard",
    title: "Q3 revenue dashboard",
    assertions: [
      {
        kind: AssertionKind.ContentNonEmpty,
        minVisibleTextLength: MIN_VISIBLE_TEXT_CHARS,
        minContentHeightPx: MIN_CONTENT_HEIGHT_PX,
      },
      { kind: AssertionKind.NoConsoleErrors },
      { kind: AssertionKind.NoErrorBoundary },
      { kind: AssertionKind.TextPresent, description: "top reps", values: ["Ada Lovelace", "Grace Hopper"] },
      {
        kind: AssertionKind.TableRows,
        description: "rep leaderboard",
        minDataRows: DATA_ROW_COUNT,
        requiredRows: [
          ["Ada Lovelace", "42"],
          ["Grace Hopper", "37"],
        ],
      },
      {
        kind: AssertionKind.Charts,
        description: "monthly revenue",
        minCharts: 1,
        minDataPointsPerChart: BAR_COUNT,
        requiredAxisLabels: ["Revenue", "Jan"],
      },
    ],
  };
}

function writeHtmlArtifact(fileName: string, html: string): Artifact {
  const filePath = join(runDir, fileName);
  writeFileSync(filePath, html);
  return { kind: ArtifactKind.HtmlFile, filePath };
}

const DASHBOARD_HTML = `<!doctype html>
<meta charset="utf-8">
<title>Q3 Revenue</title>
<body style="font-family: sans-serif; padding: 24px;">
  <h1>Q3 Revenue Dashboard</h1>
  <p>Monthly revenue across the quarter, and the three reps who closed the most deals.</p>
  <table>
    <thead><tr><th>Name</th><th>Deals</th></tr></thead>
    <tbody>
      <tr><td>Ada Lovelace</td><td>42</td></tr>
      <tr><td>Grace Hopper</td><td>37</td></tr>
      <tr><td>Alan Turing</td><td>31</td></tr>
    </tbody>
  </table>
  <svg width="420" height="220" role="img">
    <path d="M 40 10 L 40 190" stroke="#888" fill="none"/>
    <path d="M 40 190 L 400 190" stroke="#888" fill="none"/>
    <rect x="55" y="120" width="30" height="70" fill="#4c78a8"/>
    <rect x="105" y="90" width="30" height="100" fill="#4c78a8"/>
    <rect x="155" y="140" width="30" height="50" fill="#4c78a8"/>
    <rect x="205" y="60" width="30" height="130" fill="#4c78a8"/>
    <rect x="255" y="100" width="30" height="90" fill="#4c78a8"/>
    <rect x="305" y="40" width="30" height="150" fill="#4c78a8"/>
    <rect x="355" y="80" width="30" height="110" fill="#4c78a8"/>
    <text x="55" y="205" font-size="10">Jan</text>
    <text x="205" y="205" font-size="10">Apr</text>
    <text x="355" y="205" font-size="10">Jul</text>
    <text x="10" y="100" font-size="10">Revenue</text>
  </svg>
</body>`;

// Axes drawn, nothing plotted: the two axis paths are 2 vertices each, so the
// probe scores this chart at 2 data points. This is the empty chart that a spec
// validator happily calls valid.
const EMPTY_CHART_HTML = `<!doctype html>
<meta charset="utf-8">
<title>Q3 Revenue</title>
<body style="font-family: sans-serif; padding: 24px;">
  <h1>Q3 Revenue Dashboard</h1>
  <p>Monthly revenue across the quarter, and the three reps who closed the most deals.</p>
  <table>
    <thead><tr><th>Name</th><th>Deals</th></tr></thead>
    <tbody>
      <tr><td>Ada Lovelace</td><td>42</td></tr>
      <tr><td>Grace Hopper</td><td>37</td></tr>
      <tr><td>Alan Turing</td><td>31</td></tr>
    </tbody>
  </table>
  <svg width="420" height="220" role="img">
    <path d="M 40 10 L 40 190" stroke="#888" fill="none"/>
    <path d="M 40 190 L 400 190" stroke="#888" fill="none"/>
    <text x="55" y="205" font-size="10">Jan</text>
    <text x="10" y="100" font-size="10">Revenue</text>
  </svg>
</body>`;

const CRASHING_HTML = `<!doctype html>
<meta charset="utf-8">
<title>Report</title>
<body>
  <h1>Quarterly report</h1>
  <script>
    console.error("boom: could not load the report");
    throw new Error("kaboom");
  </script>
</body>`;
