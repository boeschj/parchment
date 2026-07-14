// Renders the component surface into the reference text an arm's system prompt
// carries, parameterised by (Vocabulary, Fidelity, Notation).
//
// EVERY identifier is emitted through the Vocabulary. Nothing here hardcodes a
// component or prop name — not in the grammar bullets, not in the examples — so
// the scrambled prompt is the real prompt with the identifiers swapped and not
// one word else. That property is what the ablation rests on, and surface.test.ts
// enforces it.
//
// EVERY FACT is read off the product (vocabulary.ts explains how): which props
// exist, which are required, what values they take, what a reference hydrates,
// what buckets a log takes. This module only decides how to SAY them.
//
// The harness measures real token counts; these functions just return the text.

import { Fidelity } from "../types.ts";
import { textContentPropOf } from "../../src/daemon/markup/conventions.ts";
import {
  BUCKET_SYNTAX_PLACEHOLDER,
  COMPONENT_SURFACE,
  DOCUMENTED_COMPONENTS,
  HYDRATED_PROPS_PLACEHOLDER,
  LOG_BUCKET_SYNTAX,
  REFERENCE_SURFACE,
  STANDALONE_REFERENCE_COMPONENTS,
  STRUCTURAL_TAGS,
  STRUCTURAL_TAG_SURFACE,
  SURFACE_COMPONENTS,
  acceptsChildrenIn,
  compilesToOf,
  documentedPropNamesOf,
  hydratedPropsOf,
  isRequiredProp,
  isStandaloneReference,
  layeredReferenceFor,
  notationOf,
  standaloneAttrMeaningOf,
  standaloneReferenceAttrsOf,
  takesCompiledPropType,
  type DocumentedComponentName,
  type ExampleValue,
  type StandaloneReferenceName,
  type SurfaceComponentName,
  type Vocabulary,
} from "./vocabulary.ts";

export const Notation = {
  Markup: "markup",
  Json: "json",
  TerseJson: "terse-json",
} as const;

export type Notation = (typeof Notation)[keyof typeof Notation];

export type SurfaceReferenceInput = {
  readonly vocabulary: Vocabulary;
  readonly fidelity: Fidelity;
  readonly notation: Notation;
};

const SECTION_SEPARATOR = "\n\n";
const CHILDREN_PLACEHOLDER_MARKUP = "…";
const CHILD_KEY_PLACEHOLDER = "b";
const ROOT_KEY_PLACEHOLDER = "a";
const EXAMPLE_PREFIX = "  e.g. ";
const PROP_INDENT = "  ";
const NOTE_INDENT = "  ";
const NOTATION_SEPARATOR = " — ";
const UNTYPED_NOTATION = "any";

export function renderSurfaceReference(input: SurfaceReferenceInput): string {
  const sections = [
    renderGrammarSection(input),
    renderContentSection(input),
    ...renderReferenceExpressionSection(input),
    renderComponentSection(input),
    ...renderStructuralTagSection(input),
  ];
  return sections.join(SECTION_SEPARATOR);
}

// The two notations reach the SAME reference grammar by different doors, and each
// arm is shown the door it actually has.
//
//   markup: sugar — <GitDiff file=…/>, <DataTable src=…/>. The compiler lowers
//     them into the expressions below, so they are documented as tags and props.
//   json/terse: the expressions themselves, which is what the shipped spec
//     grammar takes (src/shared/expressions.ts). Documenting `src` as a DataTable
//     PROP here would be a lie the validator rejects — the model would author a
//     prop that does not exist and lose a run it never had a chance at.
function usesMarkupReferenceSugar(input: SurfaceReferenceInput): boolean {
  return input.notation === Notation.Markup;
}

function showsLadder(input: SurfaceReferenceInput): boolean {
  return input.fidelity === Fidelity.High;
}

// ---- Grammar ----------------------------------------------------------------

function renderGrammarSection(input: SurfaceReferenceInput): string {
  if (input.notation === Notation.Markup) return renderMarkupGrammar(input.vocabulary);
  if (input.notation === Notation.Json) return renderJsonGrammar(input.vocabulary);
  return renderTerseJsonGrammar(input.vocabulary);
}

