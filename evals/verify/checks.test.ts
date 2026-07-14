// These tests are the rubric's own acceptance test. Each one encodes a way a
// page can LOOK finished while showing the user nothing — an empty chart drawn
// from its axes, a table whose values never share a row, a title with no
// content — and pins the rubric to failing it. If a future change makes any of
// these pass, the eval has started measuring the wrong thing.

import { describe, expect, test } from "bun:test";
import {
  AssertionKind,
  type Assertion,
  type DomFacts,
  type FieldRejection,
  type FormValidationFacts,
  type InputFacts,
  type SvgFacts,
  type TableFacts,
} from "../../bench/acceptance/types.ts";
import { evaluateAssertions } from "./checks.ts";

const REQUIRED_CHART_DATA_POINTS = 7;
const EMPTY_CHART_DATA_POINTS = 2;
const MIN_DASHBOARD_TEXT_CHARS = 120;
const MIN_DASHBOARD_HEIGHT_PX = 400;

describe("content-non-empty", () => {
  test("fails a page that rendered nothing but a title", () => {
    const titleOnlyPage = buildDomFacts({ visibleText: "Q3 Revenue Dashboard", contentHeightPx: 38 });

    const reasons = evaluateAssertions(titleOnlyPage, [contentNonEmptyAssertion()]);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("expected >=120 visible chars and >=400px");
    expect(reasons[0]).toContain("observed 18 chars and 38px");
    expect(reasons[0]).toContain("Q3 Revenue Dashboard");
  });

  test("fails a page that is tall but blank", () => {
    const blankButTallPage = buildDomFacts({ visibleText: "", contentHeightPx: 900 });

    const reasons = evaluateAssertions(blankButTallPage, [contentNonEmptyAssertion()]);

    expect(reasons[0]).toContain("observed 0 chars and 900px");
  });

  test("passes a page with real content", () => {
    const reasons = evaluateAssertions(buildCorrectDashboard(), [contentNonEmptyAssertion()]);

    expect(reasons).toEqual([]);
  });
});

describe("no-console-errors", () => {
  test("fails and quotes what the page logged", () => {
    const crashedPage = buildDomFacts({
      visibleText: "Dashboard",
      consoleErrors: ["uncaught: t.map is not a function"],
    });

    const reasons = evaluateAssertions(crashedPage, [{ kind: AssertionKind.NoConsoleErrors }]);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("observed 1 console error");
    expect(reasons[0]).toContain("t.map is not a function");
  });

  test("passes a silent page", () => {
    const reasons = evaluateAssertions(buildCorrectDashboard(), [{ kind: AssertionKind.NoConsoleErrors }]);

    expect(reasons).toEqual([]);
  });
});

describe("no-error-boundary", () => {
  test("fails a page that painted error-boundary text", () => {
    const brokenSlot = buildDomFacts({
      visibleText: "Slot rendering crashed",
      errorBoundaryTexts: ["Slot rendering crashed"],
    });

    const reasons = evaluateAssertions(brokenSlot, [{ kind: AssertionKind.NoErrorBoundary }]);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("Slot rendering crashed");
  });

  test("passes a page with no error surface", () => {
    const reasons = evaluateAssertions(buildCorrectDashboard(), [{ kind: AssertionKind.NoErrorBoundary }]);

    expect(reasons).toEqual([]);
  });
});

describe("text-present", () => {
  test("fails when a required value never reached the page, and quotes what did", () => {
    const missingTheNumbers = buildDomFacts({ visibleText: "Revenue by region: North, South, East, West" });

    const reasons = evaluateAssertions(missingTheNumbers, [textPresentAssertion(["North", "1,204"])]);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('missing ["1,204"]');
    expect(reasons[0]).toContain("Revenue by region");
  });

  test("tolerates casing and line wrapping, which are not rendering failures", () => {
    const wrappedPage = buildDomFacts({ visibleText: "ADA\n  LOVELACE\t42" });

    const reasons = evaluateAssertions(wrappedPage, [textPresentAssertion(["Ada Lovelace", "42"])]);

    expect(reasons).toEqual([]);
  });
});

