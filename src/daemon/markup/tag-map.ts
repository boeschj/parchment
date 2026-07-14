// How each semantic HTML tag is compiled. Two kinds of entry:
//   - "component": the tag maps straight onto a catalog component and is built
//     by the shared attribute/children pipeline (section→Stack, form→Card,
//     img→Image, button→Button, input→Input, …).
//   - a structural handler: the tag needs bespoke shaping the attribute pipeline
//     can't express (headings carry a level, lists/quotes become Markdown, a
//     table chooses DataTable vs Table).
// Tags absent from this map that are also not catalog components are rejected —
// the compiler never guesses at an unmapped tag.

export const TagHandler = {
  Component: "component",
  Heading: "heading",
  Prose: "prose",
  List: "list",
  Quote: "quote",
  PreCode: "pre-code",
  Table: "table",
} as const;

export type TagHandler = (typeof TagHandler)[keyof typeof TagHandler];

type TagRule =
  | { handler: typeof TagHandler.Component; component: string }
  | { handler: typeof TagHandler.Heading; level: string }
  | { handler: typeof TagHandler.Prose }
  | { handler: typeof TagHandler.List; ordered: boolean }
  | { handler: typeof TagHandler.Quote }
  | { handler: typeof TagHandler.PreCode }
  | { handler: typeof TagHandler.Table };

const container = (component: string): TagRule => ({ handler: TagHandler.Component, component });

export const SEMANTIC_TAG_RULES: Readonly<Record<string, TagRule>> = {
  h1: { handler: TagHandler.Heading, level: "h1" },
  h2: { handler: TagHandler.Heading, level: "h2" },
  h3: { handler: TagHandler.Heading, level: "h3" },
  h4: { handler: TagHandler.Heading, level: "h4" },
  h5: { handler: TagHandler.Heading, level: "h5" },
  h6: { handler: TagHandler.Heading, level: "h6" },
  p: { handler: TagHandler.Prose },
  section: container("Stack"),
  div: container("Stack"),
  article: container("Stack"),
  main: container("Stack"),
  aside: container("Stack"),
  header: container("Stack"),
  footer: container("Stack"),
  nav: container("Stack"),
  figure: container("Stack"),
  form: container("Card"),
  hr: container("Separator"),
  img: container("Image"),
  button: container("Button"),
  input: container("Input"),
  textarea: container("Textarea"),
  select: container("Select"),
  label: container("Text"),
  ul: { handler: TagHandler.List, ordered: false },
  ol: { handler: TagHandler.List, ordered: true },
  blockquote: { handler: TagHandler.Quote },
  pre: { handler: TagHandler.PreCode },
  table: { handler: TagHandler.Table },
} as const;

export function semanticRuleFor(tag: string): TagRule | null {
  return SEMANTIC_TAG_RULES[tag] ?? null;
}

// Inline formatting tags — never block-level elements of their own. In a run of
// prose they fold into a single Markdown/Text element; standing alone, an <a>
// becomes a Link and the rest render as their text.
export const INLINE_TAGS: ReadonlySet<string> = new Set([
  "a",
  "b",
  "strong",
  "i",
  "em",
  "code",
  "br",
  "span",
  "small",
  "mark",
  "u",
  "del",
  "sub",
  "sup",
  "kbd",
]);

export function isInlineTag(tag: string): boolean {
  return INLINE_TAGS.has(tag);
}

// Tags rejected on sight: executable/opaque content the compiler must never
// carry into a spec.
export const FORBIDDEN_TAGS: ReadonlySet<string> = new Set(["script", "style"]);

// The top-level element carrying the spec's root state as JSON text.
export const STATE_TAG = "state";