function renderMarkupGrammar(vocabulary: Vocabulary): string {
  const lines = [
    "# Rendering",
    "",
    "Call the canvas_render tool with { title, markup }. `markup` is one HTML-flavoured",
    "document. It is compiled to a render spec; it is never executed.",
    "",
    "# Grammar",
    "",
    "- An element is one of the components below, written as a tag: self-closing when it",
    "  takes no children, paired when it does.",
    "- A prop marked (content) is written between the tags instead of as an attribute.",
    "- An attribute whose value starts with [ or { is parsed as JSON. Quote it with single",
    `  quotes: ${renderJsonAttributeExample(vocabulary)}`,
    "- A number prop takes a bare number. A boolean prop is true when present with no value,",
    '  and false when written ="false".',
    "- Seed any two-way state once, at the top level: <state>{\"form\": {}}</state>.",
    "- On a form field, bind=\"/form/email\" two-way binds its value, and required or",
    '  minlength="8" add validation. On a button, submit="signup" submits the bound state.',
    "- <script> and <style> are rejected.",
  ];
  return lines.join("\n");
}

function renderJsonAttributeExample(vocabulary: Vocabulary): string {
  const chartData = vocabulary.propName("Chart", "data");
  return `${chartData}='[{"day":"Mon","errors":12}]'`;
}

function renderJsonGrammar(vocabulary: Vocabulary): string {
  const lines = [
    "# Rendering",
    "",
    "Call the canvas_render tool with { title, spec }. `spec` is a FLAT element map:",
    "",
    `  ${renderSpecSkeleton(vocabulary, Notation.Json)}`,
    "",
    "# Grammar",
    "",
    '- Every element is addressed by a key of your choosing. "root" names the outermost one.',
    '- "children" is an array of KEYS, never nested objects. Omit it for components that take none.',
    '- "props" carries the component\'s props exactly as documented below.',
    '- "state" seeds any two-way bindings once, at the top level.',
  ];
  return lines.join("\n");
}

function renderTerseJsonGrammar(vocabulary: Vocabulary): string {
  const lines = [
    "# Rendering",
    "",
    "Call the canvas_render tool with { title, spec }. `spec` is a FLAT element map with",
    "single-letter structural keys:",
    "",
    `  ${renderSpecSkeleton(vocabulary, Notation.TerseJson)}`,
    "",
    "# Grammar",
    "",
    '- r = root key, e = elements, t = type, p = props, c = children, s = seeded state.',
    '- Element keys are yours to choose; keep them to one or two characters.',
    '- Omit "p" when a component takes no props, and "c" when it takes no children.',
    "- Component and prop names are never abbreviated — only the structural keys are short.",
  ];
  return lines.join("\n");
}

// The spec's shape, shown with two real components so the model sees the wiring
// rather than a placeholder grammar.
function renderSpecSkeleton(vocabulary: Vocabulary, notation: Notation): string {
  const card = vocabulary.componentName("Card");
  const heading = vocabulary.componentName("Heading");
  const cardTitle = vocabulary.propName("Card", "title");
  const headingText = vocabulary.propName("Heading", "text");

  if (notation === Notation.TerseJson) {
    return (
      `{"r":"${ROOT_KEY_PLACEHOLDER}","e":{` +
      `"${ROOT_KEY_PLACEHOLDER}":{"t":"${card}","p":{"${cardTitle}":"Latency"},"c":["${CHILD_KEY_PLACEHOLDER}"]},` +
      `"${CHILD_KEY_PLACEHOLDER}":{"t":"${heading}","p":{"${headingText}":"Error budget"}}}}`
    );
  }
  return (
    `{"root":"${ROOT_KEY_PLACEHOLDER}","elements":{` +
    `"${ROOT_KEY_PLACEHOLDER}":{"type":"${card}","props":{"${cardTitle}":"Latency"},"children":["${CHILD_KEY_PLACEHOLDER}"]},` +
    `"${CHILD_KEY_PLACEHOLDER}":{"type":"${heading}","props":{"${headingText}":"Error budget"}}}}`
  );
}

// ---- Content / the fidelity rung --------------------------------------------

