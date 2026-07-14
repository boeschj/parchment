// Turns what an arm AUTHORED into a page a browser can open.
//
// This is a RENDER path, not a CHECK path. It is allowed to use parchment's own
// compiler, hydrator and validator, because the question it answers is "what
// would the user actually have seen?" — and the user sees the compiled,
// hydrated, validated result. What it must never do is have an opinion about
// whether that result is GOOD: that is decided downstream, by a real browser
// looking at real pixels (evals/verify), and by nothing else.
//
// Symmetry across arms is the whole job here. Each arm's document is put through
// ITS OWN toolchain and no one else's:
//   markup arms     compileMarkup → hydrate → push        → a canvas URL
//   json arms       JSON.parse → hydrate → push           → a canvas URL
//   terse-json      JSON.parse → expand → hydrate → push   → a canvas URL
//   scrambled arms  unscramble → compileMarkup → hydrate → push
//   raw-html        the file the model wrote               → a file:// URL
//   raw-jsx         bundled with a LOCAL React → one html  → a file:// URL
//
// A failure anywhere in a toolchain comes back as an ISSUE LIST, never an
// exception: those issues are the arm's own error signal, and feeding them back
// verbatim is what makes the repair loop fair (evals/repair.ts).

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseDocument } from "htmlparser2";
import { ArtifactKind, type Artifact } from "../../bench/acceptance/types.ts";
import { RenderOutcome, renderSpecToDaemon } from "../../bench/acceptance/render-spec.ts";
import type { JsonRenderSpec, UIElement } from "../../src/shared/types.ts";
import {
  REAL_VOCABULARY,
  SCRAMBLED_VOCABULARY,
  type VocabularyInverse,
} from "../catalog/vocabulary.ts";
import { EvalPaths } from "../config.ts";
import { compileMarkup } from "../vendor/markup/index.ts";
import { isElementNode, tagNameOf, type AnyNode, type Element } from "../vendor/markup/dom.ts";
import {
  hydrateSpec,
  isReferenceProps,
  referenceComponentOf,
  resolveElement,
} from "../hydration/resolvers.ts";
import type { EvalDaemon } from "../daemon.ts";
import { ArmId, type Arm, type AuthoredArtifact } from "../types.ts";

// ---- What each arm authored --------------------------------------------------

const ArtifactFormat = {
  Markup: "markup",
  ScrambledMarkup: "scrambled-markup",
  JsonSpec: "json-spec",
  TerseJson: "terse-json",
  OpenUiJson: "openui-json",
  RawHtml: "raw-html",
  RawJsx: "raw-jsx",
} as const;

type ArtifactFormat = (typeof ArtifactFormat)[keyof typeof ArtifactFormat];

// Keyed by ArmId so a new arm cannot be added without deciding, here, how its
// output becomes a page. A silent fallthrough would render an arm's document
// with the wrong toolchain and report the resulting failure as the arm's.
const FORMAT_BY_ARM = {
  [ArmId.ParchmentMarkupHigh]: ArtifactFormat.Markup,
  [ArmId.ParchmentMarkupLow]: ArtifactFormat.Markup,
  [ArmId.ParchmentJsonHigh]: ArtifactFormat.JsonSpec,
  [ArmId.ParchmentJsonLow]: ArtifactFormat.JsonSpec,
  [ArmId.ScrambledMarkupHigh]: ArtifactFormat.ScrambledMarkup,
  [ArmId.ScrambledMarkupLow]: ArtifactFormat.ScrambledMarkup,
  [ArmId.TerseJson]: ArtifactFormat.TerseJson,
  // TODO(evals/catalog/vocabulary.ts): OpenUI is a JSON dialect and needs that
  // module's OpenUI→spec adapter. Until it lands, its document is decoded as a
  // json-render spec, which is right only if the arm's system prompt asks for
  // one. Wire the adapter here — do NOT let this arm quietly report a loss it
  // did not earn.
  [ArmId.OpenUiLang]: ArtifactFormat.OpenUiJson,
  [ArmId.RawHtml]: ArtifactFormat.RawHtml,
  [ArmId.RawJsx]: ArtifactFormat.RawJsx,
} as const satisfies Record<ArmId, ArtifactFormat>;

