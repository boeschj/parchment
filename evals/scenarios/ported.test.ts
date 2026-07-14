// The anti-drift tests.
//
// The bug that forced the retraction was not a typo — it was a rubric that never
// looked at the prompt. It asked "does the spec contain a Chart?" and the answer
// was yes even when the Chart held no data. So the test that matters here is the
// one that ties the two together: EVERY value the rubric demands in the DOM must
// be traceable back into the SAME scenario's pasted source data. A rubric that
// asserts a number the model was never given is broken; so is one that quietly
// stops asserting a number the model WAS given.
//
// The matching is deliberately the same as bench/acceptance/checks.ts's
// `textIsPresent` — collapse or squash — so this test is exactly as permissive as
// the rubric it guards, no more and no less.

import { describe, expect, test } from "bun:test";
import {
  AssertionKind,
  type AcceptanceSpec,
  type Assertion,
  type ChartsAssertion,
  type DiagramSvgAssertion,
  type FormInputsAssertion,
  type FormValidationAssertion,
  type TableRowsAssertion,
} from "../../bench/acceptance/types.ts";
import type { EvalScenario } from "../types.ts";
import {
  CI_DAILY_METRICS,
  EDGE_ARROW,
  ERROR_RATE_PER_MINUTE,
  MIN_PASSWORD_LENGTH,
  PortedScenarioId,
  TOO_SHORT_PASSWORD,
  architectureDiagramScenario,
  csvDataTableScenario,
  liveLogDashboardScenario,
  portedScenarios,
  statusDashboardScenario,
  validatedFormScenario,
} from "./ported.ts";

// An svg with no data plotted still paints its axes: 0-2 marks (see SvgFacts in
// bench/acceptance/types.ts). Any chart floor at or below this passes an EMPTY
// chart — which is precisely the hole the old published results fell through.
const EMPTY_CHART_MARK_CEILING = 2;

const CSV_HEADER_LINE_COUNT = 1;
const LINE_BREAK = "\n";
const LOG_LINE_PATTERN = /^\[[A-Z]+\]/;