describe("table-rows", () => {
  test("fails a page that prints the required values in SEPARATE rows", () => {
    const scatteredValues = buildDomFacts({
      visibleText: "Ada Lovelace 42 Grace Hopper 37",
      tables: [
        buildTable({
          headerCells: ["Value"],
          dataRows: [["Ada Lovelace"], ["42"], ["Grace Hopper"], ["37"]],
        }),
      ],
    });

    const reasons = evaluateAssertions(scatteredValues, [
      tableRowsAssertion({
        minDataRows: 2,
        requiredRows: [
          ["Ada Lovelace", "42"],
          ["Grace Hopper", "37"],
        ],
      }),
    ]);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("no single table satisfied it");
    expect(reasons[0]).toContain('missing rows [["Ada Lovelace","42"], ["Grace Hopper","37"]]');
  });

  test("passes when each required row's values are cells of the same row", () => {
    const reasons = evaluateAssertions(buildCorrectDashboard(), [
      tableRowsAssertion({
        minDataRows: 3,
        requiredRows: [
          ["Ada Lovelace", "42"],
          ["Grace Hopper", "37"],
        ],
      }),
    ]);

    expect(reasons).toEqual([]);
  });

  test("fails when the table is too short, and quotes the row count it observed", () => {
    const shortTable = buildDomFacts({
      tables: [buildTable({ headerCells: ["Name", "Deals"], dataRows: [["Ada Lovelace", "42"]] })],
    });

    const reasons = evaluateAssertions(shortTable, [
      tableRowsAssertion({ minDataRows: 5, requiredRows: [["Ada Lovelace", "42"]] }),
    ]);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("table 1: 1 data rows, all required rows present");
  });

  test("fails a table of header rows only — headers are not data", () => {
    const headersOnly = buildDomFacts({
      tables: [buildTable({ headerCells: ["Name", "Deals"], dataRows: [] })],
    });

    const reasons = evaluateAssertions(headersOnly, [
      tableRowsAssertion({ minDataRows: 1, requiredRows: [] }),
    ]);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("table 1: 0 data rows");
  });

  test("fails a page with no table at all", () => {
    const reasons = evaluateAssertions(buildDomFacts({ visibleText: "Ada Lovelace 42" }), [
      tableRowsAssertion({ minDataRows: 1, requiredRows: [["Ada Lovelace", "42"]] }),
    ]);

    expect(reasons[0]).toContain("observed 0 tables");
  });
});