// ---- The authoring vocabularies ----------------------------------------------

// THE INVERSE MAP CANNOT BE FLAT, AND THIS IS NOT A DETAIL.
//
// evals/catalog/vocabulary.ts numbers prop aliases per COMPONENT ("a1" is the
// first prop of whichever component it appears on), so "a1" on Chart and "a1" on
// DataTable are DIFFERENT real props. A flat alias→name map would let one
// overwrite the other, and un-scrambling would rename some props to the wrong
// thing.
//
// The failure that follows is the most dangerous one available to this eval: the
// scrambled arm's markup would fail to compile, its repair loop would thrash, and
// the results would show "the real vocabulary massively beats a scrambled one" —
// a pure harness artifact, and precisely the answer our own thesis wants to hear.
// So the component is resolved FIRST, and only then are its props looked up
// inside that component's own namespace.
export type AuthoringVocabulary = {
  // Owned by evals/catalog/vocabulary.ts. The scramble is an AUTHORING experiment
  // (does the model do worse with unfamiliar names?), never a runtime one, so it
  // is inverted before anything is compiled.
  inverse: VocabularyInverse;
  // TODO(evals/catalog/vocabulary.ts): the terse arm has NO vocabulary yet —
  // VocabularyId is only { Real, Scrambled }. These are the spec's STRUCTURAL
  // keys (a global, unambiguous namespace: "e" → "elements"), which is why a flat
  // map is safe HERE and nowhere else. If terse ever abbreviates per-component
  // PROP names, it must go through `inverse` above, not through this map.
  terseSpecKeys: Readonly<Record<string, string>>;
};

// The real vocabulary IS an identity alias scheme, so its inverse renames nothing
// — which is exactly what a non-scrambled arm needs. It is a real map rather than
// an empty one, so a missing entry is a loud lookup failure instead of a silent
// pass-through.
export const REAL_VOCABULARY_INVERSE: AuthoringVocabulary = {
  inverse: REAL_VOCABULARY.inverse,
  terseSpecKeys: {},
};

export const SCRAMBLED_VOCABULARY_INVERSE: AuthoringVocabulary = {
  inverse: SCRAMBLED_VOCABULARY.inverse,
  terseSpecKeys: {},
};

// ---- Public surface ------------------------------------------------------------

export const MaterializeOutcome = {
  Materialized: "materialized",
  // The arm's own toolchain refused its document. These issues go straight into
  // RepairSignal.toolchainIssues.
  ToolchainFailed: "toolchain-failed",
} as const;

export type MaterializeOutcome = (typeof MaterializeOutcome)[keyof typeof MaterializeOutcome];

export type MaterializeResult =
  | { outcome: typeof MaterializeOutcome.Materialized; artifact: Artifact; issues: readonly string[] }
  | { outcome: typeof MaterializeOutcome.ToolchainFailed; issues: readonly string[] };

export type MaterializeOptions = {
  arm: Arm;
  artifact: AuthoredArtifact;
  // The canvas session the hydrated spec is pushed to. Give each attempt its own,
  // so the browser opens exactly the artifact under test and never a leftover
  // slot from a previous attempt.
  canvasSessionId: string;
  title: string;
  daemon: EvalDaemon;
  // Scratch space for the file-authoring arms' materialized pages.
  runDir: string;
  vocabulary: AuthoringVocabulary;
};

export async function materializeArtifact(options: MaterializeOptions): Promise<MaterializeResult> {
  const format = FORMAT_BY_ARM[options.arm.id];

  if (format === ArtifactFormat.RawHtml) return materializeHtmlFile(options);
  if (format === ArtifactFormat.RawJsx) return materializeJsxComponent(options);

  return materializeSpec(format, options);
}

// ---- The spec arms ---------------------------------------------------------------