function renderContentSection(input: SurfaceReferenceInput): string {
  if (!showsLadder(input)) return LOW_FIDELITY_CONTENT_SECTION;
  if (usesMarkupReferenceSugar(input)) return HIGH_FIDELITY_MARKUP_CONTENT_SECTION;
  return HIGH_FIDELITY_SPEC_CONTENT_SECTION;
}

const LOW_FIDELITY_CONTENT_SECTION = [
  "# Content",
  "",
  "The renderer cannot read your filesystem, and there is no way to point a component at",
  "a file. Every byte you want on the page must be present in what you author: paste the",
  "file contents, the code, the rows, and the data points inline.",
].join("\n");

const HIGH_FIDELITY_MARKUP_CONTENT_SECTION = [
  "# Content",
  "",
  "You can either paste content inline, or hand the daemon a path and let it fetch the",
  "bytes for you. Props marked (reference) take a path or a revision; the daemon reads it",
  "at render time and fills the props named in the note beneath — omit those when you use",
  "a reference. Props marked (required unless referenced) must be present otherwise.",
].join("\n");

const HIGH_FIDELITY_SPEC_CONTENT_SECTION = [
  "# Content",
  "",
  "You can either paste content inline, or hand the daemon a path and let it fetch the",
  "bytes for you. A prop's VALUE may be a reference object naming a file (see References",
  "below); the daemon reads it at render time and fills that prop, plus the props listed",
  "beside it — omit those when you use a reference. Props marked (required unless",
  "referenced) must be present otherwise.",
].join("\n");

// ---- References (the spec notations' door onto the ladder) --------------------
//
// The shipped expression grammar, rendered from the product's own tables. A JSON
// arm authors these directly; the markup dialect sugars them into tags, which is
// why this section is markup's alternative rather than its companion.

function renderReferenceExpressionSection(input: SurfaceReferenceInput): readonly string[] {
  if (!showsLadder(input)) return [];
  if (usesMarkupReferenceSugar(input)) return [];

  const { vocabulary } = input;
  const lines = REFERENCE_EXPRESSIONS.map((expression) =>
    renderReferenceExpressionLine(expression, vocabulary),
  );

  return [
    [
      "# References",
      "",
      "A prop's value may NAME a file instead of carrying it. The daemon reads it at render",
      "time, fills that prop, and fills the props listed after it — omit all of them.",
      "",
      ...lines,
      "",
      `A ${vocabulary.componentName("DiffViewer")} takes its reference at the ELEMENT level, because a diff has two sides:`,
      `  ${renderElementLevelDiffExample(vocabulary)}`,
      `  fills ${joinWithAnd(hydratedPropsOf("GitDiff").map((prop) => vocabulary.propName("DiffViewer", prop)))} — you never emit a line of the file.`,
    ].join("\n"),
  ];
}

type ReferenceExpressionDoc = {
  readonly expression: string;
  readonly component: SurfaceComponentName;
  readonly fills: string;
  readonly supplies: readonly string[];
};

// Each entry is the product's grammar (src/shared/expressions.ts) aimed at a
// component this prompt documents. `fills` and `supplies` are read off the same
// tables the hydrator and the validator read, via hydratedPropsOf.
const REFERENCE_EXPRESSIONS: readonly ReferenceExpressionDoc[] = [
  {
    expression: '{"$file": "src/a.ts", "lines": "40-80"}',
    component: "CodeBlock",
    fills: "code",
    supplies: [],
  },
  {
    expression: '{"$csv": "data/x.csv"}',
    component: "DataTable",
    fills: "rows",
    supplies: ["columns"],
  },
  {
    expression: '{"$log": "app.log", "groupBy": "10m", "match": "ERROR"}',
    component: "Chart",
    fills: "data",
    supplies: ["x", "y"],
  },
];

function renderReferenceExpressionLine(
  doc: ReferenceExpressionDoc,
  vocabulary: Vocabulary,
): string {
  const component = vocabulary.componentName(doc.component);
  const filled = vocabulary.propName(doc.component, doc.fills);
  const alsoFilled = doc.supplies.map((prop) => vocabulary.propName(doc.component, prop));
  const beside = alsoFilled.length === 0 ? "" : `, and its ${joinWithAnd(alsoFilled)}`;
  return `${PROP_INDENT}${doc.expression} — as ${component}.${filled}${beside}.`;
}

