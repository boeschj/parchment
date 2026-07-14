// The six original bench scenarios, ported to the eval's arm-agnostic form.
//
// These are the LOW-fidelity baseline the ladder is measured against: every one
// of them PASTES its source data into the prompt, because none of them has
// anywhere else to get it from. That is the point of keeping them.
//
// The old suite asked each arm a DIFFERENT question — a `parchmentPrompt` that
// named canvas_render and its component vocabulary, an `htmlPrompt` that named a
// file path and told the model to draw with inline <svg>. That asymmetry is what
// this rebuild eliminates: the task is stated once, in plain language, and the
// arm's encodeTask is the only thing that knows what an arm is. The DATA is
// carried across verbatim, so the numbers stay comparable to the old suite.
//
// THE RUBRIC IS THE POINT. The old requirement was a type count — "the spec
// contains a DataTable", "the spec contains 2 Charts" — which a Chart holding an
// EMPTY data array satisfies, and did; the published results had to be retracted.
// Every assertion below names a value the PROMPT handed the model and demands it
// in the painted DOM: chart floors equal the real number of points in the source
// series (an empty chart paints 0-2 axis marks and fails), table cells must
// CO-OCCUR in one <tr> (a page that prints the names in one place and the counts
// in another fails), and the form is judged on whether it actually REFUSES bad
// input rather than on the markup it carries.
//
// Every asserted value is derived from the same constant that builds the pasted
// data, so the rubric and the prompt cannot drift apart. ported.test.ts proves
// it: it traces every asserted value back into each scenario's own inlineData.

import { AssertionKind, type AcceptanceSpec } from "../../bench/acceptance/types.ts";
import type { EvalScenario, SourceFile } from "../types.ts";

export const PortedScenarioId = {
  StatusDashboard: "status-dashboard",
  CsvDataTable: "csv-data-table",
  ArchitectureDiagram: "architecture-diagram",
  IncidentReport: "incident-report",
  ValidatedForm: "validated-form",
  LiveLogDashboard: "live-log-dashboard",
} as const;

export type PortedScenarioId = (typeof PortedScenarioId)[keyof typeof PortedScenarioId];

// ---- Shared floors ----------------------------------------------------------

// A page that painted nothing is not a pass, however cleanly it painted nothing.
//
// The floor is lower than the ladder's 200 characters on purpose. The ladder
// hands the model a 50-row CSV and a 100-line log; these six hand it a handful of
// values, and the sparsest CORRECT artifact among them is the 3-node architecture
// diagram — measured at 39 non-whitespace characters. The floor sits between that
// and the artifacts that painted nothing (a chart with empty data paints its
// title, 19 characters; a page that threw paints 0). This is a blank-page guard
// and nothing more — the per-scenario data assertions carry the weight.
const NON_EMPTY_CONTENT = {
  kind: AssertionKind.ContentNonEmpty,
  minVisibleTextLength: 25,
  minContentHeightPx: 120,
} as const;

const CLEAN_RENDER = [
  { kind: AssertionKind.NoConsoleErrors },
  { kind: AssertionKind.NoErrorBoundary },
] as const;

// These six are the pasted-data baseline: nothing of theirs lives on disk, which
// is exactly the handicap the ladder scenarios exist to lift.
const NO_SOURCE_FILES: readonly SourceFile[] = [];

const LINE_BREAK = "\n";

// The data block is interpolated into the request AND published as `inlineData`
// from the same string, so what the rubric traces to is byte-for-byte what the
// model was handed.
function pasteIntoRequest(task: string, sourceData: string): string {
  return `${task}${LINE_BREAK}${LINE_BREAK}${sourceData}`;
}

