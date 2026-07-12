// "Copy as React": turns a slot's json-render spec into a single self-contained
// .tsx component that imports nothing but React. Catalog components are inlined
// as minimal, dependency-free equivalents (native elements + the parchment
// palette baked into inline styles). Dynamic expressions are resolved against
// the slot's seed state to a concrete snapshot; when the spec has form inputs
// bound to state, that state is seeded into useState and the inputs are wired
// controlled. It is a faithful starting point a developer can drop into any
// React project, not a live rehydration of the daemon.

import type { JsonRenderSpec, UIElement } from "../../shared/types.ts";

// ---- palette (light theme, mirrors theme-default.css) ---------------------
const Palette = {
  background: "#F3F3F3",
  foreground: "#030204",
  card: "#FBFBFB",
  muted: "#F1F1F2",
  mutedForeground: "#6E6E70",
  primary: "#CEA500",
  border: "rgba(3,2,4,0.08)",
  hairline: "rgba(3,2,4,0.10)",
  success: "#16A34A",
  destructive: "#DC2626",
} as const;

const GAP_PX: Record<string, number> = { none: 0, sm: 8, md: 16, lg: 24, xl: 32 };

// ---- JSON pointer + expression resolution (pure) --------------------------
type State = Record<string, unknown>;
type ItemScope = { item: unknown; index: number } | null;

function getAtPointer(root: unknown, pointer: string): unknown {
  if (pointer === "" || pointer === "/") return root;
  const segments = pointer.split("/").slice(1);
  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasKey(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function interpolateTemplate(template: string, state: State, scope: ItemScope): string {
  return template.replace(/\$\{([^}]+)\}/g, (_match, rawPath: string) => {
    const path = rawPath.trim();
    const pointer = path.startsWith("/") ? path : `/${path}`;
    const value = getAtPointer(state, pointer);
    if (value === undefined || value === null) return "";
    void scope;
    return String(value);
  });
}

function evaluateCondition(condition: unknown, state: State, scope: ItemScope): boolean {
  if (Array.isArray(condition)) {
    return condition.every((entry) => evaluateCondition(entry, state, scope));
  }
  if (!isPlainObject(condition)) return Boolean(condition);
  if (hasKey(condition, "$and")) {
    const clauses = condition.$and as unknown[];
    return clauses.every((clause) => evaluateCondition(clause, state, scope));
  }
  if (hasKey(condition, "$or")) {
    const clauses = condition.$or as unknown[];
    return clauses.some((clause) => evaluateCondition(clause, state, scope));
  }
  const base = hasKey(condition, "$state")
    ? getAtPointer(state, String(condition.$state))
    : undefined;
  let result = base === undefined ? true : Boolean(base);
  if (hasKey(condition, "eq")) result = result && base === condition.eq;
  if (hasKey(condition, "neq")) result = result && base !== condition.neq;
  if (hasKey(condition, "gt")) result = result && Number(base) > Number(condition.gt);
  if (hasKey(condition, "gte")) result = result && Number(base) >= Number(condition.gte);
  if (hasKey(condition, "lt")) result = result && Number(base) < Number(condition.lt);
  if (hasKey(condition, "lte")) result = result && Number(base) <= Number(condition.lte);
  if (hasKey(condition, "not")) result = condition.not === true ? !result : result;
  return result;
}

function resolveExpression(value: unknown, state: State, scope: ItemScope): unknown {
  if (Array.isArray(value)) return value.map((entry) => resolveExpression(entry, state, scope));
  if (!isPlainObject(value)) return value;
  if (hasKey(value, "$state")) return getAtPointer(state, String(value.$state));
  if (hasKey(value, "$bindState")) return getAtPointer(state, String(value.$bindState));
  if (hasKey(value, "$template")) {
    return interpolateTemplate(String(value.$template), state, scope);
  }
  if (hasKey(value, "$cond")) {
    const branch = evaluateCondition(value.$cond, state, scope) ? value.$then : value.$else;
    return resolveExpression(branch, state, scope);
  }
  if (hasKey(value, "$item") && scope && isPlainObject(scope.item)) {
    return scope.item[String(value.$item)];
  }
  if (hasKey(value, "$bindItem") && scope && isPlainObject(scope.item)) {
    return scope.item[String(value.$bindItem)];
  }
  if (hasKey(value, "$index") && scope) return scope.index;
  const resolved: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    resolved[key] = resolveExpression(entry, state, scope);
  }
  return resolved;
}