function renderElementLevelDiffExample(vocabulary: Vocabulary): string {
  const type = vocabulary.componentName("DiffViewer");
  return `{"type": "${type}", "props": {"$diff": "src/a.ts", "base": "HEAD~1"}}`;
}

// ---- Components --------------------------------------------------------------

function renderComponentSection(input: SurfaceReferenceInput): string {
  const blocks = componentsFor(input).map((component) => renderComponentBlock(component, input));
  return ["# Components", "", ...blocks].join("\n");
}

// <GitDiff> and <LogStream> are MARKUP tags: the compiler lowers them, and no
// such component exists in the spec grammar. A spec arm reaches the same rung
// through the reference expressions above, so showing it a tag it cannot author
// would be documenting a component the validator rejects.
export function componentsFor(input: SurfaceReferenceInput): readonly DocumentedComponentName[] {
  if (showsLadder(input) && usesMarkupReferenceSugar(input)) return DOCUMENTED_COMPONENTS;
  return SURFACE_COMPONENTS;
}

function renderComponentBlock(
  component: DocumentedComponentName,
  input: SurfaceReferenceInput,
): string {
  if (isStandaloneReference(component)) {
    return renderStandaloneReferenceBlock(component, input);
  }
  return renderSurfaceComponentBlock(component, input);
}

function renderSurfaceComponentBlock(
  component: SurfaceComponentName,
  input: SurfaceReferenceInput,
): string {
  const spec = COMPONENT_SURFACE[component];
  const { vocabulary, notation } = input;
  const layered = layeredReferenceFor(component);
  // The reference ATTRIBUTES (src=, file=) are markup sugar. A spec arm was shown
  // the expression form instead — but it reaches the same hydrated props, so it
  // still needs to be told which of them the daemon fills.
  const showsAttrs = showsLadder(input) && usesMarkupReferenceSugar(input) && layered !== null;
  const hydratedProps = showsLadder(input) && layered !== null ? hydratedPropsOf(component) : [];

  const headline = `${vocabulary.componentName(component)} — ${spec.purpose}`;

  const surfacePropLines = Object.entries(spec.props).map(([prop, meaning]) =>
    renderPropLine({
      component,
      prop,
      meaning,
      notationText: notationOf(component, prop),
      vocabulary,
      notation,
      label: surfacePropLabel(component, prop, hydratedProps),
    }),
  );

  const referencePropLines =
    showsAttrs && layered !== null
      ? Object.entries(layered.attrs).map(([prop, meaning]) =>
          renderPropLine({
            component,
            prop,
            meaning,
            notationText: null,
            vocabulary,
            notation,
            label: PropLabel.Reference,
          }),
        )
      : [];

  const hydrationNoteLines =
    showsAttrs && layered !== null
      ? [`${NOTE_INDENT}${renderHydrationNote(layered.hydrationNote, component, hydratedProps, vocabulary)}`]
      : [];

  const inlineExample = renderExample(component, spec.example, input);
  const referenceExample =
    showsAttrs && layered !== null ? [renderExample(component, layered.example, input)] : [];

  return [
    headline,
    ...surfacePropLines,
    ...referencePropLines,
    ...hydrationNoteLines,
    inlineExample,
    ...referenceExample,
    "",
  ].join("\n");
}

function renderStandaloneReferenceBlock(
  component: StandaloneReferenceName,
  input: SurfaceReferenceInput,
): string {
  const spec = REFERENCE_SURFACE[component];
  const { vocabulary, notation } = input;
  const compilesTo = compilesToOf(component);

  const headline = `${vocabulary.componentName(component)} — ${spec.purpose}`;
  const propLines = standaloneReferenceAttrsOf(component).map((attr) =>
    renderPropLine({
      component,
      prop: attr,
      meaning: withBucketSyntax(standaloneAttrMeaningOf(component, attr)),
      notationText: standaloneAttrNotation(component, compilesTo, attr),
      vocabulary,
      notation,
      label: standaloneAttrLabel(component, attr),
    }),
  );
  const example = renderExample(component, spec.example, input);

  return [headline, ...propLines, example, ""].join("\n");
}

// `file` is the one attribute a reference tag cannot do without: it is the whole
// point of the tag.
const REFERENCE_PATH_ATTR = "file";

