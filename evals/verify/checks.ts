// The assertion evaluator: pure, synchronous, and the only place acceptance is
// decided. It sees nothing but DomFacts — one reduction of what a real browser
// painted — so it cannot be satisfied by a spec that validates, a component that
// mounts, or any other proxy for "the user saw the data".
//
// Contract (bench/acceptance/types.ts): one human-readable line per FAILED
// assertion, empty array means pass. Every reason quotes the OBSERVED value, so
// a failure is diagnosable from the report alone, without re-running the browser.

import {
  AssertionKind,
  type Assertion,
  type ChartsAssertion,
  type ContentNonEmptyAssertion,
  type DiagramSvgAssertion,
  type DomFacts,
  type FieldRejection,
  type FormInputsAssertion,
  type FormValidationAssertion,
  type InputFacts,
  type RequiredInput,
  type SvgFacts,
  type TableFacts,
  type TableRowsAssertion,
  type TextPresentAssertion,
} from "../../bench/acceptance/types.ts";

// Axis and gridline <line> elements are deliberately excluded: both arms draw
// axes with them, so a diagram made of nothing but gridlines is not a diagram.
const CONNECTOR_MARK_TAGS = ["path", "polyline", "polygon"] as const;

const MAX_QUOTED_ITEMS = 8;
const VISIBLE_TEXT_PREVIEW_CHARS = 160;

export function evaluateAssertions(facts: DomFacts, assertions: Assertion[]): string[] {
  const outcomes = assertions.map((assertion) => evaluateAssertion(facts, assertion));
  return outcomes.filter(isFailure);
}

function evaluateAssertion(facts: DomFacts, assertion: Assertion): string | null {
  switch (assertion.kind) {
    case AssertionKind.ContentNonEmpty:
      return checkContentNonEmpty(facts, assertion);
    case AssertionKind.NoConsoleErrors:
      return checkNoConsoleErrors(facts);
    case AssertionKind.NoErrorBoundary:
      return checkNoErrorBoundary(facts);
    case AssertionKind.TextPresent:
      return checkTextPresent(facts, assertion);
    case AssertionKind.TableRows:
      return checkTableRows(facts, assertion);
    case AssertionKind.Charts:
      return checkCharts(facts, assertion);
    case AssertionKind.DiagramSvg:
      return checkDiagramSvg(facts, assertion);
    case AssertionKind.FormInputs:
      return checkFormInputs(facts, assertion);
    case AssertionKind.FormValidation:
      return checkFormValidation(facts, assertion);
    default:
      return assertNoUncheckedAssertion(assertion);
  }
}

function assertNoUncheckedAssertion(assertion: never): never {
  throw new Error(`acceptance cannot score an assertion it does not implement: ${JSON.stringify(assertion)}`);
}

function isFailure(outcome: string | null): outcome is string {
  return outcome !== null;
}

// ---- the checks ----

function checkContentNonEmpty(facts: DomFacts, assertion: ContentNonEmptyAssertion): string | null {
  const hasEnoughText = facts.visibleTextLength >= assertion.minVisibleTextLength;
  const isTallEnough = facts.contentHeightPx >= assertion.minContentHeightPx;
  if (hasEnoughText && isTallEnough) return null;

  return (
    `${AssertionKind.ContentNonEmpty}: expected >=${assertion.minVisibleTextLength} visible chars and ` +
    `>=${assertion.minContentHeightPx}px of painted content, observed ${facts.visibleTextLength} chars and ` +
    `${Math.round(facts.contentHeightPx)}px — "${previewOf(facts.visibleText)}"`
  );
}

function checkNoConsoleErrors(facts: DomFacts): string | null {
  if (facts.consoleErrors.length === 0) return null;

  return (
    `${AssertionKind.NoConsoleErrors}: observed ${facts.consoleErrors.length} console error(s)/uncaught ` +
    `exception(s) ${quoteTexts(facts.consoleErrors)}`
  );
}

function checkNoErrorBoundary(facts: DomFacts): string | null {
  if (facts.errorBoundaryTexts.length === 0) return null;

  return `${AssertionKind.NoErrorBoundary}: observed error-boundary text ${quoteTexts(facts.errorBoundaryTexts)}`;
}

