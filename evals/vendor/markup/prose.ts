// Renders inline HTML content to markdown so a run of prose compiles to a
// single Markdown (or Text) element instead of a stack of primitives.
// <strong>/<em>/<code>/<a> become their markdown spellings; <br> becomes a line
// break; lists and blockquotes become markdown lists and quotes.

import {
  collapsedTextOf,
  elementChildren,
  isElementNode,
  tagNameOf,
  textNodeValue,
  type AnyNode,
  type ChildNode,
  type Element,
} from "./dom.ts";

export function renderInlineNodes(nodes: readonly ChildNode[]): string {
  return nodes.map(nodeToMarkdown).join("");
}

function nodeToMarkdown(node: AnyNode): string {
  if (!isElementNode(node)) return collapseWhitespace(textNodeValue(node));
  return elementToMarkdown(node);
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ");
}

function elementToMarkdown(element: Element): string {
  const tag = tagNameOf(element);
  const inner = renderInlineNodes(element.children);
  if (tag === "strong" || tag === "b") return `**${inner}**`;
  if (tag === "em" || tag === "i") return `*${inner}*`;
  if (tag === "del") return `~~${inner}~~`;
  if (tag === "code" || tag === "kbd") return `\`${collapsedTextOf(element)}\``;
  if (tag === "a") return anchorToMarkdown(element, inner);
  if (tag === "br") return "\n";
  if (tag === "p") return `${inner.trim()}\n\n`;
  if (tag === "ul") return `${renderListElement(element, false)}\n`;
  if (tag === "ol") return `${renderListElement(element, true)}\n`;
  if (tag === "blockquote") return `${renderQuote(element)}\n`;
  return inner;
}

function anchorToMarkdown(element: Element, inner: string): string {
  const href = element.attribs.href;
  if (href === undefined || href.trim().length === 0) return inner;
  return `[${inner.trim()}](${href.trim()})`;
}

export function renderListElement(element: Element, ordered: boolean): string {
  const items = elementChildren(element).filter((child) => tagNameOf(child) === "li");
  const lines = items.map((item, index) => {
    const marker = ordered ? `${index + 1}. ` : "- ";
    return `${marker}${renderInlineNodes(item.children).trim()}`;
  });
  return lines.join("\n");
}

export function renderQuote(element: Element): string {
  const inner = renderInlineNodes(element.children).trim();
  return inner
    .split("\n")
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");
}

const MARKDOWN_SIGNAL_PATTERN = /[*_`[\]#>|~]|\n/;

// A prose run with any markdown syntax or a line break compiles to Markdown;
// a single clean line compiles to a lighter Text(body).
export function hasMarkdownSyntax(text: string): boolean {
  return MARKDOWN_SIGNAL_PATTERN.test(text);
}