// A <LogStream> without a bucket is a live tail, not a chart — the compiler says
// so, and rejects an aggregation without one. The prompt must say so too, or the
// model cannot tell which of the two it is asking for.
const LOG_BUCKET_ATTR = "groupBy";

function standaloneAttrLabel(component: StandaloneReferenceName, attr: string): string | null {
  if (attr === REFERENCE_PATH_ATTR) return PropLabel.Required;
  if (component === "LogStream" && attr === LOG_BUCKET_ATTR) return PropLabel.Required;
  return null;
}

// An attribute the grammar table leaves untyped is a real prop of the component
// this tag compiles to, so its accepted values come from THAT schema. The rest
// are reference-only (a path, a flag, a duration) and their sentence says it.
function standaloneAttrNotation(
  component: StandaloneReferenceName,
  compilesTo: string,
  attr: string,
): string | null {
  if (!takesCompiledPropType(component, attr)) return null;
  const notationText = notationOf(compilesTo as SurfaceComponentName, attr);
  if (notationText === UNTYPED_NOTATION) return null;
  return notationText;
}

function withBucketSyntax(meaning: string): string {
  return meaning.replace(BUCKET_SYNTAX_PLACEHOLDER, LOG_BUCKET_SYNTAX);
}

// ---- Prop lines --------------------------------------------------------------

const PropLabel = {
  Required: "required",
  RequiredUnlessReferenced: "required unless referenced",
  Reference: "reference",
  Content: "content",
} as const;

type PropLineInput = {
  readonly component: DocumentedComponentName;
  readonly prop: string;
  readonly meaning: string;
  // The accepted values, from the schema. Null when the attribute has no schema
  // (a reference path is a path).
  readonly notationText: string | null;
  readonly vocabulary: Vocabulary;
  readonly notation: Notation;
  readonly label: string | null;
};

function renderPropLine(input: PropLineInput): string {
  const { component, prop, meaning, notationText, vocabulary, notation, label } = input;
  const name = vocabulary.propName(component, prop);
  const labels = [label, contentLabelFor(component, prop, notation)].filter(isPresent);
  const suffix = labels.length > 0 ? ` (${labels.join(", ")})` : "";
  const described = notationText === null ? meaning : `${notationText}${NOTATION_SEPARATOR}${meaning}`;
  return `${PROP_INDENT}${name}${suffix}: ${described}`;
}

function isPresent(label: string | null): label is string {
  return label !== null;
}

// Required-ness is the CONTRACT's, never this file's. A prop the daemon requires
// and the prompt calls optional is a loss the arm did not earn; the reverse is a
// tax it did not owe.
function surfacePropLabel(
  component: SurfaceComponentName,
  prop: string,
  hydratedProps: readonly string[],
): string | null {
  const required = isRequiredProp(component, prop);
  const isHydrated = hydratedProps.includes(prop);
  if (isHydrated && required) return PropLabel.RequiredUnlessReferenced;
  if (isHydrated) return null;
  if (required) return PropLabel.Required;
  return null;
}

// Only the markup dialect has a text-content position; in the spec notations every
// prop is just a key in "props".
function contentLabelFor(
  component: DocumentedComponentName,
  prop: string,
  notation: Notation,
): string | null {
  if (notation !== Notation.Markup) return null;
  if (textContentPropOf(component) !== prop) return null;
  return PropLabel.Content;
}

function renderHydrationNote(
  note: string,
  component: SurfaceComponentName,
  hydratedProps: readonly string[],
  vocabulary: Vocabulary,
): string {
  const renamed = hydratedProps.map((prop) => vocabulary.propName(component, prop));
  return note.replace(HYDRATED_PROPS_PLACEHOLDER, joinWithAnd(renamed));
}

function joinWithAnd(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  const leading = names.slice(0, -1);
  const last = names[names.length - 1] ?? "";
  return `${leading.join(", ")} and ${last}`;
}

// ---- Examples ----------------------------------------------------------------

function renderExample(
  component: DocumentedComponentName,
  example: Readonly<Record<string, ExampleValue>>,
  input: SurfaceReferenceInput,
): string {
  const rendered =
    input.notation === Notation.Markup
      ? renderMarkupExample(component, example, input.vocabulary)
      : renderSpecExample(component, example, input);
  return `${EXAMPLE_PREFIX}${rendered}`;
}

