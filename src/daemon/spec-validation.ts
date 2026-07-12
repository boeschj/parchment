// Single-pass spec validation. canvas_render and canvas_patch run every spec
// through prepareSpec before it reaches a browser: it silently repairs the
// mistakes that can be repaired, and rejects the rest with messages precise
// enough that the model fixes them in ONE retry — the element key, the exact
// path, and the exact fix.
//
// This is deliberately hand-written rather than json-render's catalog.validate:
// that path strips the interactive fields (on/repeat/watch/state) the canvas
// depends on (json-render #222). We borrow only autoFixSpec + validateSpec from
// core and enrich their output here.

import { autoFixSpec, validateSpec, type Spec, type SpecIssue } from "@json-render/core";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import * as z from "zod/v4";
import { canvasCatalog, CanvasExtensionDefinitions } from "../shared/catalog/index.ts";
import { ChartXScale } from "../shared/catalog/extensions/Chart.ts";
import { extractIntentMenu } from "./intents.ts";
import type { JsonRenderSpec, UIElement } from "../shared/types.ts";

export type SpecPreparation = {
  spec: JsonRenderSpec;
  issues: string[];
  // Wrong-but-obvious enum values we silently coerced to a catalog value, one
  // human-readable line each (e.g. 'elements/page/props/gap: coerced 16 → "md"').
  repairs: string[];
};

const CHART_TYPE = "Chart";
const TEMPLATE_TOKEN = /\$\{([^}]+)\}/g;

// json-render's own Spec type omits the interactive fields our JsonRenderSpec
// carries (json-render #222), so the two core helpers are bridged at this one
// boundary. Every other function below works on our JsonRenderSpec with no cast.
function toCoreSpec(spec: JsonRenderSpec): Spec {
  return spec as unknown as Spec;
}

function fromCoreSpec(spec: Spec): JsonRenderSpec {
  return spec as unknown as JsonRenderSpec;
}

// The one entry point. autoFixSpec relocates on/repeat/watch/visible that landed
// inside props back to the element level; withLeafChildren guarantees every
// element carries a children array. Both are silent repairs — a zero-retry path
// to a correct render — so they never surface as issues.
export function prepareSpec(spec: JsonRenderSpec): SpecPreparation {
  const { spec: autofixed } = autoFixSpec(toCoreSpec(spec));
  const normalized = withLeafChildren(fromCoreSpec(autofixed));
  const { spec: repaired, repairs } = repairEnumSynonyms(normalized);
  const issues = [
    ...collectStructuralIssues(repaired),
    ...collectMissingChildIssues(repaired),
    ...collectPropIssues(repaired),
    ...collectUnseededStateIssues(repaired),
    ...collectChartDataIssues(repaired),
    ...extractIntentMenu(repaired).issues,
  ];
  return { spec: repaired, issues, repairs };
}

function withLeafChildren(spec: JsonRenderSpec): JsonRenderSpec {
  const elements: Record<string, UIElement> = {};
  for (const [key, element] of Object.entries(spec.elements)) {
    elements[key] = element.children === undefined ? { ...element, children: [] } : element;
  }
  return { ...spec, elements };
}

// ---- Structure -------------------------------------------------------------

function collectStructuralIssues(spec: JsonRenderSpec): string[] {
  const result = validateSpec(toCoreSpec(spec), { checkOrphans: false });
  const issues: string[] = [];
  for (const issue of result.issues) {
    if (issue.severity !== "error") continue;
    // missing_child is reported separately, with the exact child key + fix.
    if (issue.code === "missing_child") continue;
    issues.push(structuralMessage(issue, spec));
  }
  return issues;
}

function structuralMessage(issue: SpecIssue, spec: JsonRenderSpec): string {
  if (issue.code === "missing_root") {
    return `spec has no "root": set "root" to the key of your top-level element (usually the outer Stack).`;
  }
  if (issue.code === "root_not_found") {
    return `root "${spec.root}" is not defined in "elements": add an element with key "${spec.root}", or point "root" at an existing key.`;
  }
  if (issue.code === "empty_spec") {
    return `"elements" is empty: a spec needs at least one element (the root).`;
  }
  // on/repeat/watch/visible-in-props are auto-repaired before we get here; any
  // other code is surfaced verbatim so nothing json-render flags is swallowed.
  const prefix = issue.elementKey ? `elements/${issue.elementKey}: ` : "";
  return `${prefix}${issue.message}`;
}

