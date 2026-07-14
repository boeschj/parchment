// The in-page probe: one function, serialized into the browser, run identically
// against every arm's painted content root. It knows nothing about parchment,
// json-render, recharts, or which arm produced the page — it only reads the DOM
// a user's browser actually built.
//
// Everything this function needs must be defined INSIDE it: playwright ships it
// to the page as source text, so it cannot close over imports or module
// constants.

import type { DomFacts } from "./types.ts";

// The in-page half of DomFacts. consoleErrors come from page events rather than
// from the DOM, and formValidation only exists after the driver has actually
// driven the form — both are the driver's to supply.
export type PageDomFacts = Omit<DomFacts, "consoleErrors" | "formValidation">;

export const CONTENT_ROOT_MISSING = "__content_root_missing__";

export function extractPageDomFacts(contentRootSelector: string): PageDomFacts | string {
  const root = document.querySelector(contentRootSelector);
  if (!root) return CONTENT_ROOT_MISSING;

  const textOf = (node: Element): string => (node.textContent ?? "").replace(/\s+/g, " ").trim();

  // ---- error surfaces ----
  // Arm-neutral phrasings plus the two parchment renders that mean "this
  // component did not render": SlotErrorBoundary ("Slot rendering crashed") and
  // MissingComponent ("Missing component: X"). A hand-written HTML page that
  // prints "Something went wrong" fails on exactly the same rule.
  const ERROR_PATTERNS = [
    /slot rendering crashed/i,
    /missing component/i,
    /something went wrong/i,
    /failed to render/i,
    /error rendering/i,
    /unknown component/i,
    /react error/i,
    /minified react error/i,
    /cannot read propert/i,
    /is not a function/i,
    /undefined is not/i,
  ];
  const rootText = textOf(root);
  const errorBoundaryTexts: string[] = [];
  for (const pattern of ERROR_PATTERNS) {
    const match = rootText.match(pattern);
    if (match) errorBoundaryTexts.push(match[0]);
  }

  // ---- painted size ----
  const rootRect = root.getBoundingClientRect();
  // scrollHeight, not the clipped viewport height: a tall dashboard inside an
  // overflow-auto section is still fully painted content.
  const contentHeightPx = Math.max(rootRect.height, (root as HTMLElement).scrollHeight ?? 0);

  const visibleText = ((root as HTMLElement).innerText ?? rootText).replace(/ /g, " ");

  // ---- tables ----
  const tables = Array.from(root.querySelectorAll("table")).map((table) => {
    const rowNodes = Array.from(table.querySelectorAll("tr"));
    const rows = rowNodes.map((row) =>
      Array.from(row.querySelectorAll("td, th")).map((cell) => textOf(cell)),
    );
    const firstRow = rowNodes[0];
    const headerCells = firstRow ? Array.from(firstRow.querySelectorAll("th")).map((cell) => textOf(cell)) : [];
    // A data row is one that carries <td> cells; a header-only <tr> of <th> is
    // not data. This keeps "5 rows" from being satisfied by five header rows.
    const dataRowCount = rowNodes.filter((row) => row.querySelector("td") !== null).length;
    return { dataRowCount, rows, headerCells };
  });

  // ---- svgs ----
  // Vertices in a path's `d`: every drawing command plants at least one point.
  // A 7-point recharts line curve is "M…C…C…C…C…C…C" → 7. A hand-written
  // <polyline points="..."> is counted by coordinate pairs. An axis line is 2.
  const pathVertexCount = (d: string): number => {
    const commands = d.match(/[MLHVCSQTA]/gi);
    return commands ? commands.length : 0;
  };
  const pointsVertexCount = (points: string): number => {
    const pairs = points.trim().split(/\s+/).filter((pair) => pair.length > 0);
    return pairs.length;
  };

  const MARK_TAGS = ["rect", "circle", "path", "polyline", "polygon", "ellipse"];

  const svgs = Array.from(root.querySelectorAll("svg")).map((svg) => {
    const markCountsByTag: Record<string, number> = {};
    for (const tag of MARK_TAGS) {
      markCountsByTag[tag] = svg.querySelectorAll(tag).length;
    }
    // <line> is counted for diagnostics only — never as a data mark, because
    // both arms draw axes and gridlines with it. (Measured: a correct recharts
    // 7-bar chart carries 14 <line> elements of axis ticks and gridlines, and
    // an empty one carries them too — counting them would let a chart pass on
    // its own axes.)
    markCountsByTag["line"] = svg.querySelectorAll("line").length;

    let longestVertexRun = 0;
    for (const path of Array.from(svg.querySelectorAll("path"))) {
      const vertices = pathVertexCount(path.getAttribute("d") ?? "");
      if (vertices > longestVertexRun) longestVertexRun = vertices;
    }
    for (const poly of Array.from(svg.querySelectorAll("polyline, polygon"))) {
      const vertices = pointsVertexCount(poly.getAttribute("points") ?? "");
      if (vertices > longestVertexRun) longestVertexRun = vertices;
    }

    // "How many data points did this chart actually paint?" — under whichever
    // encoding it chose. A renderer picks one of two strategies, and this must
    // be neutral between them or it silently punishes an arm for its drawing
    // style rather than for its data:
    //   ONE MARK PER POINT — 7 bars as 7 <rect> (hand-written svg) or as 7
    //     <path> (recharts v3 draws bars as paths, measured), 7 dots as 7
    //     <circle> (recharts line charts).
    //   ONE MARK, N VERTICES — the whole series as a single <polyline points>
    //     (hand-written) or a single <path d> curve (recharts area/line).
    // Taking the max of both readings scores a correct 7-point chart as 7 under
    // either strategy, and scores an axes-only chart ~0-2 under both.
    const dataPointCount = Math.max(
      markCountsByTag["rect"] ?? 0,
      markCountsByTag["circle"] ?? 0,
      markCountsByTag["path"] ?? 0,
      markCountsByTag["polyline"] ?? 0,
      longestVertexRun,
    );

    // Labels painted inside the chart/diagram: axis ticks, legends, node names.
    //
    // <foreignObject> is not optional here. Mermaid v11 renders flowchart node
    // labels as HTML <div>s inside <foreignObject> rather than as SVG <text>
    // (measured: a correct 3-node diagram paints ZERO <text> elements and three
    // foreignObject labels). Reading only text/tspan scored a perfectly good
    // diagram as "no labels at all" — a rubric artifact that would have failed
    // the arm for the renderer's choice of markup rather than for anything the
    // user could see. <style> is excluded: mermaid injects a stylesheet INTO the
    // svg, and svg.textContent would otherwise return CSS as a "label".
    const labelNodes = Array.from(svg.querySelectorAll("text, tspan, foreignObject"));
    const textLabels = labelNodes
      .map((node) => textOf(node))
      .filter((label) => label.length > 0);

    return {
      markCountsByTag,
      dataPointCount,
      textLabels,
      heightPx: svg.getBoundingClientRect().height,
    };
  });

  // ---- inputs ----
  const labelFor = (input: Element): string => {
    const id = input.getAttribute("id");
    if (id) {
      const explicit = root.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (explicit) return textOf(explicit);
    }
    const wrapping = input.closest("label");
    if (wrapping) return textOf(wrapping);
    const aria = input.getAttribute("aria-label");
    if (aria) return aria;
    const placeholder = input.getAttribute("placeholder");
    if (placeholder) return placeholder;
    const labelledBy = input.getAttribute("aria-labelledby");
    if (labelledBy) {
      const target = root.querySelector(`#${CSS.escape(labelledBy)}`);
      if (target) return textOf(target);
    }
    return "";
  };

  const inputs = Array.from(root.querySelectorAll("input, textarea, select")).map((input) => {
    const minLengthAttr = input.getAttribute("minlength");
    return {
      tag: input.tagName.toLowerCase(),
      type: (input.getAttribute("type") ?? (input.tagName.toLowerCase() === "textarea" ? "textarea" : "text")).toLowerCase(),
      name: input.getAttribute("name") ?? "",
      id: input.getAttribute("id") ?? "",
      required: input.hasAttribute("required") || input.getAttribute("aria-required") === "true",
      minLength: minLengthAttr === null ? null : Number(minLengthAttr),
      pattern: input.getAttribute("pattern"),
      labelText: labelFor(input),
    };
  });

  const buttonTexts = Array.from(root.querySelectorAll("button, input[type=submit]"))
    .map((button) => textOf(button) || button.getAttribute("value") || "")
    .filter((text) => text.length > 0);

  return {
    visibleText,
    visibleTextLength: visibleText.replace(/\s/g, "").length,
    contentHeightPx,
    tables,
    svgs,
    canvasCount: root.querySelectorAll("canvas").length,
    inputs,
    buttonTexts,
    errorBoundaryTexts,
  };
}