// The inline example exactly as the prompt embeds it. Exported so the dialect can
// be proved rather than asserted: surface.test.ts feeds these straight to the real
// markup compiler and requires zero issues.
export function inlineMarkupExampleFor(
  component: SurfaceComponentName,
  vocabulary: Vocabulary,
): string {
  return renderMarkupExample(component, COMPONENT_SURFACE[component].example, vocabulary);
}

// The reference example the high-fidelity prompt shows, for the same reason: it
// is fed to the real compiler and must come back clean.
export function referenceMarkupExampleFor(
  component: DocumentedComponentName,
  vocabulary: Vocabulary,
): string | null {
  if (isStandaloneReference(component)) {
    return renderMarkupExample(component, REFERENCE_SURFACE[component].example, vocabulary);
  }
  const layered = layeredReferenceFor(component);
  if (layered === null) return null;
  return renderMarkupExample(component, layered.example, vocabulary);
}

function renderMarkupExample(
  component: DocumentedComponentName,
  example: Readonly<Record<string, ExampleValue>>,
  vocabulary: Vocabulary,
): string {
  const tag = vocabulary.componentName(component);
  const contentProp = textContentPropOf(component);
  const attributeEntries = Object.entries(example).filter(([prop]) => prop !== contentProp);

  const attributes = attributeEntries
    .map(([prop, value]) => renderMarkupAttribute(vocabulary.propName(component, prop), value))
    .filter(isPresent);
  const openingTag = [tag, ...attributes].join(" ");

  const contentValue = contentProp === null ? undefined : example[contentProp];
  if (contentValue !== undefined) {
    return `<${openingTag}>${String(contentValue)}</${tag}>`;
  }
  if (acceptsChildrenIn(component)) {
    return `<${openingTag}>${CHILDREN_PLACEHOLDER_MARKUP}</${tag}>`;
  }
  return `<${openingTag} />`;
}

// Attribute spelling exactly as src/daemon/markup/attributes.ts parses it: JSON
// values single-quoted so their double quotes survive, booleans bare when true.
function renderMarkupAttribute(name: string, value: ExampleValue): string | null {
  if (value === true) return name;
  if (value === false) return `${name}="false"`;
  if (typeof value === "number") return `${name}="${value}"`;
  if (typeof value === "string") return renderMarkupStringAttribute(name, value);
  return `${name}='${JSON.stringify(value)}'`;
}

function renderMarkupStringAttribute(name: string, value: string): string {
  if (value.includes('"')) return `${name}='${value}'`;
  return `${name}="${value}"`;
}

function renderSpecExample(
  component: DocumentedComponentName,
  example: Readonly<Record<string, ExampleValue>>,
  input: SurfaceReferenceInput,
): string {
  const { vocabulary, notation } = input;
  const props: Record<string, ExampleValue> = {};
  for (const [prop, value] of Object.entries(example)) {
    props[vocabulary.propName(component, prop)] = value;
  }

  const type = vocabulary.componentName(component);
  const hasChildren = acceptsChildrenIn(component);

  if (notation === Notation.TerseJson) {
    const terse = {
      t: type,
      p: props,
      ...(hasChildren ? { c: [CHILD_KEY_PLACEHOLDER] } : {}),
    };
    return JSON.stringify(terse);
  }
  const verbose = {
    type,
    props,
    ...(hasChildren ? { children: [CHILD_KEY_PLACEHOLDER] } : {}),
  };
  return JSON.stringify(verbose);
}

// ---- Semantic HTML shortcuts (markup only) -----------------------------------

function renderStructuralTagSection(input: SurfaceReferenceInput): readonly string[] {
  if (input.notation !== Notation.Markup) return [];
  const lines = STRUCTURAL_TAGS.map((tag) => {
    const name = input.vocabulary.tagName(tag);
    return `${PROP_INDENT}<${name}>: ${STRUCTURAL_TAG_SURFACE[tag]}`;
  });
  return [["# Shortcuts", "", ...lines].join("\n")];
}

// Re-exported so the arms can keep importing one module for the whole surface.
export { STANDALONE_REFERENCE_COMPONENTS };
