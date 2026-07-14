// The acceptance rubric's vocabulary.
//
// ANTI-GOODHART CONTRACT: nothing in this file — and nothing in the modules
// that consume it — may import parchment's spec schema, its validators, or
// `prepareSpec`. Acceptance is decided ONLY by what a real headless browser
// paints. The old harness failed exactly here: it asked our own validator
// whether our own output was good, then optimized the product against that
// answer. An assertion below must be satisfiable, in principle, by ANY
// technology that can paint a page — parchment, a hand-written HTML file, a
// PDF-to-canvas renderer, anything.
//
// The unit of judgement is DomFacts: one arm-agnostic reduction of a painted
// page. Both arms are reduced to DomFacts by the SAME in-page probe, and then
// the SAME scenario assertions run against it. There is no per-arm branch
// anywhere in the checking path — the only arm-specific knob is which element
// counts as the artifact's content root (see ContentRoot below), which exists
// to make the rubric STRICTER for parchment, not looser.

// ---- What we point the browser at ----

export const ArtifactKind = {
  // A page written to disk by an HTML arm; opened as file://<path>.
  HtmlFile: "html-file",
  // A slot already pushed to a bench daemon; opened as the daemon's canvas
  // page for that session. The acceptance module deliberately knows nothing
  // about daemons, tokens, or MCP — it is handed a URL like any other page.
  ParchmentCanvas: "parchment-canvas",
} as const;

export type ArtifactKind = (typeof ArtifactKind)[keyof typeof ArtifactKind];

export type Artifact =
  | { kind: typeof ArtifactKind.HtmlFile; filePath: string }
  | { kind: typeof ArtifactKind.ParchmentCanvas; canvasUrl: string };

// The element whose painted subtree IS the artifact. For an HTML file that is
// <body>. For parchment it is the slot's content section — NOT the whole page,
// because the app's own frame (left rail, session switcher, and the
// model-authored slot TITLE) would otherwise be able to satisfy a text
// assertion without a single data value being rendered. Scoping parchment to
// the content section is a handicap we impose on ourselves on purpose.
export const ContentRoot = {
  HtmlBody: "body",
  // src/browser/App.tsx SlotView: <section class="... scroll-fade-top"> wraps
  // SlotRenderer and nothing else. If this selector ever stops matching, the
  // probe throws rather than silently scoring an empty root as a pass.
  ParchmentSlot: "section.scroll-fade-top",
} as const;

export type ContentRoot = (typeof ContentRoot)[keyof typeof ContentRoot];

// ---- What the browser tells us (the only evidence any assertion may use) ----

export type TableFacts = {
  // Rows that carry data cells (<td>), i.e. header-only rows are excluded.
  dataRowCount: number;
  // Every row's cell texts, in document order, trimmed.
  rows: string[][];
  headerCells: string[];
};

export type SvgFacts = {
  // Data marks, counted per tag. Axis/grid <line> elements are deliberately
  // NOT counted: both arms draw axes with them, so counting them would let an
  // empty chart pass on its own gridlines.
  markCountsByTag: Record<string, number>;
  // The strongest arm-neutral answer to "how many data points did this chart
  // actually paint": the largest of (rect count, circle count, longest
  // path/polyline vertex run). A 7-bar chart scores 7 via rects; a 7-point
  // line chart scores 7 via its polyline/path vertices, whether recharts drew
  // it or a human hand-wrote it. An EMPTY chart scores ~0-2 (axis paths only).
  dataPointCount: number;
  // Text painted inside the svg: axis tick labels, mermaid node labels, etc.
  textLabels: string[];
  heightPx: number;
};

export type InputFacts = {
  tag: string;
  type: string;
  name: string;
  id: string;
  required: boolean;
  minLength: number | null;
  pattern: string | null;
  // The input's accessible label, resolved the way a user reads it: <label
  // for=id>, a wrapping <label>, aria-label, or placeholder — whichever exists.
  labelText: string;
};

// How each field we typed nonsense into responded to the submit attempt.
// Rejection is asserted PER FIELD, not page-wide: a form whose only constraint
// is type="email" would refuse "not-an-email" and thereby satisfy a page-wide
// "did anything get refused?" test while silently accepting an empty required
// name and a 3-character password. Every field we corrupted must be refused.
export type FieldRejection = {
  label: string;
  // The field was found in the DOM at all. A missing field is a FormInputs
  // failure; recorded here so a validation failure never masquerades as one.
  found: boolean;
  // checkValidity() === false — how a page using native HTML5 constraints
  // (required / type=email / minlength) refuses bad input.
  nativeInvalid: boolean;
  // aria-invalid / data-invalid — how a page with its own validation marks a bad
  // field. (parchment's Input validates through a `checks` prop, not through
  // native attributes.)
  ariaInvalid: boolean;
  // A validation message that appeared after submit and names this field.
  messaged: boolean;
};

// Populated only for scenarios whose spec carries a FormValidation assertion;
// null otherwise.
export type FormValidationFacts = {
  fields: FieldRejection[];
  // Every validation-shaped message that appeared after the submit attempt,
  // whether or not it names a specific field. Evidence for the report.
  errorMessages: string[];
};

// The <canvas> elements in the content root. A chart painted into a bitmap
// canvas cannot have its data points verified by ANY DOM rubric (nor by a
// screen reader, nor by a user's find-in-page). We count them only so that a
// chart failure can say WHY it failed instead of silently reporting "no chart".
export type DomFacts = {
  visibleText: string;
  visibleTextLength: number;
  contentHeightPx: number;
  tables: TableFacts[];
  svgs: SvgFacts[];
  canvasCount: number;
  inputs: InputFacts[];
  buttonTexts: string[];
  // Anything the page logged at console.error, plus uncaught exceptions.
  consoleErrors: string[];
  // Visible text matching a known "this component blew up / never rendered"
  // pattern — React error boundaries, parchment's own SlotErrorBoundary and
  // MissingComponent, and the generic phrasings a hand-written page uses.
  errorBoundaryTexts: string[];
  formValidation: FormValidationFacts | null;
};

