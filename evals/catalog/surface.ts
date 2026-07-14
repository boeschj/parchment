// Renders the component surface into the reference text an arm's system prompt
// carries, parameterised by (Vocabulary, Fidelity, Notation).
//
// EVERY identifier is emitted through the Vocabulary. Nothing here hardcodes a
// component or prop name — not in the grammar bullets, not in the examples — so
// the scrambled prompt is the real prompt with the identifiers swapped and not
// one word else. That property is what the ablation rests on, and surface.test.ts
// enforces it.
//
// The harness measures real token counts; these functions just return the text.

import { Fidelity } from "../types.ts";
import { textContentPropOf } from "../vendor/markup/conventions.ts";
import {
  COMPONENT_SURFACE,
  DOCUMENTED_COMPONENTS,
  HYDRATED_PROPS_PLACEHOLDER,
  REFERENCE_SURFACE,
  STANDALONE_REFERENCE_COMPONENTS,
  STRUCTURAL_TAGS,
  STRUCTURAL_TAG_SURFACE,
  SURFACE_COMPONENTS,
  documentedPropNamesOf,
  layeredReferenceFor,
  type DocumentedComponentName,
  type ExampleValue,
  type PropSpec,
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

export function renderSurfaceReference(input: SurfaceReferenceInput): string {
  const sections = [
    renderGrammarSection(input),
    renderContentSection(input.fidelity),
    renderComponentSection(input),
    ...renderStructuralTagSection(input),
  ];
  return sections.join(SECTION_SEPARATOR);
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

function renderContentSection(fidelity: Fidelity): string {
  if (fidelity === Fidelity.High) return HIGH_FIDELITY_CONTENT_SECTION;
  return LOW_FIDELITY_CONTENT_SECTION;
}

const LOW_FIDELITY_CONTENT_SECTION = [
  "# Content",
  "",
  "The renderer cannot read your filesystem, and there is no way to point a component at",
  "a file. Every byte you want on the page must be present in what you author: paste the",
  "file contents, the code, the rows, and the data points inline.",
].join("\n");

const HIGH_FIDELITY_CONTENT_SECTION = [
  "# Content",
  "",
  "You can either paste content inline, or hand the daemon a path and let it fetch the",
  "bytes for you. Props marked (reference) take a path or a revision; the daemon reads it",
  "at render time and fills the props named in the note beneath — omit those when you use",
  "a reference. Props marked (required unless referenced) must be present otherwise.",
].join("\n");

// ---- Components --------------------------------------------------------------

function renderComponentSection(input: SurfaceReferenceInput): string {
  const visibleComponents = componentsFor(input.fidelity);
  const blocks = visibleComponents.map((component) => renderComponentBlock(component, input));
  return ["# Components", "", ...blocks].join("\n");
}

function componentsFor(fidelity: Fidelity): readonly DocumentedComponentName[] {
  if (fidelity === Fidelity.High) return DOCUMENTED_COMPONENTS;
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

function isStandaloneReference(
  component: DocumentedComponentName,
): component is StandaloneReferenceName {
  return (STANDALONE_REFERENCE_COMPONENTS as readonly string[]).includes(component);
}

function renderSurfaceComponentBlock(
  component: SurfaceComponentName,
  input: SurfaceReferenceInput,
): string {
  const spec = COMPONENT_SURFACE[component];
  const { vocabulary, fidelity, notation } = input;
  const layered = layeredReferenceFor(component);
  const showsReference = fidelity === Fidelity.High && layered !== null;
  const hydratedProps = showsReference && layered !== null ? layered.hydratedProps : [];

  const headline = `${vocabulary.componentName(component)} — ${spec.purpose}`;

  const surfacePropLines = Object.entries(spec.props).map(([prop, propSpec]) =>
    renderPropLine({
      component,
      prop,
      propSpec,
      vocabulary,
      notation,
      label: surfacePropLabel(prop, propSpec, hydratedProps),
    }),
  );

  const referencePropLines =
    showsReference && layered !== null
      ? Object.entries(layered.props).map(([prop, propSpec]) =>
          renderPropLine({
            component,
            prop,
            propSpec,
            vocabulary,
            notation,
            label: referencePropLabel(propSpec),
          }),
        )
      : [];

  const hydrationNoteLines =
    showsReference && layered !== null
      ? [`${NOTE_INDENT}${renderHydrationNote(layered.hydrationNote, component, layered.hydratedProps, vocabulary)}`]
      : [];

  const inlineExample = renderExample(component, spec.example, input);
  const referenceExample =
    showsReference && layered !== null ? [renderExample(component, layered.example, input)] : [];

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

  const headline = `${vocabulary.componentName(component)} — ${spec.purpose}`;
  const propLines = Object.entries(spec.props).map(([prop, propSpec]) =>
    renderPropLine({
      component,
      prop,
      propSpec,
      vocabulary,
      notation,
      label: requiredLabel(propSpec),
    }),
  );
  const example = renderExample(component, spec.example, input);

  return [headline, ...propLines, example, ""].join("\n");
}

// ---- Prop lines --------------------------------------------------------------

const PropLabel = {
  Required: "required",
  RequiredUnlessReferenced: "required unless referenced",
  Reference: "reference",
  ReferenceRequired: "reference, required",
  Content: "content",
} as const;

type PropLineInput = {
  readonly component: DocumentedComponentName;
  readonly prop: string;
  readonly propSpec: PropSpec;
  readonly vocabulary: Vocabulary;
  readonly notation: Notation;
  readonly label: string | null;
};

function renderPropLine(input: PropLineInput): string {
  const { component, prop, propSpec, vocabulary, notation, label } = input;
  const name = vocabulary.propName(component, prop);
  const labels = [label, contentLabelFor(component, prop, notation)].filter(isPresent);
  const suffix = labels.length > 0 ? ` (${labels.join(", ")})` : "";
  return `${PROP_INDENT}${name}${suffix}: ${propSpec.meaning}`;
}

function isPresent(label: string | null): label is string {
  return label !== null;
}

function surfacePropLabel(
  prop: string,
  propSpec: PropSpec,
  hydratedProps: readonly string[],
): string | null {
  const isHydrated = hydratedProps.includes(prop);
  if (isHydrated && propSpec.required) return PropLabel.RequiredUnlessReferenced;
  if (isHydrated) return null;
  return requiredLabel(propSpec);
}

function referencePropLabel(propSpec: PropSpec): string {
  if (propSpec.required) return PropLabel.ReferenceRequired;
  return PropLabel.Reference;
}

function requiredLabel(propSpec: PropSpec): string | null {
  if (propSpec.required) return PropLabel.Required;
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
  if (acceptsChildrenInSurface(component)) {
    return `<${openingTag}>${CHILDREN_PLACEHOLDER_MARKUP}</${tag}>`;
  }
  return `<${openingTag} />`;
}

// Attribute spelling exactly as evals/vendor/markup/attributes.ts parses it: JSON
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
  const hasChildren = acceptsChildrenInSurface(component);

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

function acceptsChildrenInSurface(component: DocumentedComponentName): boolean {
  if (isStandaloneReference(component)) return false;
  return COMPONENT_SURFACE[component].acceptsChildren;
}

// ---- Semantic HTML shortcuts (markup only) -----------------------------------

function renderStructuralTagSection(input: SurfaceReferenceInput): readonly string[] {
  if (input.notation !== Notation.Markup) return [];
  const lines = STRUCTURAL_TAGS.map((tag) => {
    const name = input.vocabulary.tagName(tag);
    return `${PROP_INDENT}<${name}>: ${STRUCTURAL_TAG_SURFACE[tag].meaning}`;
  });
  return [["# Shortcuts", "", ...lines].join("\n")];
}