function checkTextPresent(facts: DomFacts, assertion: TextPresentAssertion): string | null {
  const missingValues = assertion.values.filter((value) => !containsNormalized(facts.visibleText, value));
  if (missingValues.length === 0) return null;

  return (
    `${describe(assertion)}: missing ${quoteTexts(missingValues)} from the content root's visible text ` +
    `(${facts.visibleTextLength} chars) — "${previewOf(facts.visibleText)}"`
  );
}

function checkTableRows(facts: DomFacts, assertion: TableRowsAssertion): string | null {
  if (facts.tables.length === 0) {
    return (
      `${describe(assertion)}: expected a table with >=${assertion.minDataRows} data rows and rows ` +
      `${quoteRows(assertion.requiredRows)}, observed 0 tables`
    );
  }

  const satisfyingTable = facts.tables.find((table) => tableSatisfies(table, assertion));
  if (satisfyingTable) return null;

  const diagnoses = facts.tables.map((table, index) => diagnoseTable(table, assertion, index));
  return (
    `${describe(assertion)}: no single table satisfied it (expected >=${assertion.minDataRows} data rows and ` +
    `rows ${quoteRows(assertion.requiredRows)}); observed ${diagnoses.join("; ")}`
  );
}

function tableSatisfies(table: TableFacts, assertion: TableRowsAssertion): boolean {
  const hasEnoughDataRows = table.dataRowCount >= assertion.minDataRows;
  const missingRows = missingRequiredRows(table, assertion.requiredRows);
  return hasEnoughDataRows && missingRows.length === 0;
}

// A required row is present only when ALL of its values are cells of the SAME
// <tr>. This is the assertion that a page printing the names in one place and
// the numbers in another cannot pass.
function missingRequiredRows(table: TableFacts, requiredRows: string[][]): string[][] {
  return requiredRows.filter((requiredRow) => !table.rows.some((row) => rowContainsAllValues(row, requiredRow)));
}

function rowContainsAllValues(row: string[], requiredValues: string[]): boolean {
  return requiredValues.every((value) => row.some((cell) => containsNormalized(cell, value)));
}

function diagnoseTable(table: TableFacts, assertion: TableRowsAssertion, index: number): string {
  const missingRows = missingRequiredRows(table, assertion.requiredRows);
  const rowDiagnosis = missingRows.length === 0 ? "all required rows present" : `missing rows ${quoteRows(missingRows)}`;
  return `table ${index + 1}: ${table.dataRowCount} data rows, ${rowDiagnosis}`;
}

function checkCharts(facts: DomFacts, assertion: ChartsAssertion): string | null {
  const qualifyingCharts = facts.svgs.filter((svg) => svg.dataPointCount >= assertion.minDataPointsPerChart);

  // An icon (1-2 paths) and an empty chart (axes only) both fail here: neither
  // can paint minDataPointsPerChart marks without the data.
  if (qualifyingCharts.length < assertion.minCharts) {
    const observedDataPointCounts = facts.svgs.map((svg) => svg.dataPointCount);
    return (
      `${describe(assertion)}: expected >=${assertion.minCharts} chart(s) with ` +
      `>=${assertion.minDataPointsPerChart} data points, observed ${qualifyingCharts.length} qualifying of ` +
      `${facts.svgs.length} svg(s), dataPointCounts ${quoteNumbers(observedDataPointCounts)}` +
      bitmapCanvasNote(facts.canvasCount)
    );
  }

  const paintedLabels = qualifyingCharts.flatMap((svg) => svg.textLabels);
  const missingLabels = assertion.requiredAxisLabels.filter((label) => !someTextContains(paintedLabels, label));
  if (missingLabels.length === 0) return null;

  return (
    `${describe(assertion)}: missing axis label(s) ${quoteTexts(missingLabels)} from the ` +
    `${qualifyingCharts.length} qualifying chart(s), observed labels ${quoteTexts(paintedLabels)}`
  );
}