async function materializeSpec(
  format: ArtifactFormat,
  options: MaterializeOptions,
): Promise<MaterializeResult> {
  const decoded = decodeSpec(format, options.artifact.source, options.vocabulary);
  if (decoded.spec === null) return toolchainFailed(decoded.issues);

  const hydrated = hydrateSpec(decoded.spec);
  const toolchainIssues = [...decoded.issues, ...hydrated.issues];
  if (toolchainIssues.length > 0) return toolchainFailed(toolchainIssues);

  return pushToCanvas(hydrated.spec, options);
}

type DecodedSpec = { spec: JsonRenderSpec | null; issues: string[] };

// THE ONE AUTHORING PIPELINE. The eval's canvas MCP server (evals/mcp) decodes a
// live tool call with this same function, so what the model's render call does at
// RUN time and what the report reconstructs at MEASURE time cannot drift apart.
export function decodeAuthoredDocument(
  format: ArtifactFormat,
  source: string,
  vocabulary: AuthoringVocabulary,
): DecodedSpec {
  if (format === ArtifactFormat.Markup) return compileMarkupDocument(source);

  if (format === ArtifactFormat.ScrambledMarkup) {
    const unscrambled = unscrambleMarkup(source, vocabulary.inverse);
    return compileMarkupDocument(unscrambled);
  }

  if (format === ArtifactFormat.TerseJson) {
    const decoded = parseSpecJson(source, expandTerseSpec);
    return applyVocabularyToSpec(decoded, vocabulary.inverse);
  }

  return parseSpecJson(source, (parsed) => parsed);
}

export function artifactFormatOf(armId: ArmId): ArtifactFormat {
  return FORMAT_BY_ARM[armId];
}

// The scrambled arms author in aliases; every other arm authors in the real
// names. Terse needs no alias map at all — it abbreviates the spec's structural
// keys and leaves component and prop names alone.
export function vocabularyForArm(armId: ArmId): AuthoringVocabulary {
  const isScrambled =
    armId === ArmId.ScrambledMarkupHigh || armId === ArmId.ScrambledMarkupLow;

  return isScrambled ? SCRAMBLED_VOCABULARY_INVERSE : REAL_VOCABULARY_INVERSE;
}

// The JSON twin of unscrambleMarkup, and component-aware for exactly the same
// reason: an element's props can only be renamed once its component is known.
function applyVocabularyToSpec(decoded: DecodedSpec, inverse: VocabularyInverse): DecodedSpec {
  if (decoded.spec === null) return decoded;

  const elements: Record<string, UIElement> = {};
  for (const [key, element] of Object.entries(decoded.spec.elements)) {
    const realType = realNameOf(element.type, inverse);
    elements[key] = {
      ...element,
      type: realType,
      props: renameProps(element.props, realType, inverse),
    };
  }

  return { spec: { ...decoded.spec, elements }, issues: decoded.issues };
}

function renameProps(
  props: Readonly<Record<string, unknown>>,
  realComponentName: string,
  inverse: VocabularyInverse,
): Record<string, unknown> {
  const propNameByAlias = inverse.propNameByAliasByComponent[realComponentName] ?? {};
  const renamed: Record<string, unknown> = {};

  for (const [alias, value] of Object.entries(props)) {
    const realProp = propNameByAlias[alias] ?? alias;
    renamed[realProp] = value;
  }

  return renamed;
}

// ---- Markup ------------------------------------------------------------------------

// The reference tags (<GitDiff/>, <LogStream/>, <DataTable src/>) are AUTHORING
// intents: no catalog component answers to them, so the markup compiler would
// reject them as unknown tags and drop them on the floor. They are therefore
// lowered BEFORE compilation — each reference element is swapped for a
// placeholder the compiler does understand, and the hydrated component is spliced
// back into the compiled spec in its place.
//
// Lowering by rewriting the SOURCE (pasting a whole file's text into an attribute
// and hoping it survives quoting) was the obvious alternative and is a trap: a
// diff containing a quote character would silently corrupt the document.
const PLACEHOLDER_COMPONENT = "Text";
const PLACEHOLDER_PROP = "text";
const PLACEHOLDER_PREFIX = "__parchment_reference_";

