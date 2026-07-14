// The markup walker. Parses an HTML/JSX-flavored string with htmlparser2's
// forgiving parser (self-closing custom elements recognized, unclosed tags
// recovered) and compiles the tree into a JsonRenderSpec — the same flat
// element map the runtime consumes. The output is handed straight to
// prepareSpec, so every existing validation and normalization still applies.
//
// Dispatch per node: a known catalog component → the shared component builder;
// a semantic HTML tag → its structural handler; an inline tag → a prose run;
// <script>/<style>/unknown → a precise rejection. Nothing is ever executed.

import { parseDocument } from "htmlparser2";
import type { JsonRenderSpec, UIElement } from "../../../src/shared/types.ts";
import {
  elementChildren,
  isElementNode,
  isMeaningfulNode,
  isWhitespaceText,
  rawTextOf,
  collapsedTextOf,
  tagNameOf,
  type AnyNode,
  type ChildNode,
  type Element,
} from "./dom.ts";
import { acceptsChildren, resolveComponentName } from "./component-catalog.ts";
import { buildElementBody } from "./attributes.ts";
import { RAW_TEXT_COMPONENTS, textContentPropOf } from "./conventions.ts";
import { elementKeyFor, ROOT_KEY } from "./keys.ts";
import { hasMarkdownSyntax, renderInlineNodes, renderListElement, renderQuote } from "./prose.ts";
import { compileTableElement } from "./tables.ts";
import {
  FORBIDDEN_TAGS,
  isInlineTag,
  semanticRuleFor,
  STATE_TAG,
  TagHandler,
  type TagHandler as TagHandlerKind,
} from "./tag-map.ts";

export type MarkupCompileResult = {
  spec: JsonRenderSpec;
  issues: string[];
};

type CompileContext = {
  elements: Record<string, UIElement>;
  issues: string[];
};

const PARSE_OPTIONS = { recognizeSelfClosing: true, lowerCaseAttributeNames: true } as const;

// Text components whose content preserves interior line breaks (dedented) rather
// than collapsing to a single line.
const DEDENTED_TEXT_COMPONENTS: ReadonlySet<string> = new Set([
  ...RAW_TEXT_COMPONENTS,
  "Callout",
  "Markdown",
]);

export function compileMarkup(markup: string): MarkupCompileResult {
  const document = parseDocument(markup, PARSE_OPTIONS);
  const ctx: CompileContext = { elements: {}, issues: [] };
  const state = extractRootState(document.children, ctx);
  const rootKey = compileRoot(renderableTopNodes(document.children), ctx);

  if (rootKey === null) {
    if (ctx.issues.length === 0) ctx.issues.push("markup is empty: nothing to render.");
    return { spec: { root: ROOT_KEY, elements: {} }, issues: ctx.issues };
  }
  const spec: JsonRenderSpec = {
    root: rootKey,
    elements: ctx.elements,
    ...(state !== null ? { state } : {}),
  };
  return { spec, issues: ctx.issues };
}

// ---- Root state -------------------------------------------------------------

function extractRootState(nodes: ChildNode[], ctx: CompileContext): Record<string, unknown> | null {
  let merged: Record<string, unknown> | null = null;
  for (const node of nodes) {
    if (!isElementNode(node) || tagNameOf(node) !== STATE_TAG) continue;
    const raw = rawTextOf(node).trim();
    if (raw.length === 0) continue;
    const parsed = parseStateJson(raw, ctx);
    if (parsed !== null) merged = { ...(merged ?? {}), ...parsed };
  }
  return merged;
}

function parseStateJson(raw: string, ctx: CompileContext): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    ctx.issues.push(`<state>: contains invalid JSON (${detail}).`);
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    ctx.issues.push(`<state>: must be a JSON object mapping top-level state keys to values.`);
    return null;
  }
  return value as Record<string, unknown>;
}

function renderableTopNodes(nodes: ChildNode[]): ChildNode[] {
  return nodes.filter((node) => !(isElementNode(node) && tagNameOf(node) === STATE_TAG));
}

// ---- Root selection ---------------------------------------------------------

function compileRoot(nodes: ChildNode[], ctx: CompileContext): string | null {
  const meaningful = nodes.filter(isMeaningfulNode);
  const only = meaningful[0];
  if (only === undefined) return null;

  const isSingleBlockElement =
    meaningful.length === 1 && isElementNode(only) && !isInlineTag(tagNameOf(only));
  if (isSingleBlockElement && isElementNode(only)) {
    return compileNode(only, [], ctx);
  }

  const childKeys = compileChildren(nodes, [], ctx);
  ctx.elements[ROOT_KEY] = { type: "Stack", props: { gap: "md" }, children: childKeys };
  return ROOT_KEY;
}