function collectMissingChildIssues(spec: JsonRenderSpec): string[] {
  const issues: string[] = [];
  for (const [key, element] of Object.entries(spec.elements)) {
    for (const childKey of element.children ?? []) {
      if (spec.elements[childKey]) continue;
      issues.push(
        `elements/${key}: children references "${childKey}", which is not defined in "elements". ` +
          `Add an element with key "${childKey}", or remove "${childKey}" from elements/${key}/children.`,
      );
    }
  }
  return issues;
}

// ---- Component props -------------------------------------------------------

// Every prop schema is applied with .partial(). Required props are routinely
// supplied as runtime expressions ({$state}/{$template}) which staticPropsOnly
// strips before validation, so enforcing required-ness here would reject valid
// live-bound specs (e.g. a Metric with value: {$template}, the flagship
// live-dashboard shape). partial() still catches wrong types and bad enum values
// on the static props that ARE present — the real single-pass wins — while
// expression-bound props are covered by the state-seeding and chart-data checks.
const ComponentPropSchemas: Record<string, z.ZodType> = Object.fromEntries(
  Object.entries({ ...shadcnComponentDefinitions, ...CanvasExtensionDefinitions }).map(
    ([name, definition]) => {
      const propsSchema = definition.props as unknown as z.ZodObject;
      return [name, propsSchema.partial()] as const;
    },
  ),
);

// Expression-valued props ({$state}, {$bindState}, {$template}, ...) resolve at
// render time, so their static type never matches the prop schema — skip them.
function isExpressionValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(isExpressionValue);
  if (!isPlainObject(value)) return false;
  return Object.keys(value).some((key) => key.startsWith("$"));
}

function staticPropsOnly(props: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(props).filter(([, value]) => !isExpressionValue(value));
  return Object.fromEntries(entries);
}

function collectPropIssues(spec: JsonRenderSpec): string[] {
  const issues: string[] = [];
  for (const [key, element] of Object.entries(spec.elements)) {
    const schema = ComponentPropSchemas[element.type];
    if (!schema) {
      const known = canvasCatalog.componentNames.join(", ");
      issues.push(`elements/${key}: unknown component type "${element.type}". Known types: ${known}`);
      continue;
    }
    const parsed = schema.safeParse(staticPropsOnly(element.props ?? {}));
    if (parsed.success) continue;
    for (const issue of parsed.error.issues) {
      const path = issue.path.length > 0 ? `props/${issue.path.join("/")}` : "props";
      issues.push(`elements/${key}/${path}: ${issue.message}`);
    }
  }
  return issues;
}

// ---- Enum synonym auto-repair ----------------------------------------------
// A model sometimes emits a wrong-but-obvious enum value: gap: 16, level: 1,
// variant: "default", xScale: "linear". Rather than bounce the whole spec on a
// value we can resolve unambiguously, we coerce it to the catalog value and
// record the repair; the coerced spec then passes the prop check above.
// Genuinely ambiguous values are left untouched so that check still rejects
// them with the exact fix. Every candidate is verified against the real
// component schema before it is applied, so a coercion can never introduce an
// invalid value even if a synonym map drifts from the catalog.

type CandidateResolver = (value: unknown) => string[];

// The spacing scale a numeric gap is read against (as pixels); the nearest
// token wins, ties break toward the more visible (larger) token. Grid has no
// "none", so gapCandidates offers "sm"/"md" fallbacks (verified per-component).
const GAP_TOKENS = ["none", "sm", "md", "lg", "xl"] as const;
type GapToken = (typeof GAP_TOKENS)[number];
const GAP_TOKEN_PIXELS: Record<GapToken, number> = { none: 0, sm: 8, md: 16, lg: 24, xl: 32 };

const SPACING_WORD_TO_TOKEN = {
  none: "none",
  zero: "none",
  tiny: "sm",
  small: "sm",
  medium: "md",
  normal: "md",
  large: "lg",
  big: "lg",
  xlarge: "xl",
  huge: "xl",
} as const;

const DIRECTION_TO_TOKEN = {
  row: "horizontal",
  horizontal: "horizontal",
  column: "vertical",
  col: "vertical",
  vertical: "vertical",
} as const;

const BUTTON_VARIANT_TO_TOKEN = {
  default: "primary",
  destructive: "danger",
  error: "danger",
  outline: "secondary",
  ghost: "secondary",
  link: "secondary",
} as const;

const BADGE_VARIANT_TO_TOKEN = {
  danger: "destructive",
  error: "destructive",
  primary: "default",
} as const;

const TEXT_VARIANT_TO_TOKEN = {
  default: "body",
  normal: "body",
  secondary: "muted",
  subtle: "muted",
  small: "caption",
  subtitle: "lead",
} as const;