function compileMarkupDocument(source: string): DecodedSpec {
  const lowered = lowerReferenceTags(source);
  const compiled = compileMarkup(lowered.source);

  if (compiled.issues.length > 0) return { spec: null, issues: compiled.issues };

  const restored = restoreReferences(compiled.spec, lowered.references);
  return { spec: restored.spec, issues: restored.issues };
}

type LoweredReference = { placeholder: string; element: UIElement };
type LoweredMarkup = { source: string; references: LoweredReference[] };

function lowerReferenceTags(source: string): LoweredMarkup {
  const document = parseDocument(source, {
    recognizeSelfClosing: true,
    lowerCaseAttributeNames: true,
    withStartIndices: true,
    withEndIndices: true,
  });

  const referenceElements = collectReferenceElements(document.children);
  if (referenceElements.length === 0) return { source, references: [] };

  const references: LoweredReference[] = [];
  let loweredSource = "";
  let copiedUpTo = 0;

  referenceElements.forEach((element, index) => {
    const placeholder = `${PLACEHOLDER_PREFIX}${index}`;
    const span = spanOf(element);

    loweredSource += source.slice(copiedUpTo, span.startIndex);
    loweredSource += `<${PLACEHOLDER_COMPONENT} ${PLACEHOLDER_PROP}="${placeholder}" />`;
    copiedUpTo = span.endIndex + 1;

    references.push({ placeholder, element: authoredElementOf(element) });
  });

  loweredSource += source.slice(copiedUpTo);
  return { source: loweredSource, references };
}

function collectReferenceElements(nodes: readonly AnyNode[]): Element[] {
  const found: Element[] = [];

  for (const node of nodes) {
    if (!isElementNode(node)) continue;

    if (isReferenceTag(node)) {
      found.push(node);
      continue;
    }
    found.push(...collectReferenceElements(node.children));
  }

  return found;
}

function isReferenceTag(element: Element): boolean {
  const component = referenceComponentOf(tagNameOf(element));
  if (component === null) return false;
  return isReferenceProps(component, Object.keys(element.attribs));
}

// The authoring element, exactly as written: the tag's catalog-cased name and its
// attributes as props. This is what the hydrator resolves.
function authoredElementOf(element: Element): UIElement {
  const component = referenceComponentOf(tagNameOf(element));
  return {
    type: component ?? tagNameOf(element),
    props: { ...element.attribs },
    children: [],
  };
}

type ElementSpan = { startIndex: number; endIndex: number };

function spanOf(element: Element): ElementSpan {
  const { startIndex, endIndex } = element;
  if (startIndex === null || endIndex === null) {
    throw new Error(
      "the markup parser returned an element with no source span, so a reference tag cannot be " +
        "located in the document (parseDocument needs withStartIndices/withEndIndices).",
    );
  }
  return { startIndex, endIndex };
}

function restoreReferences(
  spec: JsonRenderSpec,
  references: readonly LoweredReference[],
): DecodedSpec {
  if (references.length === 0) return { spec, issues: [] };

  const referenceByPlaceholder = new Map(
    references.map((reference) => [reference.placeholder, reference.element]),
  );

  const elements: Record<string, UIElement> = {};
  const issues: string[] = [];

  for (const [key, element] of Object.entries(spec.elements)) {
    const placeholder = placeholderOf(element);
    const authored = placeholder === null ? undefined : referenceByPlaceholder.get(placeholder);

    if (authored === undefined) {
      elements[key] = element;
      continue;
    }

    const resolved = resolveElement(authored, key);
    elements[key] = resolved.element;
    issues.push(...resolved.issues);
  }

  return { spec: { ...spec, elements }, issues };
}

function placeholderOf(element: UIElement): string | null {
  if (element.type !== PLACEHOLDER_COMPONENT) return null;

  const text = element.props[PLACEHOLDER_PROP];
  if (typeof text !== "string") return null;
  if (!text.startsWith(PLACEHOLDER_PREFIX)) return null;

  return text;
}

// ---- Scrambled markup ---------------------------------------------------------------