// Read after an invalid-submit attempt: did the page refuse the bad input, in
// any legible way? Runs in the page, identically for both arms.
// Takes a single object because playwright serializes this function into the
// page and calls it with exactly one argument.
export function observeFormRejection(input: {
  contentRootSelector: string;
  textBeforeSubmit: string;
  // The fields we corrupted, with the DOM index the probe found them at.
  filledFields: { label: string; fieldIndex: number }[];
}): {
  fields: {
    label: string;
    found: boolean;
    nativeInvalid: boolean;
    ariaInvalid: boolean;
    messaged: boolean;
  }[];
  errorMessages: string[];
} {
  const { contentRootSelector, textBeforeSubmit, filledFields } = input;
  const root = document.querySelector(contentRootSelector);
  if (!root) return { fields: [], errorMessages: [] };

  // Text the page did not show before we pressed submit, that reads like a
  // validation complaint. Native HTML5 validation shows its message in a browser
  // tooltip (never in the DOM) — that path is caught by checkValidity() below;
  // this catches the arms that render their own messages instead.
  const VALIDATION_PHRASES = [
    /required/i,
    /must be/i,
    /at least/i,
    /too short/i,
    /invalid/i,
    /valid email/i,
    /enter a/i,
    /cannot be empty/i,
    /minimum/i,
  ];
  const normalizeText = (text: string): string => text.replace(/\s+/g, " ").trim();
  const textAfter = normalizeText((root as HTMLElement).innerText ?? root.textContent ?? "");
  const before = normalizeText(textBeforeSubmit);
  const addedFragments = textAfter
    .split(/[.\n]/)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 0 && !before.includes(fragment));
  const errorMessages = addedFragments.filter((fragment) =>
    VALIDATION_PHRASES.some((phrase) => phrase.test(fragment)),
  );

  const domFields = Array.from(root.querySelectorAll("input, textarea, select"));

  const fields = filledFields.map((filled) => {
    const field = filled.fieldIndex >= 0 ? domFields[filled.fieldIndex] : undefined;
    if (!field) {
      return { label: filled.label, found: false, nativeInvalid: false, ariaInvalid: false, messaged: false };
    }
    const candidate = field as HTMLInputElement;
    const nativeInvalid =
      typeof candidate.checkValidity === "function" && !candidate.checkValidity();
    const ariaInvalid =
      field.getAttribute("aria-invalid") === "true" || field.getAttribute("data-invalid") === "true";
    // A message names this field if it mentions its label — "Password must be at
    // least 8 characters" refuses the password field specifically.
    const messaged = errorMessages.some((message) =>
      message.toLowerCase().includes(filled.label.toLowerCase()),
    );
    return { label: filled.label, found: true, nativeInvalid, ariaInvalid, messaged };
  });

  return { fields, errorMessages };
}
