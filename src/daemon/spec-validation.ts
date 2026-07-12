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
import { extractIntentMenu } from "./intents.ts";
import type { JsonRenderSpec, UIElement } from "../shared/types.ts";

export type SpecPreparation = {
  spec: JsonRenderSpec;
  issues: string[];
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
  const issues = [
    ...collectStructuralIssues(normalized),
    ...collectMissingChildIssues(normalized),
    ...collectPropIssues(normalized),
    ...collectUnseededStateIssues(normalized),
    ...collectChartDataIssues(normalized),
    ...extractIntentMenu(normalized).issues,
  ];
  return { spec: normalized, issues };
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