// Un-scrambling is STRUCTURAL, never a find-and-replace over the source text.
//
// Two reasons, and the second is the one that matters. A textual replace would
// rewrite the model's prose and data as well as its tags — and, far worse, it
// would have to treat the alias map as flat. Prop aliases are numbered PER
// COMPONENT ("a1" is whichever component's first prop), so the component must be
// resolved BEFORE its props can be. A flat map silently maps some props to the
// wrong real name, and the arm it corrupts is the one whose failure our thesis
// would most like to believe.
//
// So: parse, resolve each element's component, rename that element's attributes
// inside that component's own namespace, and splice the rebuilt tags back over
// their exact source spans.
//
// Exported so the scramble→unscramble round trip can be asserted directly
// (evals/catalog owns the vocabulary and its round-trip test): if this is not the
// identity for every documented component and prop, the ablation is measuring the
// harness.
export function unscrambleMarkup(source: string, inverse: VocabularyInverse): string {
  const document = parseDocument(source, {
    recognizeSelfClosing: true,
    // The aliases are case-sensitive ("C03", "a1"), so the parser must not
    // lowercase them out of existence before we can look them up.
    lowerCaseTags: false,
    lowerCaseAttributeNames: false,
    withStartIndices: true,
    withEndIndices: true,
  });

  const edits = collectAllElements(document.children).flatMap((element) =>
    unscrambleElementEdits(source, element, inverse),
  );

  return applyEdits(source, edits);
}

type TextEdit = { start: number; end: number; replacement: string };

function collectAllElements(nodes: readonly AnyNode[]): Element[] {
  const found: Element[] = [];

  for (const node of nodes) {
    if (!isElementNode(node)) continue;
    found.push(node);
    found.push(...collectAllElements(node.children));
  }

  return found;
}

function unscrambleElementEdits(
  source: string,
  element: Element,
  inverse: VocabularyInverse,
): TextEdit[] {
  const alias = element.name;
  const realName = realNameOf(alias, inverse);
  const attributes = renameAttributes(element.attribs, realName, inverse);

  const openTag = openTagSpanOf(source, element);
  const isSelfClosing = source[openTag.end - 1] === "/";

  const edits: TextEdit[] = [
    {
      start: openTag.start,
      end: openTag.end,
      replacement: renderOpenTag(realName, attributes, isSelfClosing),
    },
  ];

  const closeTag = closeTagSpanOf(source, element, alias, openTag);
  if (closeTag !== null) {
    edits.push({ start: closeTag.start, end: closeTag.end, replacement: `</${realName}>` });
  }

  return edits;
}

// A component alias first, then a structural tag alias, then the name as written
// — an unknown alias is left alone so the markup compiler can report it as the
// unknown tag it is, rather than having it silently disappear here.
function realNameOf(alias: string, inverse: VocabularyInverse): string {
  const component = inverse.componentNameByAlias[alias];
  if (component !== undefined) return component;

  const tag = inverse.tagNameByAlias[alias];
  if (tag !== undefined) return tag;

  return alias;
}

// THE FIX: the prop namespace is scoped to the RESOLVED component, so "a1" on a
// Chart and "a1" on a DataTable cannot collide.
function renameAttributes(
  attributes: Readonly<Record<string, string>>,
  realComponentName: string,
  inverse: VocabularyInverse,
): Record<string, string> {
  const propNameByAlias = inverse.propNameByAliasByComponent[realComponentName] ?? {};
  const renamed: Record<string, string> = {};

  for (const [alias, value] of Object.entries(attributes)) {
    const realProp = propNameByAlias[alias] ?? alias;
    renamed[realProp] = value;
  }

  return renamed;
}

function renderOpenTag(
  name: string,
  attributes: Readonly<Record<string, string>>,
  isSelfClosing: boolean,
): string {
  const rendered = Object.entries(attributes)
    .map(([attribute, value]) => ` ${attribute}="${escapeAttributeValue(value)}"`)
    .join("");
  const tail = isSelfClosing ? " />" : ">";
  return `<${name}${rendered}${tail}`;
}

