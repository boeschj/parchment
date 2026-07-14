// Thin, typed helpers over the htmlparser2/domhandler node tree. Every other
// markup module reads the parsed DOM through these, so node-shape narrowing
// (isTag/isText, lowercased tag names, verbatim text collection) lives in one
// place and never leaks domhandler internals into the compiler.

import { isTag, isText, type AnyNode, type ChildNode, type Element } from "domhandler";

export type { AnyNode, ChildNode, Element };

export function isElementNode(node: AnyNode): node is Element {
  return isTag(node);
}

export function tagNameOf(element: Element): string {
  return element.name.toLowerCase();
}

export function isWhitespaceText(node: AnyNode): boolean {
  return isText(node) && node.data.trim().length === 0;
}

export function isMeaningfulNode(node: AnyNode): boolean {
  if (isText(node)) return node.data.trim().length > 0;
  return isElementNode(node);
}

// The element children of a node, in source order — whitespace, comments, and
// text are dropped. Used where only structural children matter (Select options,
// table rows), never for prose where interior text is significant.
export function elementChildren(element: Element): Element[] {
  return element.children.filter(isElementNode);
}

// Verbatim concatenation of every descendant text node — the source form for
// raw-text widgets (CodeBlock, Terminal, MermaidEditor) whose content must not
// be reflowed.
export function rawTextOf(element: Element): string {
  const parts: string[] = [];
  collectDescendantText(element.children, parts);
  return parts.join("");
}

function collectDescendantText(nodes: ChildNode[], out: string[]): void {
  for (const child of nodes) {
    if (isText(child)) {
      out.push(child.data);
      continue;
    }
    if (isElementNode(child)) collectDescendantText(child.children, out);
  }
}

// Collapses interior whitespace runs to single spaces and trims — the display
// form for short text props (Heading text, Badge text, table cells).
export function collapsedTextOf(element: Element): string {
  return rawTextOf(element).replace(/\s+/g, " ").trim();
}

export function textNodeValue(node: AnyNode): string {
  return isText(node) ? node.data : "";
}