describe("charts", () => {
  test("fails an EMPTY chart — axes only — that a spec validator would call valid", () => {
    const emptyChartPage = buildDomFacts({
      visibleText: "Monthly Revenue",
      svgs: [
        buildSvg({
          dataPointCount: EMPTY_CHART_DATA_POINTS,
          markCountsByTag: { path: 2, line: 12, rect: 0 },
          textLabels: ["Month", "Revenue"],
        }),
        buildSvg({ dataPointCount: 0, markCountsByTag: { path: 0 }, textLabels: [] }),
      ],
    });

    const reasons = evaluateAssertions(emptyChartPage, [chartsAssertion({ requiredAxisLabels: ["Month"] })]);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("expected >=1 chart(s) with >=7 data points");
    expect(reasons[0]).toContain("observed 0 qualifying of 2 svg(s)");
    expect(reasons[0]).toContain("dataPointCounts [2, 0]");
  });

  test("fails an icon-sized svg that paints a couple of paths", () => {
    const iconOnlyPage = buildDomFacts({
      svgs: [buildSvg({ dataPointCount: 1, markCountsByTag: { path: 1 }, textLabels: [] })],
    });

    const reasons = evaluateAssertions(iconOnlyPage, [chartsAssertion({ requiredAxisLabels: [] })]);

    expect(reasons[0]).toContain("dataPointCounts [1]");
  });

  test("fails a chart that plotted the data but never bound the axis", () => {
    const unlabelledChart = buildDomFacts({
      svgs: [
        buildSvg({
          dataPointCount: REQUIRED_CHART_DATA_POINTS,
          markCountsByTag: { rect: 7 },
          textLabels: ["0", "50", "100"],
        }),
      ],
    });

    const reasons = evaluateAssertions(unlabelledChart, [
      chartsAssertion({ requiredAxisLabels: ["Month", "Revenue"] }),
    ]);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('missing axis label(s) ["Month", "Revenue"]');
    expect(reasons[0]).toContain('observed labels ["0", "50", "100"]');
  });

  test("ignores axis labels painted by a chart that does not qualify", () => {
    const labelsOnTheEmptyChart = buildDomFacts({
      svgs: [
        buildSvg({ dataPointCount: EMPTY_CHART_DATA_POINTS, markCountsByTag: {}, textLabels: ["Month", "Revenue"] }),
        buildSvg({ dataPointCount: REQUIRED_CHART_DATA_POINTS, markCountsByTag: { rect: 7 }, textLabels: [] }),
      ],
    });

    const reasons = evaluateAssertions(labelsOnTheEmptyChart, [
      chartsAssertion({ requiredAxisLabels: ["Month"] }),
    ]);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('missing axis label(s) ["Month"]');
  });

  test("passes a chart that plotted every point and labelled its axes", () => {
    const reasons = evaluateAssertions(buildCorrectDashboard(), [
      chartsAssertion({ requiredAxisLabels: ["Month", "Revenue"] }),
    ]);

    expect(reasons).toEqual([]);
  });
});

describe("diagram-svg", () => {
  test("fails a diagram whose 'connectors' are axis-style <line> elements", () => {
    const linesOnlyDiagram = buildDomFacts({
      svgs: [
        buildSvg({
          dataPointCount: 0,
          markCountsByTag: { line: 6, path: 0, polyline: 0, polygon: 0 },
          textLabels: ["Client", "Server", "Database"],
        }),
      ],
    });

    const reasons = evaluateAssertions(linesOnlyDiagram, [diagramSvgAssertion({ minConnectorMarks: 2 })]);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("expected >=2 connector marks (path/polyline/polygon)");
    expect(reasons[0]).toContain("observed [0]");
  });

  test("fails when no single svg carries all the node labels", () => {
    const labelsSplitAcrossSvgs = buildDomFacts({
      svgs: [
        buildSvg({ dataPointCount: 0, markCountsByTag: { path: 4 }, textLabels: ["Client"] }),
        buildSvg({ dataPointCount: 0, markCountsByTag: { path: 4 }, textLabels: ["Server", "Database"] }),
      ],
    });

    const reasons = evaluateAssertions(labelsSplitAcrossSvgs, [diagramSvgAssertion({ minConnectorMarks: 2 })]);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("no svg painted all node labels");
    expect(reasons[0]).toContain('svg 1: ["Client"]');
    expect(reasons[0]).toContain('svg 2: ["Server", "Database"]');
  });

  test("passes a diagram with the node labels and real connectors", () => {
    const reasons = evaluateAssertions(buildCorrectDashboard(), [diagramSvgAssertion({ minConnectorMarks: 3 })]);

    expect(reasons).toEqual([]);
  });
});