function bindPointerOf(value: unknown): string | null {
  if (isPlainObject(value) && hasKey(value, "$bindState")) return String(value.$bindState);
  return null;
}

// ---- JSX string building --------------------------------------------------
function jsxText(value: unknown): string {
  return `{${JSON.stringify(stringifyValue(value))}}`;
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function styleAttr(style: Record<string, string | number>): string {
  return `style={${JSON.stringify(style)}}`;
}

function asRecord(props: unknown): Record<string, unknown> {
  return isPlainObject(props) ? props : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// ---- component templates --------------------------------------------------
type TemplateContext = {
  raw: Record<string, unknown>;
  resolved: Record<string, unknown>;
  childrenJsx: string;
  hasState: boolean;
};

type Template = (ctx: TemplateContext) => string;

const Templates: Record<string, Template> = {
  Stack: ({ resolved, childrenJsx }) => {
    const direction = resolved.direction === "horizontal" ? "row" : "column";
    const style: Record<string, string | number> = {
      display: "flex",
      flexDirection: direction,
      gap: GAP_PX[String(resolved.gap ?? "md")] ?? 16,
    };
    if (typeof resolved.align === "string") style.alignItems = resolved.align;
    if (typeof resolved.justify === "string") style.justifyContent = resolved.justify;
    return `<div ${styleAttr(style)}>${childrenJsx}</div>`;
  },
  Grid: ({ resolved, childrenJsx }) => {
    const columns = Number(resolved.columns ?? 2);
    const style: Record<string, string | number> = {
      display: "grid",
      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      gap: GAP_PX[String(resolved.gap ?? "md")] ?? 16,
    };
    return `<div ${styleAttr(style)}>${childrenJsx}</div>`;
  },
  Card: ({ resolved, childrenJsx }) => {
    const style: Record<string, string | number> = {
      background: Palette.card,
      border: `1px solid ${Palette.border}`,
      borderRadius: 24,
      padding: 24,
    };
    if (typeof resolved.maxWidth === "string") {
      style.maxWidth = resolved.maxWidth;
      style.marginLeft = resolved.centered ? "auto" : 0;
      style.marginRight = resolved.centered ? "auto" : 0;
    }
    const title =
      typeof resolved.title === "string"
        ? `<h3 ${styleAttr({ fontSize: 15, fontWeight: 600, marginBottom: 12 })}>${jsxText(resolved.title)}</h3>`
        : "";
    return `<div ${styleAttr(style)}>${title}${childrenJsx}</div>`;
  },
  Separator: () =>
    `<hr ${styleAttr({ height: 1, border: 0, background: Palette.hairline, margin: "4px 0" })} />`,
  Heading: ({ resolved, childrenJsx }) => {
    const level = ["h1", "h2", "h3", "h4"].includes(String(resolved.level))
      ? String(resolved.level)
      : "h2";
    const sizes: Record<string, number> = { h1: 30, h2: 24, h3: 19, h4: 16 };
    const style = { fontSize: sizes[level] ?? 24, fontWeight: 700, letterSpacing: "-0.02em" };
    const text = childrenJsx || jsxText(resolved.text);
    return `<${level} ${styleAttr(style)}>${text}</${level}>`;
  },
  Text: ({ resolved, childrenJsx }) => {
    const variant = String(resolved.variant ?? "body");
    const style: Record<string, string | number> = { fontSize: 15, lineHeight: 1.6 };
    if (variant === "muted" || variant === "caption") style.color = Palette.mutedForeground;
    if (variant === "caption") style.fontSize = 13;
    if (variant === "lead") style.fontSize = 18;
    if (variant === "code") {
      Object.assign(style, {
        fontFamily: "ui-monospace, monospace",
        fontSize: 13,
        background: Palette.muted,
        padding: "1px 6px",
        borderRadius: 6,
      });
      return `<code ${styleAttr(style)}>${childrenJsx || jsxText(resolved.text)}</code>`;
    }
    return `<p ${styleAttr(style)}>${childrenJsx || jsxText(resolved.text)}</p>`;
  },
  Badge: ({ resolved }) => {
    const style = {
      display: "inline-block",
      fontSize: 12,
      padding: "2px 10px",
      borderRadius: 999,
      background: Palette.muted,
      color: Palette.foreground,
    };
    return `<span ${styleAttr(style)}>${jsxText(resolved.text)}</span>`;
  },
  Callout: ({ resolved, childrenJsx }) => {
    const tone = String(resolved.tone ?? "info");
    const accents: Record<string, string> = {
      info: Palette.mutedForeground,
      success: Palette.success,
      warning: "#D97706",
      danger: Palette.destructive,
      tip: Palette.primary,
    };
    const accent = accents[tone] ?? Palette.mutedForeground;
    const style = {
      borderLeft: `3px solid ${accent}`,
      background: Palette.muted,
      borderRadius: 10,
      padding: "12px 16px",
    };
    const title =
      typeof resolved.title === "string"
        ? `<div ${styleAttr({ fontWeight: 600, marginBottom: 4 })}>${jsxText(resolved.title)}</div>`
        : "";
    const body = resolved.body ? `<div>${jsxText(resolved.body)}</div>` : childrenJsx;
    return `<div ${styleAttr(style)}>${title}${body}</div>`;
  },
  Metric: ({ resolved }) => {
    const trend = String(resolved.trend ?? "");
    const deltaColor = trend === "up" ? Palette.success : trend === "down" ? Palette.destructive : Palette.mutedForeground;
    const style = {
      background: Palette.card,
      border: `1px solid ${Palette.border}`,
      borderRadius: 16,
      padding: 20,
    };
    const label = `<div ${styleAttr({ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: Palette.mutedForeground })}>${jsxText(resolved.label)}</div>`;
    const value = `<div ${styleAttr({ fontSize: 28, fontWeight: 700, marginTop: 6 })}>${jsxText(resolved.value)}</div>`;
    const delta = resolved.delta
      ? `<div ${styleAttr({ fontSize: 13, color: deltaColor, marginTop: 4 })}>${jsxText(resolved.delta)}</div>`
      : "";
    return `<div ${styleAttr(style)}>${label}${value}${delta}</div>`;
  },
  CodeBlock: ({ resolved }) => codeBlockJsx(resolved.title, resolved.code),
  Terminal: ({ resolved }) => {
    const command = `$ ${stringifyValue(resolved.command)}`;
    const output = stringifyValue(resolved.output);
    return codeBlockJsx(undefined, `${command}\n${output}`);
  },
  Markdown: ({ resolved }) => {
    const style = { whiteSpace: "pre-wrap" as const, fontSize: 15, lineHeight: 1.6 };
    return `<div ${styleAttr(style)}>${jsxText(resolved.content)}</div>`;
  },
  MermaidEditor: ({ resolved }) => {
    const caption = `<figcaption ${styleAttr({ fontSize: 12, color: Palette.mutedForeground, marginBottom: 6 })}>${jsxText(`Mermaid diagram${typeof resolved.title === "string" ? ` — ${resolved.title}` : ""} (source)`)}</figcaption>`;
    return `<figure ${styleAttr({ margin: 0 })}>${caption}${codeBlockJsx(undefined, resolved.source)}</figure>`;
  },
  Chart: ({ resolved }) => chartJsx(resolved),
  DataTable: ({ resolved }) => dataTableJsx(resolved),
  Table: ({ resolved }) => {
    const columns = asArray(resolved.columns).map((column) => String(column));
    const rows = asArray(resolved.rows).map((row) => asArray(row).map((cell) => stringifyValue(cell)));
    return tableJsx(columns, rows);
  },
  Steps: ({ resolved }) => {
    const items = asArray(resolved.items).map((item) => asRecord(item));
    const lis = items
      .map((item) => `<li ${styleAttr({ marginBottom: 6 })}><strong>${jsxText(item.title)}</strong>${item.detail ? ` — ${JSON.stringify(stringifyValue(item.detail)).slice(1, -1)}` : ""}</li>`)
      .join("");
    return `<ol ${styleAttr({ paddingLeft: 20 })}>${lis}</ol>`;
  },
  TestResults: ({ resolved }) => {
    const summary = `${resolved.passed ?? 0} passed · ${resolved.failed ?? 0} failed${resolved.skipped ? ` · ${resolved.skipped} skipped` : ""}`;
    const failures = asArray(resolved.failures)
      .map((failure) => asRecord(failure))
      .map((failure) => `<li>${jsxText(failure.name)}${failure.message ? `: ${JSON.stringify(stringifyValue(failure.message)).slice(1, -1)}` : ""}</li>`)
      .join("");
    const list = failures ? `<ul ${styleAttr({ marginTop: 8, color: Palette.destructive })}>${failures}</ul>` : "";
    return `<div ${styleAttr({ background: Palette.card, border: `1px solid ${Palette.border}`, borderRadius: 16, padding: 16 })}><div ${styleAttr({ fontWeight: 600 })}>${jsxText(summary)}</div>${list}</div>`;
  },
  FileChange: ({ resolved }) => {
    const detail = `${resolved.kind ?? "modified"}${resolved.additions ? ` +${resolved.additions}` : ""}${resolved.deletions ? ` -${resolved.deletions}` : ""}`;
    return `<div ${styleAttr({ fontFamily: "ui-monospace, monospace", fontSize: 13, padding: "6px 0" })}><span ${styleAttr({ fontWeight: 600 })}>${jsxText(resolved.path)}</span> <span ${styleAttr({ color: Palette.mutedForeground })}>${jsxText(detail)}</span></div>`;
  },
  Button: ({ resolved }) => {
    const style = {
      display: "inline-block",
      background: Palette.primary,
      color: "#fff",
      border: 0,
      borderRadius: 999,
      padding: "8px 16px",
      fontSize: 14,
    };
    return `<button type="button" ${styleAttr(style)}>${jsxText(resolved.label)}</button>`;
  },
  Link: ({ resolved }) =>
    `<a href={${JSON.stringify(stringifyValue(resolved.href))}} ${styleAttr({ color: Palette.primary })}>${jsxText(resolved.label)}</a>`,
  Input: (ctx) => inputJsx(ctx),
  Textarea: (ctx) => inputJsx(ctx, true),
};

function codeBlockJsx(title: unknown, code: unknown): string {
  const header =
    typeof title === "string"
      ? `<div ${styleAttr({ fontFamily: "ui-monospace, monospace", fontSize: 12, color: Palette.mutedForeground, marginBottom: 8 })}>${jsxText(title)}</div>`
      : "";
  const preStyle = {
    background: Palette.muted,
    borderRadius: 10,
    padding: 16,
    overflow: "auto" as const,
    fontFamily: "ui-monospace, monospace",
    fontSize: 13,
    lineHeight: 1.6,
  };
  return `<div>${header}<pre ${styleAttr(preStyle)}><code>${jsxText(code)}</code></pre></div>`;
}

function tableJsx(headers: string[], rows: string[][]): string {
  const thead = `<thead><tr>${headers.map((header) => `<th ${styleAttr({ textAlign: "left", padding: "8px 12px", borderBottom: `1px solid ${Palette.border}`, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: Palette.mutedForeground })}>${jsxText(header)}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td ${styleAttr({ padding: "8px 12px", borderTop: `1px solid ${Palette.border}`, fontSize: 14 })}>${jsxText(cell)}</td>`).join("")}</tr>`,
    )
    .join("")}</tbody>`;
  const wrapperStyle = { background: Palette.card, border: `1px solid ${Palette.border}`, borderRadius: 16, padding: 8, overflow: "auto" as const };
  return `<div ${styleAttr(wrapperStyle)}><table ${styleAttr({ width: "100%", borderCollapse: "collapse" })}>${thead}${tbody}</table></div>`;
}

function dataTableJsx(props: Record<string, unknown>): string {
  const columns = asArray(props.columns).map((column) => asRecord(column));
  const headers = columns.map((column) => stringifyValue(column.header ?? column.key));
  const rows = asArray(props.rows).map((row) => {
    const record = asRecord(row);
    return columns.map((column) => stringifyValue(record[String(column.key)]));
  });
  const caption =
    typeof props.caption === "string"
      ? `<div ${styleAttr({ fontSize: 14, fontWeight: 600, marginBottom: 8 })}>${jsxText(props.caption)}</div>`
      : "";
  return `<div>${caption}${tableJsx(headers, rows)}</div>`;
}

function chartJsx(props: Record<string, unknown>): string {
  const yKeys = Array.isArray(props.y) ? props.y.map((key) => String(key)) : [String(props.y ?? "value")];
  const xKey = String(props.x ?? "x");
  const headers = [xKey, ...yKeys];
  const rows = asArray(props.data).map((row) => {
    const record = asRecord(row);
    return headers.map((key) => stringifyValue(record[key]));
  });
  const title =
    typeof props.title === "string"
      ? `<figcaption ${styleAttr({ fontSize: 15, fontWeight: 600, marginBottom: 8 })}>${jsxText(props.title)}</figcaption>`
      : "";
  const note = `<div ${styleAttr({ fontSize: 12, color: Palette.mutedForeground, marginTop: 6 })}>${jsxText(`${String(props.kind ?? "chart")} chart — plot with your chart library of choice`)}</div>`;
  return `<figure ${styleAttr({ margin: 0 })}>${title}${tableJsx(headers, rows)}${note}</figure>`;
}

function inputJsx(ctx: TemplateContext, multiline = false): string {
  const { raw, resolved, hasState } = ctx;
  const label = typeof resolved.label === "string"
    ? `<label ${styleAttr({ display: "block", fontSize: 13, marginBottom: 6, color: Palette.mutedForeground })}>${jsxText(resolved.label)}</label>`
    : "";
  const tag = multiline ? "textarea" : "input";
  const pointer = bindPointerOf(raw.value);
  const inputStyle = { width: "100%", padding: "8px 12px", border: `1px solid ${Palette.border}`, borderRadius: 10, fontSize: 14 };
  const controlled =
    pointer && hasState
      ? `value={String(getAtPointer(state, ${JSON.stringify(pointer)}) ?? "")} onChange={(event) => setState((current) => setAtPointer(current, ${JSON.stringify(pointer)}, event.target.value))}`
      : `defaultValue={${JSON.stringify(stringifyValue(resolved.value))}}`;
  const placeholder = typeof resolved.placeholder === "string" ? ` placeholder={${JSON.stringify(resolved.placeholder)}}` : "";
  return `<div>${label}<${tag} ${controlled}${placeholder} ${styleAttr(inputStyle)} /></div>`;
}

// A minimal, honest fallback for any catalog type without a bespoke template:
// render the children in a labeled box so nothing silently disappears.
function fallbackJsx(type: string, childrenJsx: string): string {
  const style = { border: `1px dashed ${Palette.border}`, borderRadius: 12, padding: 16 };
  const label = `<div ${styleAttr({ fontSize: 11, color: Palette.mutedForeground, marginBottom: 8 })}>${jsxText(type)}</div>`;
  return `<div ${styleAttr(style)}>${label}${childrenJsx}</div>`;
}

// ---- tree walk ------------------------------------------------------------
type WalkContext = { spec: JsonRenderSpec; state: State; hasState: boolean };

function renderElement(key: string, ctx: WalkContext, scope: ItemScope): string {
  const element: UIElement | undefined = ctx.spec.elements[key];
  if (!element) return "";
  if (element.repeat) {
    const list = getAtPointer(ctx.state, element.repeat.statePath);
    if (!Array.isArray(list)) return "";
    return list
      .map((item, index) => renderInstance(element, ctx, { item, index }))
      .join("");
  }
  return renderInstance(element, ctx, scope);
}

function renderInstance(element: UIElement, ctx: WalkContext, scope: ItemScope): string {
  if (element.visible !== undefined && !evaluateCondition(element.visible, ctx.state, scope)) {
    return "";
  }
  const raw = asRecord(element.props);
  const resolved = asRecord(resolveExpression(raw, ctx.state, scope));
  const childrenJsx = (element.children ?? [])
    .map((childKey) => renderElement(childKey, ctx, scope))
    .join("");
  const template = Templates[element.type];
  if (!template) return fallbackJsx(element.type, childrenJsx);
  return template({ raw, resolved, childrenJsx, hasState: ctx.hasState });
}

// ---- state detection + helpers emission -----------------------------------
function specHasBoundInput(spec: JsonRenderSpec): boolean {
  return Object.values(spec.elements).some((element) => propsContainBind(element.props));
}

function propsContainBind(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(propsContainBind);
  if (!isPlainObject(value)) return false;
  if (hasKey(value, "$bindState")) return true;
  return Object.values(value).some(propsContainBind);
}

const POINTER_HELPERS = `type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function getAtPointer(root: JsonValue, pointer: string): JsonValue {
  const segments = pointer.split("/").slice(1);
  let current: JsonValue = root;
  for (const segment of segments) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return null;
    current = current[segment] ?? null;
  }
  return current;
}