// ---- Children, with prose coalescing ---------------------------------------
// Consecutive inline/text siblings fold into one prose element; block elements
// and widgets flush the buffer and compile on their own. Each emitted child
// takes the next output index, so keys stay contiguous and structure-stable.

function compileChildren(nodes: ChildNode[], parentPath: number[], ctx: CompileContext): string[] {
  const results: string[] = [];
  let proseBuffer: ChildNode[] = [];

  const flushProse = (): void => {
    if (!proseBuffer.some(isMeaningfulNode)) {
      proseBuffer = [];
      return;
    }
    const key = compileProseRun(proseBuffer, [...parentPath, results.length], ctx);
    if (key !== null) results.push(key);
    proseBuffer = [];
  };

  for (const node of nodes) {
    if (isElementNode(node)) {
      const tag = tagNameOf(node);
      if (isInlineTag(tag) && resolveComponentName(tag) === null) {
        proseBuffer.push(node);
        continue;
      }
      flushProse();
      const key = compileNode(node, [...parentPath, results.length], ctx);
      if (key !== null) results.push(key);
      continue;
    }
    if (isWhitespaceText(node)) {
      if (proseBuffer.length > 0) proseBuffer.push(node);
      continue;
    }
    proseBuffer.push(node);
  }
  flushProse();
  return results;
}

// ---- Node dispatch ----------------------------------------------------------

function compileNode(element: Element, path: number[], ctx: CompileContext): string | null {
  const tag = tagNameOf(element);
  if (FORBIDDEN_TAGS.has(tag)) {
    ctx.issues.push(
      `<${tag}>: ${tag} is not allowed — parchment never executes or embeds script/style. Remove it.`,
    );
    return null;
  }
  if (tag === STATE_TAG) {
    ctx.issues.push(`<state>: the state element must be a top-level element, not nested.`);
    return null;
  }

  const rule = semanticRuleFor(tag);
  const customComponent = resolveComponentName(tag);
  if (customComponent !== null && rule === null) {
    return compileComponentNode(customComponent, element, path, true, undefined, ctx);
  }
  if (rule !== null) return compileSemanticNode(rule.handler, element, path, ctx);
  if (isInlineTag(tag)) return compileProseRun([element], path, ctx);

  const known = "section/div, h1-h4, p, ul/ol, table, form, img, a, button, input, plus catalog components (Metric, Chart, Callout, …)";
  ctx.issues.push(
    `<${tag}>: unknown tag — not a supported HTML element or a catalog component. Supported: ${known}.`,
  );
  return null;
}

function compileSemanticNode(
  handler: TagHandlerKind,
  element: Element,
  path: number[],
  ctx: CompileContext,
): string | null {
  if (handler === TagHandler.Component) {
    const rule = semanticRuleFor(tagNameOf(element));
    const component = rule !== null && "component" in rule ? rule.component : "Stack";
    return compileComponentNode(component, element, path, false, undefined, ctx);
  }
  if (handler === TagHandler.Heading) {
    const rule = semanticRuleFor(tagNameOf(element));
    const level = rule !== null && "level" in rule ? rule.level : "h2";
    return compileComponentNode("Heading", element, path, false, { level }, ctx);
  }
  if (handler === TagHandler.Prose) return compileProseRun([element], path, ctx);
  if (handler === TagHandler.List) {
    const rule = semanticRuleFor(tagNameOf(element));
    const ordered = rule !== null && "ordered" in rule ? rule.ordered : false;
    return registerMarkdown(renderListElement(element, ordered), path, ctx);
  }
  if (handler === TagHandler.Quote) return registerMarkdown(renderQuote(element), path, ctx);
  if (handler === TagHandler.PreCode) return compilePreCode(element, path, ctx);
  return compileTableNode(element, path, ctx);
}

// ---- Prose runs -------------------------------------------------------------

function compileProseRun(nodes: ChildNode[], path: number[], ctx: CompileContext): string | null {
  const meaningful = nodes.filter(isMeaningfulNode);
  if (meaningful.length === 0) return null;

  const soleAnchor = soleAnchorOf(meaningful);
  if (soleAnchor !== null) {
    return compileComponentNode("Link", soleAnchor, path, false, undefined, ctx);
  }

  const renderNodes = unwrapSoleParagraph(meaningful, nodes);
  const markdown = renderInlineNodes(renderNodes).trim();
  if (markdown.length === 0) return null;

  if (hasMarkdownSyntax(markdown)) {
    return registerElement("Markdown", path, { content: markdown }, [], ctx);
  }
  return registerElement("Text", path, { text: markdown, variant: "body" }, [], ctx);
}