// The compiler's parser decodes entities, so the values round-trip byte-for-byte.
function escapeAttributeValue(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

type SourceSpan = { start: number; end: number };

// The open tag runs to the first ">" that is not inside a quoted attribute value:
// a value may legitimately contain one (data='[{"a":1}]' does not, but a prose
// title does).
function openTagSpanOf(source: string, element: Element): SourceSpan {
  const start = element.startIndex;
  if (start === null) {
    throw new Error(
      "the markup parser returned an element with no source span, so the scrambled tag cannot be " +
        "located (parseDocument needs withStartIndices/withEndIndices).",
    );
  }

  let quoteCharacter: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === undefined) break;

    if (quoteCharacter !== null) {
      if (character === quoteCharacter) quoteCharacter = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quoteCharacter = character;
      continue;
    }
    if (character === ">") return { start, end: index };
  }

  throw new Error(`the open tag of <${element.name}> is never closed in the document.`);
}

// endIndex points at the ">" of the closing tag, so the closing tag's own span is
// derivable from the alias's length. A self-closing element has none.
function closeTagSpanOf(
  source: string,
  element: Element,
  alias: string,
  openTag: SourceSpan,
): SourceSpan | null {
  const end = element.endIndex;
  if (end === null) return null;
  if (end === openTag.end) return null;

  const closeTag = `</${alias}>`;
  const start = end - closeTag.length + 1;
  if (start < 0) return null;
  if (source.slice(start, end + 1) !== closeTag) return null;

  return { start, end };
}

// Applied last-to-first so an earlier edit never shifts a later edit's indices.
function applyEdits(source: string, edits: readonly TextEdit[]): string {
  const orderedEdits = [...edits].sort((left, right) => right.start - left.start);

  let edited = source;
  for (const edit of orderedEdits) {
    edited = edited.slice(0, edit.start) + edit.replacement + edited.slice(edit.end + 1);
  }
  return edited;
}

// ---- JSON specs -------------------------------------------------------------------

function parseSpecJson(
  source: string,
  transform: (parsed: unknown) => unknown,
): DecodedSpec {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    return {
      spec: null,
      issues: [`the document is not valid JSON (${messageOf(error)}).`],
    };
  }

  const transformed = transform(parsed);
  if (!isJsonRenderSpec(transformed)) {
    return {
      spec: null,
      issues: [
        `the document parsed, but it is not a json-render spec: expected { root, elements }, got ` +
          `${describeShape(transformed)}.`,
      ],
    };
  }

  return { spec: transformed, issues: [] };
}

function isJsonRenderSpec(value: unknown): value is JsonRenderSpec {
  if (!isPlainObject(value)) return false;
  if (typeof value.root !== "string") return false;
  return isPlainObject(value.elements);
}

// The terse notation minifies the spec's SIX STRUCTURAL KEYS and nothing else
// (evals/catalog/surface.ts: "Component and prop names are never abbreviated —
// only the structural keys are short").
//
// SO THE EXPANSION MUST BE STRUCTURAL, NOT A RECURSIVE KEY REWRITE. A blind walk
// that renamed every "t" it met would reach inside `props` and into the data
// itself: a Chart row {t: 1731, v: 5} would come out as {type: 1731, v: 5}, and
// the chart would plot nothing. The terse arm is the one most likely to BEAT us
// on density, so a harness bug that breaks it is a FAKE WIN for parchment — the
// exact species of error that destroys a benchmark's credibility.
//
// Only the spec envelope and each element's own three keys are touched. Prop
// names, state, and every data value are left exactly as authored.
const TerseKey = {
  Root: "r",
  Elements: "e",
  State: "s",
  Type: "t",
  Props: "p",
  Children: "c",
} as const;

function expandTerseSpec(parsed: unknown): unknown {
  if (!isPlainObject(parsed)) return parsed;

  const root = parsed[TerseKey.Root] ?? parsed.root;
  const terseElements = parsed[TerseKey.Elements] ?? parsed.elements;
  const state = parsed[TerseKey.State] ?? parsed.state;

  if (!isPlainObject(terseElements)) return parsed;

  const elements: Record<string, unknown> = {};
  for (const [key, element] of Object.entries(terseElements)) {
    elements[key] = expandTerseElement(element);
  }

  return {
    root,
    elements,
    ...(state === undefined ? {} : { state }),
  };
}