function setAtPointer(root: JsonValue, pointer: string, value: JsonValue): JsonValue {
  const segments = pointer.split("/").slice(1);
  if (segments.length === 0) return value;
  const base: JsonValue = root !== null && typeof root === "object" && !Array.isArray(root) ? { ...root } : {};
  const [head, ...rest] = segments;
  const child = (base as { [key: string]: JsonValue })[head] ?? null;
  (base as { [key: string]: JsonValue })[head] =
    rest.length === 0 ? value : setAtPointer(child, "/" + rest.join("/"), value);
  return base;
}`;

// ---- assembly -------------------------------------------------------------
export type ReactSourceOptions = { componentName?: string };

const DEFAULT_COMPONENT_NAME = "ExportedCanvas";

function sanitizeComponentName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()).replace(/\s+/g, "");
  return /^[A-Za-z]/.test(cleaned) ? cleaned : DEFAULT_COMPONENT_NAME;
}

export function specToReactSource(spec: JsonRenderSpec, options: ReactSourceOptions = {}): string {
  const state = (spec.state ?? {}) as State;
  const hasState = specHasBoundInput(spec);
  const componentName = options.componentName
    ? sanitizeComponentName(options.componentName)
    : DEFAULT_COMPONENT_NAME;
  const body = renderElement(spec.root, { spec, state, hasState }, null);

  const importLine = hasState ? `import { useState } from "react";` : `import type { JSX } from "react";`;
  const helpers = hasState ? `\n${POINTER_HELPERS}\n` : "";
  const stateSeed = hasState
    ? `\n  const [state, setState] = useState<JsonValue>(${JSON.stringify(state, null, 2)} as JsonValue);\n`
    : "";
  const returnType = hasState ? "" : ": JSX.Element";

  return `${importLine}
${helpers}
// Generated by parchment "Copy as React". Catalog components are inlined as
// minimal, self-contained equivalents; adapt freely.
export default function ${componentName}()${returnType} {${stateSeed}
  return (
    ${body || "<div />"}
  );
}
`;
}