describe("form-inputs", () => {
  test("fails when a required field was never rendered, and quotes the labels that were", () => {
    const missingEmailField = buildDomFacts({
      inputs: [buildInput({ labelText: "Full name", type: "text", required: true })],
      buttonTexts: ["Create account"],
    });

    const reasons = evaluateAssertions(missingEmailField, [formInputsAssertion()]);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('no input labelled "Email"');
    expect(reasons[0]).toContain('observed labels ["Full name"]');
  });

  test("fails a field rendered with the wrong DOM type", () => {
    const untypedFields = buildDomFacts({
      inputs: [
        buildInput({ labelText: "Email address", type: "text" }),
        buildInput({ labelText: "Password", type: "text" }),
      ],
      buttonTexts: ["Create account"],
    });

    const reasons = evaluateAssertions(untypedFields, [formInputsAssertion()]);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('input labelled "Email" is not type="email"');
    expect(reasons[0]).toContain('input labelled "Password" is not type="password"');
    expect(reasons[0]).toContain('observed <input type="text">');
  });

  test("does not score native required/minlength markup — that is one arm's dialect", () => {
    const noNativeConstraints = buildDomFacts({
      inputs: [
        buildInput({ labelText: "Email address", type: "email" }),
        buildInput({ labelText: "Password", type: "password" }),
      ],
      buttonTexts: ["Create account"],
    });

    const reasons = evaluateAssertions(noNativeConstraints, [formInputsAssertion()]);

    expect(reasons).toEqual([]);
  });

  test("fails when the submit button is missing, and quotes the buttons that exist", () => {
    const noSubmitButton = buildDomFacts({
      inputs: buildValidFormInputs(),
      buttonTexts: ["Cancel"],
    });

    const reasons = evaluateAssertions(noSubmitButton, [formInputsAssertion()]);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('no button matching "Create account"');
    expect(reasons[0]).toContain('observed buttons ["Cancel"]');
  });

  test("passes a form whose labels are a superset of the required ones", () => {
    const reasons = evaluateAssertions(buildCorrectDashboard(), [formInputsAssertion()]);

    expect(reasons).toEqual([]);
  });
});

describe("form-validation", () => {
  test("fails a form that silently ACCEPTED the nonsense we typed into it", () => {
    const permissiveForm = buildDomFacts({
      inputs: buildValidFormInputs(),
      buttonTexts: ["Create account"],
      formValidation: buildFormValidation({
        fields: [
          buildFieldRejection({ label: "Email", refusedBy: "nothing" }),
          buildFieldRejection({ label: "Password", refusedBy: "nothing" }),
        ],
        errorMessages: [],
      }),
    });

    const reasons = evaluateAssertions(permissiveForm, [formValidationAssertion()]);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("silently ACCEPTED invalid input");
    expect(reasons[0]).toContain('["Email", "Password"]');
  });

  test("fails when only SOME of the corrupted fields were refused", () => {
    const halfValidatingForm = buildDomFacts({
      formValidation: buildFormValidation({
        fields: [
          buildFieldRejection({ label: "Email", refusedBy: "native" }),
          buildFieldRejection({ label: "Password", refusedBy: "nothing" }),
        ],
        errorMessages: ["Please enter a valid email"],
      }),
    });

    const reasons = evaluateAssertions(halfValidatingForm, [formValidationAssertion()]);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('["Password"]');
    expect(reasons[0]).toContain('["Please enter a valid email"]');
  });

  test("accepts ANY legible refusal — native, aria-invalid, or a message", () => {
    const eachArmRefusesDifferently = buildDomFacts({
      formValidation: buildFormValidation({
        fields: [
          buildFieldRejection({ label: "Email", refusedBy: "native" }),
          buildFieldRejection({ label: "Password", refusedBy: "aria" }),
          buildFieldRejection({ label: "Name", refusedBy: "message" }),
        ],
        errorMessages: ["Name is required"],
      }),
    });

    const reasons = evaluateAssertions(eachArmRefusesDifferently, [formValidationAssertion()]);

    expect(reasons).toEqual([]);
  });

  test("fails, rather than passes, when a named field was never found to type into", () => {
    const missingField = buildDomFacts({
      formValidation: buildFormValidation({
        fields: [{ label: "Password", found: false, nativeInvalid: false, ariaInvalid: false, messaged: false }],
        errorMessages: [],
      }),
    });

    const reasons = evaluateAssertions(missingField, [formValidationAssertion()]);

    expect(reasons[0]).toContain('could not find field(s) ["Password"]');
  });

  test("fails loudly when the driver never ran the interaction — a harness fault is not a pass", () => {
    const neverInteracted = buildDomFacts({ formValidation: null });

    const reasons = evaluateAssertions(neverInteracted, [formValidationAssertion()]);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("the invalid-submit interaction never ran");
  });
});