const CHART_XSCALE_TO_TOKEN = {
  linear: ChartXScale.Category,
  numeric: ChartXScale.Category,
  ordinal: ChartXScale.Category,
  timestamp: ChartXScale.Time,
  datetime: ChartXScale.Time,
  date: ChartXScale.Time,
} as const;

const HEADING_LEVEL_MIN = 1;
const HEADING_LEVEL_MAX = 4;

const PropCoercions: Record<string, Record<string, CandidateResolver>> = {
  Stack: { gap: gapCandidates, direction: wordResolver(DIRECTION_TO_TOKEN) },
  Grid: { gap: gapCandidates },
  Heading: { level: headingLevelCandidates },
  Button: { variant: wordResolver(BUTTON_VARIANT_TO_TOKEN) },
  Badge: { variant: wordResolver(BADGE_VARIANT_TO_TOKEN) },
  Text: { variant: wordResolver(TEXT_VARIANT_TO_TOKEN) },
  Chart: { xScale: wordResolver(CHART_XSCALE_TO_TOKEN) },
};

type RepairResult = { spec: JsonRenderSpec; repairs: string[] };

function repairEnumSynonyms(spec: JsonRenderSpec): RepairResult {
  const repairs: string[] = [];
  const elements: Record<string, UIElement> = {};
  for (const [key, element] of Object.entries(spec.elements)) {
    elements[key] = coerceElementProps(key, element, repairs);
  }
  return { spec: { ...spec, elements }, repairs };
}

function coerceElementProps(key: string, element: UIElement, repairs: string[]): UIElement {
  const resolvers = PropCoercions[element.type];
  if (!resolvers) return element;
  const props = { ...element.props };
  let changed = false;
  for (const [prop, resolver] of Object.entries(resolvers)) {
    const original = props[prop];
    if (original === undefined) continue;
    if (isExpressionValue(original)) continue;
    if (isValidPropValue(element.type, prop, original)) continue;
    const coerced = firstValidCandidate(element.type, prop, resolver(original));
    if (coerced === null) continue;
    props[prop] = coerced;
    changed = true;
    repairs.push(
      `elements/${key}/props/${prop}: coerced ${JSON.stringify(original)} → ${JSON.stringify(coerced)}`,
    );
  }
  return changed ? { ...element, props } : element;
}

function isValidPropValue(type: string, prop: string, value: unknown): boolean {
  const schema = ComponentPropSchemas[type];
  if (!schema) return false;
  return schema.safeParse({ [prop]: value }).success;
}

function firstValidCandidate(type: string, prop: string, candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (isValidPropValue(type, prop, candidate)) return candidate;
  }
  return null;
}

function gapCandidates(value: unknown): string[] {
  const pixels = numericPixels(value);
  if (pixels !== null) {
    return dedupe([nearestGapToken(pixels), "sm", "md"]);
  }
  if (typeof value === "string") {
    const mapped = lookupSynonym(SPACING_WORD_TO_TOKEN, value);
    return mapped ? [mapped] : [];
  }
  return [];
}

// A gap given as a number (16) or a numeric string ("16") is read as pixels.
function numericPixels(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number.parseFloat(value.trim());
  }
  return null;
}

function nearestGapToken(pixels: number): GapToken {
  let best: GapToken = "md";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const token of GAP_TOKENS) {
    const distance = Math.abs(GAP_TOKEN_PIXELS[token] - pixels);
    const isCloser = distance < bestDistance;
    const isTieButMoreVisible =
      distance === bestDistance && GAP_TOKEN_PIXELS[token] > GAP_TOKEN_PIXELS[best];
    if (isCloser || isTieButMoreVisible) {
      best = token;
      bestDistance = distance;
    }
  }
  return best;
}

function headingLevelCandidates(value: unknown): string[] {
  const parsed = parseLeadingInt(value);
  if (parsed === null) return [];
  const clamped = Math.min(Math.max(parsed, HEADING_LEVEL_MIN), HEADING_LEVEL_MAX);
  return [`h${clamped}`];
}

function parseLeadingInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string") {
    const match = value.match(/\d+/);
    if (match) return Number.parseInt(match[0], 10);
  }
  return null;
}

function wordResolver(map: Readonly<Record<string, string>>): CandidateResolver {
  return (value) => {
    if (typeof value !== "string") return [];
    const mapped = lookupSynonym(map, value);
    return mapped ? [mapped] : [];
  };
}

function lookupSynonym(map: Readonly<Record<string, string>>, key: string): string | null {
  const normalized = key.trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(map, normalized)) return null;
  return map[normalized] ?? null;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

