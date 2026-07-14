// Evaluates a scenario's assertions against DomFacts. Pure functions, no
// browser, no arm: every function here takes only what the page painted and
// returns the reasons it fell short. This is the file to read if you want to
// know exactly what "correct" means in this benchmark.
//
// A reason is a sentence a skeptic can check against the archived screenshot
// and DomFacts JSON without re-running anything.

import {
  AssertionKind,
  type Assertion,
  type ChartsAssertion,
  type ContentNonEmptyAssertion,
  type DiagramSvgAssertion,
  type DomFacts,
  type FormInputsAssertion,
  type FormValidationAssertion,
  type SvgFacts,
  type TableRowsAssertion,
  type TextPresentAssertion,
} from "./types.ts";

// A chart qualifies only if it BOTH plotted enough data points AND painted at
// least this many text labels. The label floor is what separates a real chart
// from decoration: a lucide icon is an <svg> whose single path can carry a
// dozen vertices, but it has no text. Measured: a correct recharts bar chart
// paints 38 tick/legend labels, a correct hand-written svg chart paints 7, an
// empty chart paints 0.
const MINIMUM_CHART_TEXT_LABELS = 2;

export function evaluateAssertions(assertions: Assertion[], facts: DomFacts): string[] {
  return assertions.flatMap((assertion) => evaluateAssertion(assertion, facts));
}

function evaluateAssertion(assertion: Assertion, facts: DomFacts): string[] {
  switch (assertion.kind) {
    case AssertionKind.ContentNonEmpty:
      return checkContentNonEmpty(assertion, facts);
    case AssertionKind.NoConsoleErrors:
      return checkNoConsoleErrors(facts);
    case AssertionKind.NoErrorBoundary:
      return checkNoErrorBoundary(facts);
    case AssertionKind.TextPresent:
      return checkTextPresent(assertion, facts);
    case AssertionKind.TableRows:
      return checkTableRows(assertion, facts);
    case AssertionKind.Charts:
      return checkCharts(assertion, facts);
    case AssertionKind.DiagramSvg:
      return checkDiagramSvg(assertion, facts);
    case AssertionKind.FormInputs:
      return checkFormInputs(assertion, facts);
    case AssertionKind.FormValidation:
      return checkFormValidation(assertion, facts);
  }
}

function checkContentNonEmpty(assertion: ContentNonEmptyAssertion, facts: DomFacts): string[] {
  const reasons: string[] = [];
  if (facts.visibleTextLength < assertion.minVisibleTextLength) {
    reasons.push(
      `content is near-empty: ${facts.visibleTextLength} non-whitespace characters painted, expected >= ${assertion.minVisibleTextLength}`,
    );
  }
  if (facts.contentHeightPx < assertion.minContentHeightPx) {
    reasons.push(
      `content is visually collapsed: ${Math.round(facts.contentHeightPx)}px tall, expected >= ${assertion.minContentHeightPx}px`,
    );
  }
  return reasons;
}

function checkNoConsoleErrors(facts: DomFacts): string[] {
  if (facts.consoleErrors.length === 0) return [];
  const firstError = facts.consoleErrors[0]?.split("\n")[0] ?? "";
  return [
    `page logged ${facts.consoleErrors.length} console error(s); first: ${truncate(firstError, 160)}`,
  ];
}

function checkNoErrorBoundary(facts: DomFacts): string[] {
  if (facts.errorBoundaryTexts.length === 0) return [];
  return [`error text rendered on the page: ${facts.errorBoundaryTexts.map((text) => `"${text}"`).join(", ")}`];
}

function checkTextPresent(assertion: TextPresentAssertion, facts: DomFacts): string[] {
  const missing = assertion.values.filter((value) => !textIsPresent(facts.visibleText, value));
  if (missing.length === 0) return [];
  return [`${assertion.description}: missing from the rendered page: ${missing.map((v) => `"${v}"`).join(", ")}`];
}