function soleAnchorOf(meaningful: AnyNode[]): Element | null {
  if (meaningful.length !== 1) return null;
  const only = meaningful[0];
  if (only === undefined || !isElementNode(only) || tagNameOf(only) !== "a") return null;
  const href = only.attribs.href;
  if (href === undefined || href.trim().length === 0) return null;
  return only;
}

function unwrapSoleParagraph(meaningful: AnyNode[], nodes: ChildNode[]): readonly ChildNode[] {
  if (meaningful.length !== 1) return nodes;
  const only = meaningful[0];
  if (only === undefined || !isElementNode(only) || tagNameOf(only) !== "p") return nodes;
  return only.children;
}

function registerMarkdown(content: string, path: number[], ctx: CompileContext): string | null {
  const trimmed = content.trim();
  if (trimmed.length === 0) return null;
  return registerElement("Markdown", path, { content: trimmed }, [], ctx);
}

// ---- pre / table ------------------------------------------------------------

function compilePreCode(element: Element, path: number[], ctx: CompileContext): string {
  const code = dedentText(rawTextOf(element));
  const props: Record<string, unknown> = { code };
  const language = languageOf(element);
  if (language !== null) props.language = language;
  return registerElement("CodeBlock", path, props, [], ctx);
}

function languageOf(element: Element): string | null {
  const direct = element.attribs.language;
  if (direct?.trim()) return direct.trim();
  const codeChild = elementChildren(element).find((child) => tagNameOf(child) === "code");
  const className = codeChild?.attribs.class ?? "";
  const match = className.match(/language-([\w-]+)/);
  return match?.[1] ?? null;
}

function compileTableNode(element: Element, path: number[], ctx: CompileContext): string {
  const compiled = compileTableElement(element);
  return registerElement(compiled.type, path, compiled.props, [], ctx);
}

// ---- Component builder ------------------------------------------------------

function compileComponentNode(
  component: string,
  element: Element,
  path: number[],
  strictAttrs: boolean,
  presetProps: Record<string, unknown> | undefined,
  ctx: CompileContext,
): string {
  const elementKey = elementKeyFor(component, path);
  const body = buildElementBody(component, element.attribs, elementKey, strictAttrs, (message) =>
    ctx.issues.push(message),
  );
  const props: Record<string, unknown> = { ...presetProps, ...body.props };

  const children = attachContent(component, element, props, path, ctx);
  ctx.elements[elementKey] = {
    type: component,
    props,
    children,
    ...(body.on !== undefined ? { on: body.on } : {}),
  };
  return elementKey;
}

function attachContent(
  component: string,
  element: Element,
  props: Record<string, unknown>,
  path: number[],
  ctx: CompileContext,
): string[] {
  if (component === "Select") {
    if (props.options === undefined) props.options = optionTextsOf(element);
    return [];
  }
  if (acceptsChildren(component)) {
    return compileChildren(element.children, path, ctx);
  }
  applyTextContent(component, element, props);
  return [];
}

function applyTextContent(
  component: string,
  element: Element,
  props: Record<string, unknown>,
): void {
  const textProp = textContentPropOf(component);
  if (textProp === null || props[textProp] !== undefined) return;
  const text = DEDENTED_TEXT_COMPONENTS.has(component)
    ? dedentText(rawTextOf(element))
    : collapsedTextOf(element);
  if (text.length === 0) return;
  props[textProp] = text;
}

function optionTextsOf(element: Element): string[] {
  return elementChildren(element)
    .filter((child) => tagNameOf(child) === "option")
    .map(collapsedTextOf)
    .filter((text) => text.length > 0);
}

// ---- Element registration ---------------------------------------------------

function registerElement(
  type: string,
  path: number[],
  props: Record<string, unknown>,
  children: string[],
  ctx: CompileContext,
): string {
  const key = elementKeyFor(type, path);
  ctx.elements[key] = { type, props, children };
  return key;
}

// ---- Raw-text dedent --------------------------------------------------------
// Strips the shared leading indentation and outer blank lines that HTML
// pretty-printing adds, so a <CodeBlock> or <Markdown> body renders as authored
// rather than indented under its tag.

function dedentText(raw: string): string {
  const lines = raw.replace(/\t/g, "  ").split("\n");
  while (lines.length > 0 && (lines[0] ?? "").trim().length === 0) lines.shift();
  while (lines.length > 0 && (lines[lines.length - 1] ?? "").trim().length === 0) lines.pop();
  if (lines.length === 0) return "";
  const minIndent = smallestIndent(lines);
  return lines.map((line) => line.slice(minIndent)).join("\n").replace(/[ \t]+$/gm, "");
}

function smallestIndent(lines: string[]): number {
  let smallest = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const indent = line.match(/^ */)?.[0].length ?? 0;
    if (indent < smallest) smallest = indent;
  }
  return Number.isFinite(smallest) ? smallest : 0;
}