// ---- Reading the rubric ------------------------------------------------------

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function squash(text: string): string {
  return text.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isTraceableTo(sourceData: string, value: string): boolean {
  if (collapse(sourceData).includes(collapse(value))) return true;
  return squash(sourceData).includes(squash(value));
}

// Every literal the assertion demands the page paint. The FormValidation FILL
// values are excluded on purpose: they are the nonsense we type INTO the form
// ("", "not-an-email", "abc"), so they are the one thing that must NOT come from
// the source data. Their field labels are source data, and they are checked.
function assertedValues(assertion: Assertion): string[] {
  switch (assertion.kind) {
    case AssertionKind.ContentNonEmpty:
    case AssertionKind.NoConsoleErrors:
    case AssertionKind.NoErrorBoundary:
      return [];
    case AssertionKind.TextPresent:
      return assertion.values;
    case AssertionKind.TableRows:
      return assertion.requiredRows.flat();
    case AssertionKind.Charts:
      return assertion.requiredAxisLabels;
    case AssertionKind.DiagramSvg:
      return assertion.requiredNodeLabels;
    case AssertionKind.FormInputs:
      return [
        ...assertion.requiredInputs.flatMap((input) => [input.label, input.type]),
        assertion.submitButtonText,
      ];
    case AssertionKind.FormValidation:
      return [...assertion.invalidFills.map((fill) => fill.label), assertion.submitButtonText];
  }
}

function isChartsAssertion(assertion: Assertion): assertion is ChartsAssertion {
  return assertion.kind === AssertionKind.Charts;
}

function isTableRowsAssertion(assertion: Assertion): assertion is TableRowsAssertion {
  return assertion.kind === AssertionKind.TableRows;
}

function isDiagramSvgAssertion(assertion: Assertion): assertion is DiagramSvgAssertion {
  return assertion.kind === AssertionKind.DiagramSvg;
}

function isFormInputsAssertion(assertion: Assertion): assertion is FormInputsAssertion {
  return assertion.kind === AssertionKind.FormInputs;
}

function isFormValidationAssertion(assertion: Assertion): assertion is FormValidationAssertion {
  return assertion.kind === AssertionKind.FormValidation;
}

function chartAssertionsOf(spec: AcceptanceSpec): ChartsAssertion[] {
  return spec.assertions.filter(isChartsAssertion);
}

function tableAssertionsOf(spec: AcceptanceSpec): TableRowsAssertion[] {
  return spec.assertions.filter(isTableRowsAssertion);
}

// The scenarios all paste their data; a null inlineData would mean the port lost
// the source data, so it is a failure rather than a skip.
function sourceDataOf(scenario: EvalScenario): string {
  if (scenario.inlineData === null) {
    throw new Error(`${scenario.id} pasted no source data: inlineData is null`);
  }
  return scenario.inlineData;
}

// ---- The anti-drift test -----------------------------------------------------

describe("every asserted value is traceable to the scenario's own pasted data", () => {
  for (const scenario of portedScenarios) {
    test(scenario.id, () => {
      const sourceData = sourceDataOf(scenario);
      const demanded = scenario.acceptance.assertions.flatMap(assertedValues);

      expect(demanded.length).toBeGreaterThan(0);
      expect(demanded.filter((value) => value.length === 0)).toEqual([]);

      const untraceable = demanded.filter((value) => !isTraceableTo(sourceData, value));
      expect(untraceable).toEqual([]);
    });
  }
});

// The rubric requires these cells to co-occur in a single <tr>. They can only
// honestly do so if they co-occur in a single LINE of the prompt's data — one
// row of the source is one row of the table.
describe("required table rows co-occur in one line of the pasted data", () => {
  for (const scenario of portedScenarios) {
    const tableAssertions = tableAssertionsOf(scenario.acceptance);
    if (tableAssertions.length === 0) continue;

    test(scenario.id, () => {
      const sourceLines = sourceDataOf(scenario).split(LINE_BREAK);
      const requiredRows = tableAssertions.flatMap((assertion) => assertion.requiredRows);

      const rowsNotOnAnyLine = requiredRows.filter(
        (cells) => !sourceLines.some((line) => cells.every((cell) => isTraceableTo(line, cell))),
      );
      expect(rowsNotOnAnyLine).toEqual([]);
    });
  }
});

// ---- The floors that make an empty render fail -------------------------------

describe("chart floors exceed what an empty chart can paint", () => {
  for (const scenario of portedScenarios) {
    const chartAssertions = chartAssertionsOf(scenario.acceptance);
    if (chartAssertions.length === 0) continue;

    test(scenario.id, () => {
      for (const assertion of chartAssertions) {
        expect(assertion.minDataPointsPerChart).toBeGreaterThan(EMPTY_CHART_MARK_CEILING);
        expect(assertion.minCharts).toBeGreaterThan(0);
      }
    });
  }
});

describe("status-dashboard", () => {
  const sourceData = sourceDataOf(statusDashboardScenario);

  test("both chart floors equal the number of days the prompt actually pasted", () => {
    const chartAssertions = chartAssertionsOf(statusDashboardScenario.acceptance);
    expect(chartAssertions.length).toBe(1);

    for (const assertion of chartAssertions) {
      expect(assertion.minCharts).toBe(2);
      expect(assertion.minDataPointsPerChart).toBe(CI_DAILY_METRICS.length);
      expect(assertion.requiredAxisLabels.length).toBe(CI_DAILY_METRICS.length);
    }
  });

  test("every day is pasted with both of its values", () => {
    const missingPairs = CI_DAILY_METRICS.flatMap((metric) =>
      [`${metric.day} ${metric.buildMinutes}`, `${metric.day} ${metric.deploys}`].filter(
        (pair) => !isTraceableTo(sourceData, pair),
      ),
    );
    expect(missingPairs).toEqual([]);
  });
});

describe("csv-data-table", () => {
  const sourceData = sourceDataOf(csvDataTableScenario);

  test("the row floor equals the number of data rows in the pasted CSV, and every one is required", () => {
    const tableAssertions = tableAssertionsOf(csvDataTableScenario.acceptance);
    expect(tableAssertions.length).toBe(1);

    const pastedDataRowCount = sourceData.split(LINE_BREAK).length - CSV_HEADER_LINE_COUNT;

    for (const assertion of tableAssertions) {
      expect(assertion.minDataRows).toBe(pastedDataRowCount);
      expect(assertion.requiredRows.length).toBe(pastedDataRowCount);
      // name, role, tickets_closed — the whole triple, or a page could print the
      // names and drop the counts.
      for (const cells of assertion.requiredRows) {
        expect(cells.length).toBe(3);
      }
    }
  });
});

describe("architecture-diagram", () => {
  const sourceData = sourceDataOf(architectureDiagramScenario);

  test("the connector floor equals the number of edges the prompt actually pasted", () => {
    const diagramAssertions = architectureDiagramScenario.acceptance.assertions.filter(
      isDiagramSvgAssertion,
    );
    expect(diagramAssertions.length).toBe(1);

    const pastedEdgeCount = sourceData.split(EDGE_ARROW).length - 1;

    for (const assertion of diagramAssertions) {
      expect(assertion.minConnectorMarks).toBe(pastedEdgeCount);
      expect(assertion.requiredNodeLabels.length).toBeGreaterThan(0);
    }
  });
});

describe("validated-form", () => {
  const sourceData = sourceDataOf(validatedFormScenario);
  const [formInputs] = validatedFormScenario.acceptance.assertions.filter(isFormInputsAssertion);
  const [formValidation] =
    validatedFormScenario.acceptance.assertions.filter(isFormValidationAssertion);

  test("every field the rubric requires also gets invalid input typed into it", () => {
    expect(formInputs).toBeDefined();
    expect(formValidation).toBeDefined();
    if (!formInputs || !formValidation) return;

    const corruptedLabels = formValidation.invalidFills.map((fill) => fill.label);
    const uncorrupted = formInputs.requiredInputs
      .map((input) => input.label)
      .filter((label) => !corruptedLabels.includes(label));

    // A form whose only constraint is type="email" refuses "not-an-email" while
    // accepting an empty name and a 3-character password. Every field must be
    // corrupted, or the rubric cannot tell those two forms apart.
    expect(uncorrupted).toEqual([]);
    expect(formValidation.submitButtonText).toBe(formInputs.submitButtonText);
  });

  test("the invalid password is genuinely shorter than the minimum the prompt states", () => {
    expect(TOO_SHORT_PASSWORD.length).toBeLessThan(MIN_PASSWORD_LENGTH);
    expect(isTraceableTo(sourceData, `minimum ${MIN_PASSWORD_LENGTH} characters`)).toBe(true);
  });
});

describe("live-log-dashboard", () => {
  const sourceData = sourceDataOf(liveLogDashboardScenario);

  test("the chart floor equals the number of seeded points the prompt actually pasted", () => {
    const [chartAssertion] = chartAssertionsOf(liveLogDashboardScenario.acceptance);
    expect(chartAssertion).toBeDefined();
    if (!chartAssertion) return;

    expect(chartAssertion.minDataPointsPerChart).toBe(ERROR_RATE_PER_MINUTE.length);
    expect(isTraceableTo(sourceData, ERROR_RATE_PER_MINUTE.join(", "))).toBe(true);
  });

  test("the row floor equals the number of log lines the prompt actually pasted", () => {
    const [tableAssertion] = tableAssertionsOf(liveLogDashboardScenario.acceptance);
    expect(tableAssertion).toBeDefined();
    if (!tableAssertion) return;

    const pastedLogLineCount = sourceData
      .split(LINE_BREAK)
      .filter((line) => LOG_LINE_PATTERN.test(line)).length;

    expect(tableAssertion.minDataRows).toBe(pastedLogLineCount);
    expect(tableAssertion.requiredRows.length).toBe(pastedLogLineCount);
  });
});

// ---- Identity ----------------------------------------------------------------

describe("the six ported scenarios", () => {
  test("carry all six ids, each exactly once", () => {
    const ids = portedScenarios.map((scenario) => scenario.id);
    const expectedIds = Object.values(PortedScenarioId);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.toSorted()).toEqual(expectedIds.toSorted());
  });

  for (const scenario of portedScenarios) {
    test(`${scenario.id}: is a pasted-data baseline scenario whose rubric is its own`, () => {
      expect(scenario.acceptance.scenarioId).toBe(scenario.id);
      expect(scenario.exercisesLadder).toBe(false);
      expect(scenario.sourceFiles).toEqual([]);
      // The rubric traces to inlineData, so inlineData must be what the model was
      // actually handed — not a stale copy of it.
      expect(scenario.request).toContain(sourceDataOf(scenario));
    });
  }
});