describe("charts", () => {
  test("explains a chart failure caused by painting into a bitmap <canvas>", () => {
    const bitmapChartPage = buildDomFacts({
      visibleText: "Monthly Revenue",
      svgs: [],
      canvasCount: 1,
    });

    const reasons = evaluateAssertions(bitmapChartPage, [chartsAssertion({ requiredAxisLabels: [] })]);

    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("the page painted 1 <canvas> element(s)");
  });
});

describe("a correct dashboard", () => {
  test("passes every assertion in the rubric at once", () => {
    const wholeRubric: Assertion[] = [
      contentNonEmptyAssertion(),
      { kind: AssertionKind.NoConsoleErrors },
      { kind: AssertionKind.NoErrorBoundary },
      textPresentAssertion(["Ada Lovelace", "42", "Q3 Revenue"]),
      tableRowsAssertion({ minDataRows: 3, requiredRows: [["Ada Lovelace", "42"]] }),
      chartsAssertion({ requiredAxisLabels: ["Month", "Revenue"] }),
      diagramSvgAssertion({ minConnectorMarks: 3 }),
      formInputsAssertion(),
    ];

    const result = evaluateAssertions(buildCorrectDashboard(), wholeRubric);

    expect(result).toEqual([]);
  });

  test("reports one reason per failed assertion, not one per problem", () => {
    const brokenPage = buildDomFacts({
      visibleText: "Q3 Revenue Dashboard",
      consoleErrors: ["uncaught: t.map is not a function"],
    });

    const reasons = evaluateAssertions(brokenPage, [
      contentNonEmptyAssertion(),
      { kind: AssertionKind.NoConsoleErrors },
      chartsAssertion({ requiredAxisLabels: ["Month"] }),
    ]);

    expect(reasons).toHaveLength(3);
  });
});

// ---- assertion fixtures ----

function contentNonEmptyAssertion(): Assertion {
  return {
    kind: AssertionKind.ContentNonEmpty,
    minVisibleTextLength: MIN_DASHBOARD_TEXT_CHARS,
    minContentHeightPx: MIN_DASHBOARD_HEIGHT_PX,
  };
}

function textPresentAssertion(values: string[]): Assertion {
  return { kind: AssertionKind.TextPresent, description: "source values", values };
}

function tableRowsAssertion(input: { minDataRows: number; requiredRows: string[][] }): Assertion {
  return { kind: AssertionKind.TableRows, description: "rep leaderboard", ...input };
}

function chartsAssertion(input: { requiredAxisLabels: string[] }): Assertion {
  return {
    kind: AssertionKind.Charts,
    description: "monthly revenue",
    minCharts: 1,
    minDataPointsPerChart: REQUIRED_CHART_DATA_POINTS,
    ...input,
  };
}

function diagramSvgAssertion(input: { minConnectorMarks: number }): Assertion {
  return {
    kind: AssertionKind.DiagramSvg,
    description: "request flow",
    requiredNodeLabels: ["Client", "Server", "Database"],
    ...input,
  };
}

function formInputsAssertion(): Assertion {
  return {
    kind: AssertionKind.FormInputs,
    description: "signup form",
    requiredInputs: [
      { label: "Email", type: "email" },
      { label: "Password", type: "password" },
    ],
    submitButtonText: "Create account",
  };
}