function checkDiagramSvg(facts: DomFacts, assertion: DiagramSvgAssertion): string | null {
  if (facts.svgs.length === 0) {
    return (
      `${describe(assertion)}: expected an svg painting node labels ${quoteTexts(assertion.requiredNodeLabels)}, ` +
      `observed 0 svgs`
    );
  }

  // The labels and the connectors must belong to the SAME svg: a page with a
  // labelled legend next to an unrelated squiggle has not drawn a diagram.
  const labelledSvgs = facts.svgs.filter((svg) => paintsAllNodeLabels(svg, assertion.requiredNodeLabels));
  if (labelledSvgs.length === 0) {
    const observedLabels = facts.svgs.map((svg, index) => `svg ${index + 1}: ${quoteTexts(svg.textLabels)}`);
    return (
      `${describe(assertion)}: no svg painted all node labels ${quoteTexts(assertion.requiredNodeLabels)}; ` +
      `observed ${observedLabels.join("; ")}`
    );
  }

  const connectedSvg = labelledSvgs.find((svg) => connectorMarkCount(svg) >= assertion.minConnectorMarks);
  if (connectedSvg) return null;

  const observedConnectorCounts = labelledSvgs.map(connectorMarkCount);
  return (
    `${describe(assertion)}: expected >=${assertion.minConnectorMarks} connector marks ` +
    `(${CONNECTOR_MARK_TAGS.join("/")}) in the svg carrying the node labels, observed ` +
    `${quoteNumbers(observedConnectorCounts)}`
  );
}

// Why a chart failure happened, when the page drew into a bitmap instead of the
// DOM. A <canvas> chart is unverifiable by ANY DOM rubric — and equally
// unreadable to a screen reader or a find-in-page — so we say so rather than
// reporting a bare "no chart".
function bitmapCanvasNote(canvasCount: number): string {
  if (canvasCount === 0) return "";
  return (
    ` (the page painted ${canvasCount} <canvas> element(s): a bitmap chart carries no data points ` +
    `that any DOM rubric — or any screen reader — can read)`
  );
}

function paintsAllNodeLabels(svg: SvgFacts, requiredNodeLabels: string[]): boolean {
  return requiredNodeLabels.every((label) => someTextContains(svg.textLabels, label));
}

function connectorMarkCount(svg: SvgFacts): number {
  return CONNECTOR_MARK_TAGS.reduce((total, tag) => total + (svg.markCountsByTag[tag] ?? 0), 0);
}

function checkFormInputs(facts: DomFacts, assertion: FormInputsAssertion): string | null {
  const inputProblems = assertion.requiredInputs
    .map((requiredInput) => diagnoseRequiredInput(facts.inputs, requiredInput))
    .filter(isFailure);
  const submitProblem = diagnoseSubmitButton(facts.buttonTexts, assertion.submitButtonText);

  const problems = [...inputProblems, ...toList(submitProblem)];
  if (problems.length === 0) return null;

  return `${describe(assertion)}: ${problems.join("; ")}`;
}

// Only the label and the DOM type are asserted. `required` and `minlength` are
// deliberately NOT: they are one technology's way of refusing bad input, and
// scoring them would hand the HTML arm a win on a rubric parchment cannot
// express. Whether the form actually refuses bad input is asserted as behaviour
// instead — see checkFormValidation.
function diagnoseRequiredInput(inputs: InputFacts[], requiredInput: RequiredInput): string | null {
  const labelledInputs = inputs.filter((input) => containsNormalized(input.labelText, requiredInput.label));
  if (labelledInputs.length === 0) {
    const observedLabels = inputs.map((input) => input.labelText);
    return `no input labelled "${requiredInput.label}" (observed labels ${quoteTexts(observedLabels)})`;
  }

  const satisfyingInput = labelledInputs.find((input) => matchesRequestedType(input, requiredInput.type));
  if (satisfyingInput) return null;

  const observedInputs = labelledInputs.map(describeInput);
  return (
    `input labelled "${requiredInput.label}" is not type="${requiredInput.type}" ` +
    `(observed ${observedInputs.join(", ")})`
  );
}

// The probe reports a <select> as type "text" (it carries no type attribute) and
// a <textarea> as type "textarea", so a spec may name either the input's type or
// its tag — both name the same control to the user who has to fill it in.
function matchesRequestedType(input: InputFacts, requestedType: string): boolean {
  const requested = normalizeForMatch(requestedType);
  return input.type.toLowerCase() === requested || input.tag.toLowerCase() === requested;
}

function diagnoseSubmitButton(buttonTexts: string[], submitButtonText: string): string | null {
  const hasSubmitButton = someTextContains(buttonTexts, submitButtonText);
  if (hasSubmitButton) return null;

  return `no button matching "${submitButtonText}" (observed buttons ${quoteTexts(buttonTexts)})`;
}

