// THE RUBRIC. One acceptance spec per scenario, expressed purely as facts that
// must be TRUE IN THE DOM of the painted page. Applied byte-identically to every
// arm: parchment, static HTML, live HTML, or anything else a future arm brings.
//
// Read these as the answer to "what does correct mean?". Every value asserted
// below is data the scenario PROMPT gave the model. Nothing here mentions a
// component name, a prop, a schema, or a spec format — an assertion that could
// only be satisfied by parchment (or only by HTML) would be a rubric artifact,
// and the previous harness died of exactly that.
//
// Thresholds are calibrated against measured renders of known-good and
// known-broken artifacts on BOTH arms, not guessed. See bench/acceptance/
// README-CALIBRATION section in docs/benchmarks.md for the observed numbers.
//
// PROMPT CONTRACT: chart scenarios require the model to draw with inline <svg>.
// A chart rasterized into a bitmap <canvas> cannot have its data points verified
// by any DOM rubric — nor read by find-in-page or a screen reader — so both arms
// are told to use <svg>, and a run that ignores that fails with the reason
// printed (see bitmapChartNote in checks.ts).

import { AssertionKind, type AcceptanceSpec } from "./types.ts";

// Every scenario must clear this floor: the page painted something, it did not
// log an error, and it did not render an error boundary.
//
// ContentNonEmpty is a BLANK-PAGE GUARD, not a content-richness test — the
// scenario-specific assertions below do the real work. Its threshold is set
// below the least-texty CORRECT artifact and above the textiest BLANK one,
// both measured, rather than tuned to make any particular run pass:
//   correct 3-node architecture diagram … 39 characters  (the sparsest correct artifact)
//   correct dashboard / table / report …  140+ characters
//   a chart whose data was empty ……………… 19 characters  (its title, nothing else)
//   a page that threw before painting ……… 0 characters
const RENDERED_AT_ALL = [
  { kind: AssertionKind.ContentNonEmpty, minVisibleTextLength: 25, minContentHeightPx: 200 },
  { kind: AssertionKind.NoConsoleErrors },
  { kind: AssertionKind.NoErrorBoundary },
] as const;

// The 7-day series both charts plot. Named once: the assertions below must use
// the same values the prompt hands the model, or the rubric is testing
// something the model was never asked to do.
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// A 7-point series that painted >= 5 points is unambiguously plotted; an empty
// chart paints 0-1 (measured: a chart with `data: []` paints exactly 1 mark and
// zero axis labels, and today's spec validation accepts it without complaint).
const MIN_DATA_POINTS_IN_A_7_POINT_SERIES = 5;

export const statusDashboardAcceptance: AcceptanceSpec = {
  scenarioId: "status-dashboard",
  title: "CI status dashboard (KPI row + 2 charts)",
  assertions: [
    ...RENDERED_AT_ALL,
    {
      kind: AssertionKind.TextPresent,
      description: "the 3 KPI tiles show their label and value",
      // Each label is paired with its value in one string, so the assertion
      // cannot be satisfied by a stray digit elsewhere on the page.
      values: ["Build Pass Rate 94%", "Avg Build Time 4m12s", "Open Incidents 2"],
    },
    {
      kind: AssertionKind.Charts,
      description: "both charts plot their 7-day series and label the days",
      minCharts: 2,
      minDataPointsPerChart: MIN_DATA_POINTS_IN_A_7_POINT_SERIES,
      requiredAxisLabels: WEEKDAYS,
    },
  ],
};

export const csvDataTableAcceptance: AcceptanceSpec = {
  scenarioId: "csv-data-table",
  title: "Data table from a CSV snippet",
  assertions: [
    ...RENDERED_AT_ALL,
    {
      kind: AssertionKind.TableRows,
      description: "every CSV row is rendered as a table row with all its values",
      minDataRows: 4,
      // Co-occurrence within ONE <tr>: a page that lists the names in one place
      // and the ticket counts in another has not rendered the CSV.
      requiredRows: [
        ["Ada Lovelace", "Engineer", "42"],
        ["Grace Hopper", "Engineer", "58"],
        ["Alan Turing", "Lead", "31"],
        ["Margaret Hamilton", "Manager", "19"],
      ],
    },
  ],
};