// ---- State seeding ---------------------------------------------------------

type StateReference = { pointer: string; location: string };

// A $state/$bindState/$template/repeat/watch binding whose top-level state key
// was never seeded renders blank forever. We check the FIRST pointer segment so
// live-fed deep paths (the daemon writes into a seeded container) never trip.
function collectUnseededStateIssues(spec: JsonRenderSpec): string[] {
  const seededKeys = new Set(Object.keys(spec.state ?? {}));
  const issues: string[] = [];
  for (const [key, element] of Object.entries(spec.elements)) {
    for (const reference of stateReferencesOf(element)) {
      const topKey = firstPointerSegment(reference.pointer);
      if (topKey === null) continue;
      if (seededKeys.has(topKey)) continue;
      issues.push(
        `elements/${key}${reference.location}: binds to state path "${reference.pointer}" but "/${topKey}" is not seeded in the spec-level "state" object. ` +
          `Add "${topKey}" to "state" (e.g. "state": {"${topKey}": ...}) so the binding resolves.`,
      );
    }
  }
  return issues;
}

function stateReferencesOf(element: UIElement): StateReference[] {
  const references: StateReference[] = [];
  collectReferencesFromValue(element.props, "/props", references);
  collectReferencesFromValue(element.visible, "/visible", references);
  collectReferencesFromValue(element.on, "/on", references);
  if (element.repeat?.statePath) {
    references.push({ pointer: element.repeat.statePath, location: "/repeat/statePath" });
  }
  for (const watchPath of Object.keys(element.watch ?? {})) {
    references.push({ pointer: watchPath, location: "/watch" });
  }
  return references;
}

function collectReferencesFromValue(value: unknown, location: string, out: StateReference[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectReferencesFromValue(entry, `${location}/${index}`, out));
    return;
  }
  if (!isPlainObject(value)) return;
  const stateRead = value.$state ?? value.$bindState;
  if (typeof stateRead === "string") {
    out.push({ pointer: stateRead, location });
    return;
  }
  if (typeof value.$template === "string") {
    for (const pointer of templatePointers(value.$template)) {
      out.push({ pointer, location });
    }
    return;
  }
  for (const [propKey, propValue] of Object.entries(value)) {
    collectReferencesFromValue(propValue, `${location}/${propKey}`, out);
  }
}

// Only absolute pointers ("${/path}") are checkable against root state; bare
// tokens ("${count}") resolve in repeat-item or computed scope, so we skip them.
function templatePointers(template: string): string[] {
  const pointers: string[] = [];
  for (const match of template.matchAll(TEMPLATE_TOKEN)) {
    const token = match[1];
    if (token === undefined) continue;
    const trimmed = token.trim();
    if (trimmed.startsWith("/")) pointers.push(trimmed);
  }
  return pointers;
}

function firstPointerSegment(pointer: string): string | null {
  if (!pointer.startsWith("/")) return null;
  const firstSegment = pointer.slice(1).split("/")[0] ?? "";
  if (firstSegment.length === 0) return null;
  return decodePointerSegment(firstSegment);
}

function decodePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

// ---- Chart data ------------------------------------------------------------

function collectChartDataIssues(spec: JsonRenderSpec): string[] {
  const issues: string[] = [];
  for (const [key, element] of Object.entries(spec.elements)) {
    if (element.type !== CHART_TYPE) continue;
    const issue = firstChartDataIssue(key, element.props);
    if (issue) issues.push(issue);
  }
  return issues;
}

function firstChartDataIssue(key: string, props: Record<string, unknown>): string | null {
  const data = props.data;
  if (!Array.isArray(data)) return null; // {$state}/live-fed data validates at runtime
  const seriesKeys = seriesKeysOf(props.y);
  if (seriesKeys.length === 0) return null;
  for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
    const row = data[rowIndex];
    if (!isPlainObject(row)) continue;
    for (const seriesKey of seriesKeys) {
      const cell = row[seriesKey];
      if (cell === undefined || cell === null) continue;
      if (typeof cell === "number") continue;
      return (
        `elements/${key}/props/data: Chart series "${seriesKey}" has a non-numeric value ${JSON.stringify(cell)} at row ${rowIndex}. ` +
        `Chart plots raw numbers (e.g. 57, not "57" or "57%"). Convert the series values to numbers; keep preformatted strings for Metric or DataTable.`
      );
    }
  }
  return null;
}

function seriesKeysOf(y: unknown): string[] {
  if (typeof y === "string") return [y];
  if (Array.isArray(y)) return y.filter((entry): entry is string => typeof entry === "string");
  return [];
}

// ---- Shared ----------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