// ---- The assertions (pure data; evaluated by checks.ts) ----

export const AssertionKind = {
  ContentNonEmpty: "content-non-empty",
  NoConsoleErrors: "no-console-errors",
  NoErrorBoundary: "no-error-boundary",
  TextPresent: "text-present",
  TableRows: "table-rows",
  Charts: "charts",
  DiagramSvg: "diagram-svg",
  FormInputs: "form-inputs",
  FormValidation: "form-validation",
} as const;

export type AssertionKind = (typeof AssertionKind)[keyof typeof AssertionKind];

// The page painted something a human would call content — not a blank div, not
// a spinner. Guards against the degenerate "renders without errors because it
// renders nothing" pass.
export type ContentNonEmptyAssertion = {
  kind: typeof AssertionKind.ContentNonEmpty;
  minVisibleTextLength: number;
  minContentHeightPx: number;
};

export type NoConsoleErrorsAssertion = {
  kind: typeof AssertionKind.NoConsoleErrors;
};

export type NoErrorBoundaryAssertion = {
  kind: typeof AssertionKind.NoErrorBoundary;
};

// Every value must appear in the content root's visible text. This is how the
// prompt's source data is verified to have reached the user's eyes.
export type TextPresentAssertion = {
  kind: typeof AssertionKind.TextPresent;
  description: string;
  values: string[];
};

// A real table, with the prompt's rows actually in it. requiredRows are matched
// as co-occurrence within a SINGLE row: ["Ada Lovelace", "42"] must be cells of
// the same <tr>, so a page that prints the names in one place and the numbers
// in another does not pass.
export type TableRowsAssertion = {
  kind: typeof AssertionKind.TableRows;
  description: string;
  minDataRows: number;
  requiredRows: string[][];
};

// Charts that actually plotted the data. A chart "qualifies" when it painted at
// least minDataPointsPerChart data points (see SvgFacts.dataPointCount) — which
// is what an icon (1-2 paths) and an empty chart (axes only) cannot do.
// requiredAxisLabels must appear as text across the qualifying charts, proving
// the axis was bound to the source data rather than drawn blank.
export type ChartsAssertion = {
  kind: typeof AssertionKind.Charts;
  description: string;
  minCharts: number;
  minDataPointsPerChart: number;
  requiredAxisLabels: string[];
};

// A diagram rendered to SVG with the required node labels painted inside it —
// mermaid for parchment, hand-drawn <svg> for the HTML arm, identical check.
export type DiagramSvgAssertion = {
  kind: typeof AssertionKind.DiagramSvg;
  description: string;
  requiredNodeLabels: string[];
  minConnectorMarks: number;
};

export type RequiredInput = {
  // Matched against the input's accessible label (<label for>, wrapping label,
  // aria-label, or placeholder — whichever the page used), so neither arm is
  // forced into a particular name/id convention.
  label: string;
  // The input's DOM type. This IS arm-neutral: a password field must mask its
  // characters and an email field must get the email keyboard, in any
  // technology. (Verified: parchment forwards `type` to the DOM.)
  type: string;
};

export type FormInputsAssertion = {
  kind: typeof AssertionKind.FormInputs;
  description: string;
  requiredInputs: RequiredInput[];
  submitButtonText: string;
};

// Validation, asserted as BEHAVIOUR rather than as markup.
//
// The tempting rubric — "the password input carries minlength=8 and required" —
// is a rubric artifact, not a requirement. It encodes ONE technology's way of
// refusing bad input. Measured: parchment's Input does not accept `required` or
// `minLength` at all ("unknown prop … the renderer ignores it"); it validates
// through its own `checks` prop instead. Scoring native attributes would have
// handed the HTML arm a win it did not earn, on a rubric parchment could not
// express — the mirror image of the sin this rebuild exists to correct.
//
// So we assert what a USER would check: type nonsense into the form, press the
// submit button, and see whether the form refuses. A page passes if it refuses
// in ANY legible way — a native constraint failure (checkValidity() === false),
// an aria-invalid field, or a visible error message. A page fails only if it
// silently accepted an empty required name and a 3-character password.
export type FormValidationAssertion = {
  kind: typeof AssertionKind.FormValidation;
  description: string;
  invalidFills: { label: string; value: string }[];
  submitButtonText: string;
};

export type Assertion =
  | ContentNonEmptyAssertion
  | NoConsoleErrorsAssertion
  | NoErrorBoundaryAssertion
  | TextPresentAssertion
  | TableRowsAssertion
  | ChartsAssertion
  | DiagramSvgAssertion
  | FormInputsAssertion
  | FormValidationAssertion;

// One scenario's acceptance rubric: pure data, applied byte-identically to
// every arm. This is the whole contract — if an arm cannot satisfy it, that is
// a real loss, not a rubric artifact.
export type AcceptanceSpec = {
  scenarioId: string;
  title: string;
  assertions: Assertion[];
};

export type AcceptanceResult = {
  scenarioId: string;
  passed: boolean;
  // Empty iff passed. One human-readable line per failed assertion, quoting the
  // observed value — a failure should be diagnosable without re-running.
  reasons: string[];
  screenshotPath: string;
  domFacts: DomFacts;
};