function uniqueInOrder(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function quoteAll(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(", ");
}

// ---- 1. CI status dashboard: a KPI row and two 7-day charts ------------------
//
// The scenario the old rubric failed hardest on: "the spec contains 2 Charts" was
// satisfied by two charts with nothing plotted in them. Here the floor is one
// data mark per day in the series, and each KPI's label must be painted next to
// its value — the bare digit "2" would be satisfied by any page containing a 2.

const CI_KPIS = [
  { label: "Build Pass Rate", value: "94%" },
  { label: "Avg Build Time", value: "4m12s" },
  { label: "Open Incidents", value: "2" },
] as const;

// One row per day, so the day and its two values can never drift out of step.
// The values are the original prompt's series, in the original Mon-Sun order:
// build durations 12, 8, 15, 9, 20, 7, 11 and deploys 3, 5, 2, 6, 4, 7, 3.
export const CI_DAILY_METRICS = [
  { day: "Mon", buildMinutes: 12, deploys: 3 },
  { day: "Tue", buildMinutes: 8, deploys: 5 },
  { day: "Wed", buildMinutes: 15, deploys: 2 },
  { day: "Thu", buildMinutes: 9, deploys: 6 },
  { day: "Fri", buildMinutes: 20, deploys: 4 },
  { day: "Sat", buildMinutes: 7, deploys: 7 },
  { day: "Sun", buildMinutes: 11, deploys: 3 },
] as const;

type CiDailyMetric = (typeof CI_DAILY_METRICS)[number];

function describeSeries(name: string, readValue: (metric: CiDailyMetric) => number): string {
  const dayValuePairs = CI_DAILY_METRICS.map((metric) => `${metric.day} ${readValue(metric)}`);
  return `${name}: ${dayValuePairs.join(", ")}`;
}

const weekdayLabels = CI_DAILY_METRICS.map((metric) => metric.day);
const kpiLines = CI_KPIS.map((kpi) => `${kpi.label}: ${kpi.value}`);
const kpiLabelValuePairs = CI_KPIS.map((kpi) => `${kpi.label} ${kpi.value}`);

const STATUS_DASHBOARD_DATA = [
  ...kpiLines,
  "",
  describeSeries("Build duration in minutes", (metric) => metric.buildMinutes),
  describeSeries("Deploys", (metric) => metric.deploys),
].join(LINE_BREAK);

const statusDashboardAcceptance: AcceptanceSpec = {
  scenarioId: PortedScenarioId.StatusDashboard,
  title: "A KPI row and two 7-day charts, with the data actually plotted",
  assertions: [
    NON_EMPTY_CONTENT,
    ...CLEAN_RENDER,
    {
      kind: AssertionKind.TextPresent,
      description: "each KPI shows its label next to its value",
      values: kpiLabelValuePairs,
    },
    {
      kind: AssertionKind.Charts,
      description: "both charts plot all 7 days of their series and label the days",
      minCharts: 2,
      minDataPointsPerChart: CI_DAILY_METRICS.length,
      requiredAxisLabels: [...weekdayLabels],
    },
  ],
};

const statusDashboardTask = `Build a CI status dashboard. Show the three KPIs as a row of tiles, each with its label next to its value; a bar chart of the build duration for every one of the ${CI_DAILY_METRICS.length} days; and a line chart of the deploy count for the same ${CI_DAILY_METRICS.length} days. Label both charts' x-axis with the day names.`;

export const statusDashboardScenario: EvalScenario = {
  id: PortedScenarioId.StatusDashboard,
  title: "CI status dashboard (KPI row + 2 charts)",
  request: pasteIntoRequest(statusDashboardTask, STATUS_DASHBOARD_DATA),
  inlineData: STATUS_DASHBOARD_DATA,
  sourceFiles: NO_SOURCE_FILES,
  exercisesLadder: false,
  acceptance: statusDashboardAcceptance,
};

// ---- 2. A pasted CSV, as a data table ---------------------------------------

const CSV_DELIMITER = ",";

const CSV_HEADER_COLUMNS = ["name", "role", "tickets_closed"] as const;

const EMPLOYEES = [
  { name: "Ada Lovelace", role: "Engineer", ticketsClosed: 42 },
  { name: "Grace Hopper", role: "Engineer", ticketsClosed: 58 },
  { name: "Alan Turing", role: "Lead", ticketsClosed: 31 },
  { name: "Margaret Hamilton", role: "Manager", ticketsClosed: 19 },
] as const;

// One array, two consumers: the CSV the model is handed and the rows the rubric
// requires. Each row is checked for CO-OCCURRENCE within a single <tr>, so a page
// that prints the names in one place and the ticket counts in another fails.
const employeeCells = EMPLOYEES.map((employee) => [
  employee.name,
  employee.role,
  String(employee.ticketsClosed),
]);

function toCsv(headerColumns: readonly string[], rows: readonly string[][]): string {
  const headerLine = headerColumns.join(CSV_DELIMITER);
  const dataLines = rows.map((cells) => cells.join(CSV_DELIMITER));
  return [headerLine, ...dataLines].join(LINE_BREAK);
}

const CSV_DATA = toCsv(CSV_HEADER_COLUMNS, employeeCells);

const csvDataTableAcceptance: AcceptanceSpec = {
  scenarioId: PortedScenarioId.CsvDataTable,
  title: "Every row of the pasted CSV, rendered as a table row",
  assertions: [
    NON_EMPTY_CONTENT,
    ...CLEAN_RENDER,
    {
      kind: AssertionKind.TableRows,
      description: "every CSV row is rendered with its name, role and ticket count in one row",
      minDataRows: EMPLOYEES.length,
      requiredRows: employeeCells,
    },
    {
      kind: AssertionKind.TextPresent,
      description: "labels the columns",
      values: [...CSV_HEADER_COLUMNS],
    },
  ],
};

const csvDataTableTask = `Render this CSV as a sortable data table. Show every one of its ${EMPLOYEES.length} data rows, with a column for each of its ${CSV_HEADER_COLUMNS.length} columns.`;

export const csvDataTableScenario: EvalScenario = {
  id: PortedScenarioId.CsvDataTable,
  title: "Data table from a CSV snippet",
  request: pasteIntoRequest(csvDataTableTask, CSV_DATA),
  inlineData: CSV_DATA,
  sourceFiles: NO_SOURCE_FILES,
  exercisesLadder: false,
  acceptance: csvDataTableAcceptance,
};

// ---- 3. A 3-tier architecture diagram ---------------------------------------
//
// The edges are the source of truth: the node labels are READ OUT of them, so the
// rubric can only require nodes the prompt actually named, and the connector
// floor can only be the number of dependencies it actually stated.

export const EDGE_ARROW = "->";

const ARCHITECTURE_EDGES = [
  { from: "Client", to: "API" },
  { from: "API", to: "Database" },
] as const;

const architectureNodeLabels = uniqueInOrder(
  ARCHITECTURE_EDGES.flatMap((edge) => [edge.from, edge.to]),
);

const ARCHITECTURE_DATA = ARCHITECTURE_EDGES.map(
  (edge) => `${edge.from} ${EDGE_ARROW} ${edge.to}`,
).join(LINE_BREAK);

const architectureDiagramAcceptance: AcceptanceSpec = {
  scenarioId: PortedScenarioId.ArchitectureDiagram,
  title: "One drawing carrying all 3 nodes and the arrows between them",
  assertions: [
    NON_EMPTY_CONTENT,
    ...CLEAN_RENDER,
    {
      kind: AssertionKind.DiagramSvg,
      description: "one svg carries all 3 node labels and connects them",
      requiredNodeLabels: architectureNodeLabels,
      // One connector per dependency in the source data. Mermaid draws its edges
      // as <path>; a hand-drawn diagram uses <line>/<path>/<polyline>. Both count.
      minConnectorMarks: ARCHITECTURE_EDGES.length,
    },
  ],
};

const architectureDiagramTask = `Draw an architecture diagram of this 3-tier system: one labelled node per service, joined by an arrow for each dependency below. Label the nodes exactly ${quoteAll(architectureNodeLabels)}.`;

export const architectureDiagramScenario: EvalScenario = {
  id: PortedScenarioId.ArchitectureDiagram,
  title: "Architecture diagram (3-tier system)",
  request: pasteIntoRequest(architectureDiagramTask, ARCHITECTURE_DATA),
  inlineData: ARCHITECTURE_DATA,
  sourceFiles: NO_SOURCE_FILES,
  exercisesLadder: false,
  acceptance: architectureDiagramAcceptance,
};

// ---- 4. An incident postmortem ----------------------------------------------

const INCIDENT = {
  service: "Checkout API",
  errorStatus: "500s",
  outageMinutes: 12,
  rootCause: "connection pool exhaustion",
  poolSizeAfterDeploy: 5,
} as const;

const INCIDENT_VERDICT = `${INCIDENT.service} returned ${INCIDENT.errorStatus} for ${INCIDENT.outageMinutes} minutes due to a database ${INCIDENT.rootCause}.`;

// Verbatim from the original prompt: these are the lines the model is handed.
const INCIDENT_TIMELINE_STEPS = [
  "Deploy at 14:02 raised connection pool size to 5",
  "Traffic spike at 14:10 exhausted the pool",
  "Alerts fired at 14:12",
  "Pool size reverted at 14:14",
  "Recovered at 14:14",
] as const;

const INCIDENT_ACTION_ITEMS = [
  "raise the default pool size",
  "add a pool-exhaustion alert",
] as const;

const CLOCK_TIME_PATTERN = /\d{2}:\d{2}/g;
const FIRST_STEP_NUMBER = 1;

// The timestamps are READ OUT of the steps rather than restated next to them, so
// the rubric can only ever demand a time the model was actually given.
function extractClockTimes(lines: readonly string[]): string[] {
  const everyTime = lines.flatMap((line) => line.match(CLOCK_TIME_PATTERN) ?? []);
  return uniqueInOrder(everyTime);
}

const incidentTimestamps = extractClockTimes(INCIDENT_TIMELINE_STEPS);

const incidentTimelineLines = INCIDENT_TIMELINE_STEPS.map(
  (step, index) => `${index + FIRST_STEP_NUMBER}) ${step}`,
);
const incidentActionItemLines = INCIDENT_ACTION_ITEMS.map((item) => `- ${item}`);

const INCIDENT_DATA = [
  `Verdict: ${INCIDENT_VERDICT}`,
  "",
  "Timeline:",
  ...incidentTimelineLines,
  "",
  "Action items:",
  ...incidentActionItemLines,
].join(LINE_BREAK);

// The incident's ATOMS: the service, the status code, the outage length, the root
// cause, the pool size the deploy set, and every distinct timestamp. The action
// items are deliberately not asserted as sentences — they are prose a correct
// report may legitimately reword ("Raise the default connection pool size"), and
// a rubric that failed a correct page over a reworded bullet would be the same
// kind of artifact this rebuild exists to remove.
const incidentFacts = [
  `${INCIDENT.service} returned ${INCIDENT.errorStatus}`,
  `${INCIDENT.outageMinutes} minutes`,
  INCIDENT.rootCause,
  `pool size to ${INCIDENT.poolSizeAfterDeploy}`,
  ...incidentTimestamps,
];

const incidentReportAcceptance: AcceptanceSpec = {
  scenarioId: PortedScenarioId.IncidentReport,
  title: "The incident's facts, timestamps included, on the page",
  assertions: [
    NON_EMPTY_CONTENT,
    ...CLEAN_RENDER,
    {
      kind: AssertionKind.TextPresent,
      description: "the verdict, the root cause, the numbers and every timeline timestamp are rendered",
      values: incidentFacts,
    },
  ],
};

const incidentReportTask = `Write this up as an incident postmortem report: the verdict, the timeline as an ordered list of all ${INCIDENT_TIMELINE_STEPS.length} steps, and the action items. Every timestamp, service name and number below must appear in the report.`;

export const incidentReportScenario: EvalScenario = {
  id: PortedScenarioId.IncidentReport,
  title: "Incident postmortem report",
  request: pasteIntoRequest(incidentReportTask, INCIDENT_DATA),
  inlineData: INCIDENT_DATA,
  sourceFiles: NO_SOURCE_FILES,
  exercisesLadder: false,
  acceptance: incidentReportAcceptance,
};

// ---- 5. A signup form that must refuse bad input -----------------------------
//
// `required` and `minLength` are asserted as BEHAVIOUR, not as markup. Scoring
// the attributes would score one technology's way of refusing bad input:
// parchment's Input does not accept `required` or `minLength` at all (it
// validates through a `checks` prop), so an attribute rubric would hand the HTML
// arm a win it never earned. So we do what a user does — type nonsense into every
// field, press the button, and see whether the form refuses. Each fill below
// violates exactly one stated constraint, and EVERY corrupted field must be
// refused: a form whose only constraint is type="email" would refuse
// "not-an-email" while happily accepting an empty name and a 3-character password.

export const MIN_PASSWORD_LENGTH = 8;
const SUBMIT_BUTTON_TEXT = "Sign up";

const SIGNUP_FIELDS = [
  { label: "name", type: "text", constraints: ["required"] },
  { label: "email", type: "email", constraints: ["required"] },
  {
    label: "password",
    type: "password",
    constraints: ["required", `minimum ${MIN_PASSWORD_LENGTH} characters`],
  },
] as const;

type SignupField = (typeof SIGNUP_FIELDS)[number];
type SignupFieldLabel = SignupField["label"];

const EMPTY_NAME = "";
const MALFORMED_EMAIL = "not-an-email";
export const TOO_SHORT_PASSWORD = "abc";

// Keyed by the field labels themselves, so a field can never be added without an
// invalid fill to corrupt it with.
const INVALID_VALUE_BY_FIELD = {
  name: EMPTY_NAME,
  email: MALFORMED_EMAIL,
  password: TOO_SHORT_PASSWORD,
} as const satisfies Record<SignupFieldLabel, string>;

function describeSignupField(field: SignupField): string {
  const attributes = [field.type, ...field.constraints];
  return `${field.label}: ${attributes.join(", ")}`;
}

const VALIDATED_FORM_DATA = [
  ...SIGNUP_FIELDS.map(describeSignupField),
  `Submit button label: ${SUBMIT_BUTTON_TEXT}`,
].join(LINE_BREAK);

const requiredSignupInputs = SIGNUP_FIELDS.map((field) => ({
  label: field.label,
  type: field.type,
}));

const invalidSignupFills = SIGNUP_FIELDS.map((field) => ({
  label: field.label,
  value: INVALID_VALUE_BY_FIELD[field.label],
}));

const validatedFormAcceptance: AcceptanceSpec = {
  scenarioId: PortedScenarioId.ValidatedForm,
  title: "Three typed fields, a submit button, and input the form actually refuses",
  assertions: [
    NON_EMPTY_CONTENT,
    ...CLEAN_RENDER,
    {
      kind: AssertionKind.FormInputs,
      description: "the 3 fields are rendered with their input types, next to the submit button",
      requiredInputs: requiredSignupInputs,
      submitButtonText: SUBMIT_BUTTON_TEXT,
    },
    {
      kind: AssertionKind.FormValidation,
      description: `the form refuses an empty name, a malformed email and a password under ${MIN_PASSWORD_LENGTH} characters`,
      invalidFills: invalidSignupFills,
      submitButtonText: SUBMIT_BUTTON_TEXT,
    },
  ],
};

const validatedFormTask = `Build a signup form with the ${SIGNUP_FIELDS.length} fields below, each with the input type and constraints given, and a submit button labelled "${SUBMIT_BUTTON_TEXT}". Pressing the button with a required field left empty, a malformed email address, or a password shorter than ${MIN_PASSWORD_LENGTH} characters must be refused, and the offending field told to the user.`;

export const validatedFormScenario: EvalScenario = {
  id: PortedScenarioId.ValidatedForm,
  title: "Signup form with validation + submit",
  request: pasteIntoRequest(validatedFormTask, VALIDATED_FORM_DATA),
  inlineData: VALIDATED_FORM_DATA,
  sourceFiles: NO_SOURCE_FILES,
  exercisesLadder: false,
  acceptance: validatedFormAcceptance,
};

// ---- 6. A live log dashboard: a seeded chart and the recent lines -------------

export const ERROR_RATE_PER_MINUTE = [2, 3, 1, 4, 2] as const;

const RECENT_LOG_LINES = [
  { level: "ERROR", message: "db timeout" },
  { level: "WARN", message: "slow query 800ms" },
  { level: "INFO", message: "cache cleared" },
] as const;

// Level and message may be one cell or two, and a page may drop the brackets —
// both are presentation. What must be true is that a line's level and its message
// land in the SAME row.
const logLineCells = RECENT_LOG_LINES.map((line) => [line.level, line.message]);
const logLineTexts = RECENT_LOG_LINES.map((line) => `[${line.level}] ${line.message}`);

const LIVE_LOG_DATA = [
  `Error rate per minute: ${ERROR_RATE_PER_MINUTE.join(", ")}`,
  "",
  `Most recent ${RECENT_LOG_LINES.length} log lines:`,
  ...logLineTexts,
].join(LINE_BREAK);

const liveLogDashboardAcceptance: AcceptanceSpec = {
  scenarioId: PortedScenarioId.LiveLogDashboard,
  title: "A chart holding all 5 seeded points, and the log lines as rows",
  assertions: [
    NON_EMPTY_CONTENT,
    ...CLEAN_RENDER,
    {
      kind: AssertionKind.Charts,
      description: "the error-rate chart plots all 5 seeded points",
      minCharts: 1,
      minDataPointsPerChart: ERROR_RATE_PER_MINUTE.length,
      // The prompt names no x-axis categories, so demanding specific tick labels
      // would invent a requirement the model was never given. The >= 2 text-label
      // floor inside the Charts check still holds (a chart must paint SOME axis),
      // and the table below carries this scenario's text verification.
      requiredAxisLabels: [],
    },
    {
      kind: AssertionKind.TableRows,
      description: "each log line is rendered with its level and message in one row",
      minDataRows: RECENT_LOG_LINES.length,
      requiredRows: logLineCells,
    },
  ],
};

const liveLogDashboardTask = `Build a log monitoring dashboard: a line chart of the error rate per minute plotting all ${ERROR_RATE_PER_MINUTE.length} points below, and a table of the ${RECENT_LOG_LINES.length} most recent log lines with each line's level and its message.`;

export const liveLogDashboardScenario: EvalScenario = {
  id: PortedScenarioId.LiveLogDashboard,
  title: "Live log dashboard (setup half of tokens-per-update)",
  request: pasteIntoRequest(liveLogDashboardTask, LIVE_LOG_DATA),
  inlineData: LIVE_LOG_DATA,
  sourceFiles: NO_SOURCE_FILES,
  exercisesLadder: false,
  acceptance: liveLogDashboardAcceptance,
};

export const portedScenarios = [
  statusDashboardScenario,
  csvDataTableScenario,
  architectureDiagramScenario,
  incidentReportScenario,
  validatedFormScenario,
  liveLogDashboardScenario,
] as const;