function formValidationAssertion(): Assertion {
  return {
    kind: AssertionKind.FormValidation,
    description: "signup form refuses bad input",
    invalidFills: [
      { label: "Email", value: "not-an-email" },
      { label: "Password", value: "abc" },
    ],
    submitButtonText: "Create account",
  };
}

// ---- DomFacts fixtures ----

function buildCorrectDashboard(): DomFacts {
  return buildDomFacts({
    visibleText:
      "Q3 Revenue Dashboard. Top reps: Ada Lovelace 42, Grace Hopper 37, Alan Turing 31. " +
      "Monthly revenue is up 12% quarter over quarter across every region we sell into.",
    contentHeightPx: 1240,
    tables: [
      buildTable({
        headerCells: ["Name", "Deals"],
        dataRows: [
          ["Ada Lovelace", "42"],
          ["Grace Hopper", "37"],
          ["Alan Turing", "31"],
        ],
      }),
    ],
    svgs: [
      buildSvg({
        dataPointCount: REQUIRED_CHART_DATA_POINTS,
        markCountsByTag: { rect: 7, line: 10, path: 2 },
        textLabels: ["Jan", "Feb", "Mar", "Month", "Revenue ($k)"],
        heightPx: 320,
      }),
      buildSvg({
        dataPointCount: 4,
        markCountsByTag: { path: 4, rect: 3, line: 0 },
        textLabels: ["Client", "Server", "Database"],
        heightPx: 260,
      }),
    ],
    inputs: buildValidFormInputs(),
    buttonTexts: ["Cancel", "Create account"],
  });
}

function buildValidFormInputs(): InputFacts[] {
  return [
    buildInput({ labelText: "Email address", type: "email" }),
    buildInput({ labelText: "Password", type: "password" }),
  ];
}

const REFUSAL_MODE = {
  Native: "native",
  Aria: "aria",
  Message: "message",
  Nothing: "nothing",
} as const;

type RefusalMode = (typeof REFUSAL_MODE)[keyof typeof REFUSAL_MODE];

function buildFieldRejection(input: { label: string; refusedBy: RefusalMode }): FieldRejection {
  return {
    label: input.label,
    found: true,
    nativeInvalid: input.refusedBy === REFUSAL_MODE.Native,
    ariaInvalid: input.refusedBy === REFUSAL_MODE.Aria,
    messaged: input.refusedBy === REFUSAL_MODE.Message,
  };
}

function buildDomFacts(overrides: Partial<DomFacts> = {}): DomFacts {
  const facts: DomFacts = {
    visibleText: "",
    visibleTextLength: 0,
    contentHeightPx: 0,
    tables: [],
    svgs: [],
    canvasCount: 0,
    inputs: [],
    buttonTexts: [],
    consoleErrors: [],
    errorBoundaryTexts: [],
    formValidation: null,
    ...overrides,
  };

  // Derived exactly as the in-page probe derives it, so no fixture can claim a
  // text length its own text does not support.
  return { ...facts, visibleTextLength: countVisibleChars(facts.visibleText) };
}

function countVisibleChars(text: string): number {
  return text.replace(/\s/g, "").length;
}

function buildTable(input: { headerCells: string[]; dataRows: string[][] }): TableFacts {
  return {
    dataRowCount: input.dataRows.length,
    rows: [input.headerCells, ...input.dataRows],
    headerCells: input.headerCells,
  };
}

function buildSvg(input: {
  dataPointCount: number;
  markCountsByTag: Record<string, number>;
  textLabels: string[];
  heightPx?: number;
}): SvgFacts {
  return {
    markCountsByTag: input.markCountsByTag,
    dataPointCount: input.dataPointCount,
    textLabels: input.textLabels,
    heightPx: input.heightPx ?? 300,
  };
}

function buildInput(input: { labelText: string; type: string }): InputFacts {
  return {
    tag: "input",
    type: input.type,
    name: "",
    id: "",
    required: false,
    minLength: null,
    pattern: null,
    labelText: input.labelText,
  };
}