function expandTerseElement(element: unknown): unknown {
  if (!isPlainObject(element)) return element;

  const { [TerseKey.Type]: terseType, [TerseKey.Props]: terseProps, [TerseKey.Children]: terseChildren, ...rest } = element;

  const type = terseType ?? element.type;
  const props = terseProps ?? element.props ?? {};
  const children = terseChildren ?? element.children;

  return {
    ...omitKeys(rest, ["type", "props", "children"]),
    type,
    props,
    ...(children === undefined ? {} : { children }),
  };
}

function omitKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (keys.includes(key)) continue;
    kept[key] = nested;
  }
  return kept;
}

// ---- The push ----------------------------------------------------------------------

async function pushToCanvas(
  spec: JsonRenderSpec,
  options: MaterializeOptions,
): Promise<MaterializeResult> {
  const rendered = await renderSpecToDaemon({
    daemonBaseUrl: options.daemon.baseUrl,
    daemonToken: options.daemon.token,
    sessionId: options.canvasSessionId,
    title: options.title,
    spec,
    // Mirrors canvas_render exactly: a spec today's validation would have bounced
    // back to the model never reaches a browser, and its issues become the arm's
    // repair signal.
    honourValidationIssues: true,
  });

  if (rendered.outcome === RenderOutcome.Rendered && rendered.canvasUrl !== null) {
    return {
      outcome: MaterializeOutcome.Materialized,
      artifact: { kind: ArtifactKind.ParchmentCanvas, canvasUrl: rendered.canvasUrl },
      issues: [],
    };
  }

  const daemonIssues = rendered.error === null ? [] : [rendered.error];
  return toolchainFailed([...rendered.validationIssues, ...daemonIssues]);
}

// ---- raw-html ------------------------------------------------------------------------

const MATERIALIZED_DIRNAME = "materialized";
const HTML_FILENAME = "artifact.html";

// The model's own file is preferred over the transcript's copy of it: that file
// is literally what a user would open. The transcript copy is the fallback for a
// model that emitted the document but never landed it on disk.
function materializeHtmlFile(options: MaterializeOptions): MaterializeResult {
  const writtenPath = writtenFilePathOf(options);
  if (writtenPath !== null) {
    return {
      outcome: MaterializeOutcome.Materialized,
      artifact: { kind: ArtifactKind.HtmlFile, filePath: writtenPath },
      issues: [],
    };
  }

  if (options.artifact.source.trim().length === 0) {
    return toolchainFailed(["the run produced no HTML: no file was written and no source was emitted."]);
  }

  const outputDir = join(options.runDir, MATERIALIZED_DIRNAME);
  mkdirSync(outputDir, { recursive: true });
  const filePath = join(outputDir, HTML_FILENAME);
  writeFileSync(filePath, options.artifact.source);

  return {
    outcome: MaterializeOutcome.Materialized,
    artifact: { kind: ArtifactKind.HtmlFile, filePath },
    issues: [],
  };
}

function writtenFilePathOf(options: MaterializeOptions): string | null {
  const filePath = options.artifact.toolInput?.file_path;
  if (typeof filePath !== "string") return null;

  const resolved = resolve(options.runDir, filePath);
  if (!existsSync(resolved)) return null;

  return resolved;
}

// ---- raw-jsx ---------------------------------------------------------------------------

// The component is bundled with the repo's OWN react/react-dom (a local
// node_modules resolution, not a CDN) into one self-contained HTML file. The
// rubric forbids external assets, and a page whose React never arrives would
// score as an empty render — which would be a harness failure reported as an arm's
// loss.
const JSX_COMPONENT_FILENAME = "Component.tsx";
const JSX_ENTRY_FILENAME = "entry.tsx";
const JSX_PAGE_FILENAME = "index.html";
const JSX_MOUNT_ID = "root";
const PRODUCTION_ENV = '"production"';