function describeInput(input: InputFacts): string {
  return `<${input.tag} type="${input.type}">`;
}

// Validation as BEHAVIOUR: we typed nonsense into every field the spec names and
// pressed submit. The page passes if it refused each of them in ANY legible way
// — a native constraint failure, an aria-invalid field, or a message naming the
// field. It fails only if it silently accepted the nonsense.
function checkFormValidation(facts: DomFacts, assertion: FormValidationAssertion): string | null {
  const observed = facts.formValidation;

  // The driver never ran the invalid-submit interaction. That is a harness
  // fault, not a page fault — but it must never be scored as a pass.
  if (observed === null) {
    return (
      `${describe(assertion)}: the invalid-submit interaction never ran, so the form's validation was ` +
      `never observed (harness fault: probeArtifact was not given this assertion's invalidFills)`
    );
  }

  const unfilledCount = assertion.invalidFills.length - observed.fields.length;
  if (unfilledCount > 0) {
    return (
      `${describe(assertion)}: only ${observed.fields.length} of ${assertion.invalidFills.length} fields ` +
      `were filled with invalid input before submit`
    );
  }

  const missingFields = observed.fields.filter((field) => !field.found);
  if (missingFields.length > 0) {
    return (
      `${describe(assertion)}: could not find field(s) ${quoteTexts(labelsOf(missingFields))} to type invalid ` +
      `input into, so the form was never given the chance to refuse them`
    );
  }

  const acceptedFields = observed.fields.filter((field) => !wasRefused(field));
  if (acceptedFields.length === 0) return null;

  return (
    `${describe(assertion)}: the form silently ACCEPTED invalid input in ${quoteTexts(labelsOf(acceptedFields))} ` +
    `— no native constraint failure, no aria-invalid, no message naming the field (validation messages the page ` +
    `did show: ${quoteTexts(observed.errorMessages)})`
  );
}

// Any legible refusal counts. A page that fails its own native constraints, a
// page that marks the field aria-invalid, and a page that renders "Password must
// be at least 8 characters" have all refused the user's bad input.
function wasRefused(field: FieldRejection): boolean {
  return field.nativeInvalid || field.ariaInvalid || field.messaged;
}

function labelsOf(fields: FieldRejection[]): string[] {
  return fields.map((field) => field.label);
}

// ---- matching ----
//
// Every value in the rubric is matched as a case-insensitive substring of the
// observed text, with whitespace runs collapsed. Both arms are free to render
// "Ada Lovelace" inside a padded cell, wrap it across two lines, or title-case
// it — none of which is a rendering failure. The rigour lives in WHERE a value
// must appear (this cell, this row, this chart), never in its casing.

function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function containsNormalized(haystack: string, needle: string): boolean {
  return normalizeForMatch(haystack).includes(normalizeForMatch(needle));
}

function someTextContains(haystacks: string[], needle: string): boolean {
  return haystacks.some((haystack) => containsNormalized(haystack, needle));
}

// ---- formatting the observed evidence ----

function describe(assertion: Extract<Assertion, { description: string }>): string {
  return `${assertion.kind} (${assertion.description})`;
}

function quoteTexts(values: string[]): string {
  const quoted = values.slice(0, MAX_QUOTED_ITEMS).map((value) => JSON.stringify(value));
  return `[${[...quoted, ...overflowNoteFor(values)].join(", ")}]`;
}

function quoteNumbers(values: number[]): string {
  const shown = values.slice(0, MAX_QUOTED_ITEMS).map((value) => String(value));
  return `[${[...shown, ...overflowNoteFor(values)].join(", ")}]`;
}

function quoteRows(rows: string[][]): string {
  const shown = rows.slice(0, MAX_QUOTED_ITEMS).map((row) => JSON.stringify(row));
  return `[${[...shown, ...overflowNoteFor(rows)].join(", ")}]`;
}

function overflowNoteFor(values: readonly unknown[]): string[] {
  const hiddenCount = values.length - MAX_QUOTED_ITEMS;
  if (hiddenCount <= 0) return [];
  return [`+${hiddenCount} more`];
}

function previewOf(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= VISIBLE_TEXT_PREVIEW_CHARS) return collapsed;
  return `${collapsed.slice(0, VISIBLE_TEXT_PREVIEW_CHARS)}...`;
}

function toList(value: string | null): string[] {
  if (value === null) return [];
  return [value];
}