export const architectureDiagramAcceptance: AcceptanceSpec = {
  scenarioId: "architecture-diagram",
  title: "Architecture diagram (3-tier system)",
  assertions: [
    ...RENDERED_AT_ALL,
    {
      kind: AssertionKind.DiagramSvg,
      description: "one svg diagram carries all 3 node labels and connects them",
      requiredNodeLabels: ["Client", "API", "Database"],
      // Client→API and API→Database. Mermaid draws edges as <path>; a
      // hand-written diagram draws them as <line>/<path>/<polyline>. Both count.
      minConnectorMarks: 2,
    },
  ],
};

export const incidentReportAcceptance: AcceptanceSpec = {
  scenarioId: "incident-report",
  title: "Incident postmortem report",
  assertions: [
    ...RENDERED_AT_ALL,
    {
      kind: AssertionKind.TextPresent,
      description: "the verdict, the root cause, and every timeline timestamp are rendered",
      values: [
        "Checkout API returned 500s",
        "connection pool",
        "14:02",
        "14:10",
        "14:12",
        "14:14",
      ],
    },
  ],
};

export const validatedFormAcceptance: AcceptanceSpec = {
  scenarioId: "validated-form",
  title: "Signup form with validation + submit",
  assertions: [
    ...RENDERED_AT_ALL,
    {
      kind: AssertionKind.FormInputs,
      description: "the form has the 3 fields with the right input types and a submit button",
      // `type` only. NOT `required`/`minlength`: those are one technology's way
      // of expressing validation, and asserting them would fail parchment for a
      // rubric artifact rather than a real defect (parchment's Input validates
      // via a `checks` prop and does not accept `required`). The behavioural
      // assertion below is what actually holds both arms to the requirement.
      requiredInputs: [
        { label: "name", type: "text" },
        { label: "email", type: "email" },
        { label: "password", type: "password" },
      ],
      submitButtonText: "Sign up",
    },
    {
      kind: AssertionKind.FormValidation,
      description: "the form refuses an empty name and a 3-character password",
      invalidFills: [
        { label: "name", value: "" },
        { label: "email", value: "not-an-email" },
        { label: "password", value: "abc" },
      ],
      submitButtonText: "Sign up",
    },
  ],
};

export const liveLogDashboardAcceptance: AcceptanceSpec = {
  scenarioId: "live-log-dashboard",
  title: "Live log dashboard (setup half of tokens-per-update)",
  assertions: [
    ...RENDERED_AT_ALL,
    {
      kind: AssertionKind.Charts,
      description: "the error-rate chart plots its 5 seeded points",
      minCharts: 1,
      // The prompt seeds exactly 5 points (2, 3, 1, 4, 2), so all 5 must land.
      minDataPointsPerChart: 5,
      // The prompt names no x-axis categories, so requiring specific tick labels
      // would invent a requirement the model was never given. The >=2 text-label
      // floor inside isDataChart still holds (a chart must paint SOME axis), and
      // the table assertion below carries the data verification for this
      // scenario.
      requiredAxisLabels: [],
    },
    {
      kind: AssertionKind.TableRows,
      description: "all 3 seeded log lines are rendered as table rows",
      minDataRows: 3,
      // Level and message may be one cell or two, and a page may drop the
      // brackets — both are presentation. What must be true is that the level
      // and its message land in the SAME row.
      requiredRows: [
        ["ERROR", "db timeout"],
        ["WARN", "slow query 800ms"],
        ["INFO", "cache cleared"],
      ],
    },
  ],
};

export const ACCEPTANCE_SPECS = [
  statusDashboardAcceptance,
  csvDataTableAcceptance,
  architectureDiagramAcceptance,
  incidentReportAcceptance,
  validatedFormAcceptance,
  liveLogDashboardAcceptance,
] as const;

export function acceptanceSpecFor(scenarioId: string): AcceptanceSpec {
  const spec = ACCEPTANCE_SPECS.find((candidate) => candidate.scenarioId === scenarioId);
  if (!spec) {
    const known = ACCEPTANCE_SPECS.map((candidate) => candidate.scenarioId).join(", ");
    throw new Error(`no acceptance spec for scenario "${scenarioId}". Known scenarios: ${known}`);
  }
  return spec;
}
