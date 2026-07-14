// The dialect's genuine authoring choices — the parts that are semantic
// decisions rather than facts derivable from the catalog schema. Kept as small
// as-const tables so the markup reference doc and the compiler read the same
// source of truth. Everything derivable (prop spelling, types, children) lives
// in component-catalog.ts instead.

// Which prop a component's text content fills. <Heading>Title</Heading> puts
// "Title" on `text`; <CodeBlock>...</CodeBlock> puts its body on `code`.
export const TEXT_CONTENT_PROP = {
  Heading: "text",
  Text: "text",
  Badge: "text",
  Button: "label",
  Link: "label",
  Callout: "body",
  Markdown: "content",
  CodeBlock: "code",
  Terminal: "output",
  MermaidEditor: "source",
} as const satisfies Record<string, string>;

export type TextContentComponent = keyof typeof TEXT_CONTENT_PROP;

export function textContentPropOf(component: string): string | null {
  if (Object.prototype.hasOwnProperty.call(TEXT_CONTENT_PROP, component)) {
    return TEXT_CONTENT_PROP[component as TextContentComponent];
  }
  return null;
}

// Components whose text content is code/output/source and must survive
// verbatim — no whitespace collapsing, no markdown interpretation.
export const RAW_TEXT_COMPONENTS: ReadonlySet<string> = new Set([
  "CodeBlock",
  "Terminal",
  "MermaidEditor",
]);

// The prop a `bind="/pointer"` sugar writes to, per component — the two-way
// value of each form control. Anything else binds to `value`.
export const NATURAL_VALUE_PROP = {
  Input: "value",
  Textarea: "value",
  Select: "value",
  Slider: "value",
  Radio: "value",
  ToggleGroup: "value",
  Checkbox: "checked",
  Switch: "checked",
  Toggle: "pressed",
} as const satisfies Record<string, string>;

export type NaturalValueComponent = keyof typeof NATURAL_VALUE_PROP;

export function naturalValuePropOf(component: string): string {
  if (Object.prototype.hasOwnProperty.call(NATURAL_VALUE_PROP, component)) {
    return NATURAL_VALUE_PROP[component as NaturalValueComponent];
  }
  return "value";
}

// Components that accept native HTML validation attributes (required, minlength,
// type=email, …) and translate them into the catalog's `checks` array.
export const FORM_CONTROL_COMPONENTS: ReadonlySet<string> = new Set([
  "Input",
  "Textarea",
  "Select",
  "Checkbox",
  "Radio",
  "Switch",
]);

// The MCP action ids bound on a Button's press by the intent/submit sugar.
export const CanvasAction = {
  Intent: "canvas.intent",
  Submit: "canvas.submit",
} as const;

// Default state path a `submit` button sends when no `payload` is given —
// forms seed their fields under /form by convention.
export const DEFAULT_SUBMIT_PAYLOAD_POINTER = "/form";