async function materializeJsxComponent(options: MaterializeOptions): Promise<MaterializeResult> {
  const componentSource = options.artifact.source;
  if (componentSource.trim().length === 0) {
    return toolchainFailed(["the run produced no JSX: the component source is empty."]);
  }

  // The build happens INSIDE the repo, under EvalPaths.runs. Bundlers resolve
  // "react-dom/client" by walking up from the importing file to a node_modules,
  // so a build directory outside the repo cannot see the repo's React and every
  // raw-jsx run would fail to bundle — an arm losing to the harness, not to the
  // format. (Confirmed: building from a temp dir fails with "Could not resolve:
  // react-dom/client".)
  const outputDir = join(EvalPaths.runs, options.canvasSessionId, MATERIALIZED_DIRNAME);
  mkdirSync(outputDir, { recursive: true });

  const componentPath = join(outputDir, JSX_COMPONENT_FILENAME);
  const entryPath = join(outputDir, JSX_ENTRY_FILENAME);
  writeFileSync(componentPath, componentSource);
  writeFileSync(entryPath, jsxEntrySource());

  const build = await Bun.build({
    entrypoints: [entryPath],
    target: "browser",
    // React's development build reads process.env.NODE_ENV, which does not exist
    // in a browser: without this define the page throws before it paints.
    define: { "process.env.NODE_ENV": PRODUCTION_ENV },
  });

  if (!build.success) {
    return toolchainFailed(build.logs.map((log) => String(log.message)));
  }

  const bundle = build.outputs[0];
  if (bundle === undefined) {
    return toolchainFailed(["the JSX bundled without errors but produced no output."]);
  }

  const pagePath = join(outputDir, JSX_PAGE_FILENAME);
  writeFileSync(pagePath, jsxPageHtml(await bundle.text()));

  return {
    outcome: MaterializeOutcome.Materialized,
    artifact: { kind: ArtifactKind.HtmlFile, filePath: pagePath },
    issues: [],
  };
}

// The arm's component may be a default export or a named one, and forcing a
// convention on it through the system prompt would be handing this arm a
// requirement the others do not carry. The entry accepts either.
function jsxEntrySource(): string {
  return [
    `import { createRoot } from "react-dom/client";`,
    `import * as authored from "./${JSX_COMPONENT_FILENAME}";`,
    ``,
    `const exportedValues = Object.values(authored);`,
    `const Component = authored.default ?? exportedValues.find((value) => typeof value === "function");`,
    ``,
    `if (typeof Component !== "function") {`,
    `  throw new Error("the authored module exports no component function");`,
    `}`,
    ``,
    `const container = document.getElementById(${JSON.stringify(JSX_MOUNT_ID)});`,
    `if (container === null) throw new Error("the mount point is missing");`,
    ``,
    `createRoot(container).render(<Component />);`,
    ``,
  ].join("\n");
}

function jsxPageHtml(bundledJavaScript: string): string {
  return [
    `<!doctype html>`,
    `<meta charset="utf-8">`,
    `<title>raw-jsx artifact</title>`,
    `<div id="${JSX_MOUNT_ID}"></div>`,
    `<script type="module">`,
    inlineSafe(bundledJavaScript),
    `</script>`,
    ``,
  ].join("\n");
}

// React's own bundle contains the literal text "</script>" inside a string, which
// ends the inline <script> element early and leaves the rest of the bundle
// painted onto the page as text. (Observed: the page threw "Invalid or unexpected
// token" and rendered raw JavaScript.) Escaping the sequence is the standard fix
// and is a no-op for the JavaScript itself: "<\/script" is identical to
// "</script" in every string, template and regex context.
function inlineSafe(bundledJavaScript: string): string {
  return bundledJavaScript.replaceAll("</script", String.raw`<\/script`);
}

// ---- shared -------------------------------------------------------------------------------

function toolchainFailed(issues: readonly string[]): MaterializeResult {
  return { outcome: MaterializeOutcome.ToolchainFailed, issues };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeShape(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