// A value counts as rendered if EITHER normalization finds it. Both are needed,
// and both are applied to both arms:
//   collapsed — "94 %" / "94%" / "94%\n" all match "94%".
//   squashed  — a KPI label and its value are adjacent nodes, and innerText
//               joins them differently per arm: parchment paints "OPEN
//               INCIDENTS\n2" while a hand-written page paints "Open
//               Incidents2". Squashing to alphanumerics lets "Open Incidents 2"
//               match both, so a label/value pair can be asserted TOGETHER
//               rather than as two independent (and individually vacuous)
//               substrings — asserting the bare digit "2" would pass on any
//               page containing a 2.
function textIsPresent(haystack: string, value: string): boolean {
  if (collapse(haystack).includes(collapse(value))) return true;
  return squash(haystack).includes(squash(value));
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function squash(text: string): string {
  return text.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function checkTableRows(assertion: TableRowsAssertion, facts: DomFacts): string[] {
  const reasons: string[] = [];
  const totalDataRows = facts.tables.reduce((total, table) => total + table.dataRowCount, 0);

  if (facts.tables.length === 0) {
    return [`${assertion.description}: no <table> was rendered at all`];
  }
  if (totalDataRows < assertion.minDataRows) {
    reasons.push(
      `${assertion.description}: ${totalDataRows} data row(s) rendered, expected >= ${assertion.minDataRows}`,
    );
  }

  const allRows = facts.tables.flatMap((table) => table.rows);
  const missingRows = assertion.requiredRows.filter((requiredCells) => !someRowContainsAll(allRows, requiredCells));
  if (missingRows.length > 0) {
    reasons.push(
      `${assertion.description}: these row(s) never appear with all their values in one table row: ` +
        missingRows.map((cells) => `[${cells.join(" | ")}]`).join(", "),
    );
  }
  return reasons;
}

// Co-occurrence within a single row is the point: a page that prints the names
// in one column and the numbers somewhere else has not rendered the CSV.
function someRowContainsAll(rows: string[][], requiredCells: string[]): boolean {
  return rows.some((row) => {
    const rowText = collapse(row.join(" "));
    return requiredCells.every((cell) => rowText.includes(collapse(cell)));
  });
}

function checkCharts(assertion: ChartsAssertion, facts: DomFacts): string[] {
  const reasons: string[] = [];
  const qualifying = facts.svgs.filter((svg) => isDataChart(svg, assertion.minDataPointsPerChart));

  if (qualifying.length < assertion.minCharts) {
    reasons.push(
      `${assertion.description}: ${qualifying.length} chart(s) actually plotted >= ${assertion.minDataPointsPerChart} data points, expected >= ${assertion.minCharts}. ` +
        `Observed per-svg data-point counts: [${facts.svgs.map((svg) => svg.dataPointCount).join(", ") || "no <svg> rendered at all"}]` +
        bitmapChartNote(facts),
    );
  }

  const paintedLabels = qualifying.flatMap((svg) => svg.textLabels).map(collapse);
  const missingLabels = assertion.requiredAxisLabels.filter(
    (label) => !paintedLabels.some((painted) => painted.includes(collapse(label))),
  );
  if (missingLabels.length > 0) {
    reasons.push(
      `${assertion.description}: the chart(s) never painted these axis labels from the source data: ` +
        missingLabels.map((label) => `"${label}"`).join(", "),
    );
  }
  return reasons;
}

function isDataChart(svg: SvgFacts, minDataPoints: number): boolean {
  return svg.dataPointCount >= minDataPoints && svg.textLabels.length >= MINIMUM_CHART_TEXT_LABELS;
}

// If a page drew its chart into a bitmap <canvas>, say so out loud instead of
// reporting a bare "no chart found". No DOM rubric can count data points in a
// bitmap — so the scenario prompts require inline <svg> from every arm, and a
// run that ignored that instruction should fail with the real reason printed.
function bitmapChartNote(facts: DomFacts): string {
  if (facts.canvasCount === 0) return "";
  return (
    ` NOTE: the page drew ${facts.canvasCount} <canvas> element(s). Data points inside a bitmap canvas are` +
    ` unverifiable by any DOM rubric (and unreadable to find-in-page and screen readers); the scenario prompt` +
    ` requires inline <svg>.`
  );
}

function checkDiagramSvg(assertion: DiagramSvgAssertion, facts: DomFacts): string[] {
  if (facts.svgs.length === 0) {
    return [`${assertion.description}: no <svg> diagram was rendered`];
  }

  const reasons: string[] = [];
  // Any single svg must carry all the node labels — the diagram is one drawing,
  // not labels scattered across separate images.
  const labelledSvg = facts.svgs.find((svg) => {
    const labels = svg.textLabels.map(collapse);
    return assertion.requiredNodeLabels.every((required) =>
      labels.some((label) => label.includes(collapse(required))),
    );
  });

  if (!labelledSvg) {
    const bestSvg = facts.svgs.reduce((best, svg) => (svg.textLabels.length > best.textLabels.length ? svg : best));
    reasons.push(
      `${assertion.description}: no single <svg> contains all the node labels ${assertion.requiredNodeLabels.map((l) => `"${l}"`).join(", ")}. ` +
        `Best svg painted: [${bestSvg.textLabels.slice(0, 12).join(", ") || "no text at all"}]`,
    );
    return reasons;
  }

  const connectorMarks =
    (labelledSvg.markCountsByTag["path"] ?? 0) +
    (labelledSvg.markCountsByTag["polyline"] ?? 0) +
    (labelledSvg.markCountsByTag["line"] ?? 0);
  if (connectorMarks < assertion.minConnectorMarks) {
    reasons.push(
      `${assertion.description}: the diagram drew ${connectorMarks} connector mark(s) (path/polyline/line), expected >= ${assertion.minConnectorMarks} — the nodes are labelled but not connected`,
    );
  }
  return reasons;
}

function checkFormInputs(assertion: FormInputsAssertion, facts: DomFacts): string[] {
  const reasons: string[] = [];

  for (const required of assertion.requiredInputs) {
    const match = facts.inputs.find((input) => collapse(input.labelText).includes(collapse(required.label)));
    if (!match) {
      reasons.push(
        `${assertion.description}: no input labelled "${required.label}" was rendered. ` +
          `Rendered inputs: [${facts.inputs.map((input) => `${input.labelText || "(unlabelled)"}:${input.type}`).join(", ") || "none"}]`,
      );
      continue;
    }
    if (match.type !== required.type) {
      reasons.push(
        `${assertion.description}: input "${required.label}" has type="${match.type}", expected type="${required.type}"`,
      );
    }
  }

  const hasSubmit = facts.buttonTexts.some((text) => collapse(text).includes(collapse(assertion.submitButtonText)));
  if (!hasSubmit) {
    reasons.push(
      `${assertion.description}: no submit control reading "${assertion.submitButtonText}". ` +
        `Buttons rendered: [${facts.buttonTexts.join(", ") || "none"}]`,
    );
  }
  return reasons;
}

// EVERY corrupted field must be refused, in any legible way: a native validity
// failure, an aria-invalid marker, or an error message naming it. Page-wide
// "something got refused" is not enough — a form whose only constraint is
// type="email" refuses "not-an-email" while happily accepting an empty required
// name and a 3-character password. See FormValidationAssertion in types.ts for
// why this is behavioural rather than a check for `required`/`minlength` markup.
function checkFormValidation(assertion: FormValidationAssertion, facts: DomFacts): string[] {
  const observed = facts.formValidation;
  if (!observed) {
    return [`${assertion.description}: the harness never ran the invalid-submit interaction (driver did not supply it)`];
  }

  const accepted = observed.fields.filter(
    (field) => field.found && !field.nativeInvalid && !field.ariaInvalid && !field.messaged,
  );
  if (accepted.length === 0) return [];

  const acceptedDescriptions = accepted
    .map((field) => {
      const fill = assertion.invalidFills.find((candidate) => candidate.label === field.label);
      return `${field.label}="${fill?.value ?? ""}"`;
    })
    .join(", ");

  return [
    `${assertion.description}: the form ACCEPTED invalid input for ${acceptedDescriptions} — after pressing ` +
      `"${assertion.submitButtonText}" ${accepted.length === 1 ? "that field" : "those fields"} did not fail native validity, ` +
      `was not marked aria-invalid, and drew no error message` +
      (observed.errorMessages.length > 0
        ? `. (The page did show: ${observed.errorMessages.map((message) => `"${truncate(message, 60)}"`).join(", ")})`
        : ""),
  ];
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}
