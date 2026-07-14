// Single-pass spec validation. canvas_render and canvas_patch run every spec
// through prepareSpec before it reaches a browser. Props arriving in a declared
// input form (src/shared/catalog/prop-normal-forms.ts) are normalized to the
// normal form the renderer consumes; everything else that fails is rejected
// with messages precise enough that the model fixes them in ONE retry — the
// element key, the exact path, and the exact fix.
//
// A spec that passes here RENDERS. Every prop name, required prop, event,
// action, binding and check is validated against the contract the renderer
// actually implements (src/shared/catalog/component-contracts.ts), because a
// prop the renderer never reads is a prop the model believes it set: a Chart
// with {chartType, xKey, series} draws an empty box, a MermaidEditor with
// `code` draws nothing, a Button with on.click does nothing. All three used to
// validate.
//
// This is deliberately hand-written rather than json-render's catalog.validate:
// that path strips the interactive fields (on/repeat/watch/state) the canvas
// depends on (json-render #222). We borrow only autoFixSpec + validateSpec from
// core and enrich their output here.

import { autoFixSpec, validateSpec, type Spec, type SpecIssue } from "@json-render/core";
import * as z from "zod/v4";
import { canvasCatalog } from "../shared/catalog/index.ts";
import {
  ComponentContracts,
  ElementFields,
  KnownActionNames,
  KnownCheckTypes,
  type ComponentContract,
} from "../shared/catalog/component-contracts.ts";
import {
  PropNameAliases,
  PropNormalForms,
  WidenedComponentPropSchemas,
} from "../shared/catalog/prop-normal-forms.ts";
import {
  elementLevelReferenceOf,
  isExpressionValue,
  isPlainObject,
  parseStateShorthand,
} from "../shared/expressions.ts";
import { extractIntentMenu } from "./intents.ts";
import type { JsonRenderSpec, UIElement } from "../shared/types.ts";

// The element the daemon will actually render: an element-level reference
// ({"$diff": "src/a.ts"} on a DiffViewer) is expanded at push time into the
// props it supplies. Validation runs first, so it checks this post-expansion
// view — otherwise the authored form is rejected for props about to be filled.
// A state binding stands in for each supplied value: same shape hydration writes.
function withElementLevelReferenceExpanded(element: UIElement): UIElement {
  const props = element.props ?? {};
  const contract = elementLevelReferenceOf(element.type, props);
  if (!contract) return element;

  const expanded: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(props)) {
    if (contract.consumes.includes(name)) continue;
    expanded[name] = value;
  }
  for (const supplied of contract.supplies) {
    if (expanded[supplied] === undefined) expanded[supplied] = { $state: "/hydrated" };
  }
  return { ...element, props: expanded };
}

export type SpecPreparation = {
  spec: JsonRenderSpec;
  issues: string[];
  // Declared-form normalizations we applied, one human-readable line each
  // (e.g. 'elements/page/props/gap: coerced 16 → "md"') — observability into
  // every rewrite the spec went through.
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
  const normalized = withElementDefaults(fromCoreSpec(autofixed));
  const repairs: string[] = [];
  let repaired = repairUnknownComponentTypes(normalized, repairs);
  repaired = normalizeExpressionShorthand(repaired, repairs);
  repaired = applyDeclaredNormalForms(repaired, repairs);
  const issues = [
    ...collectStructuralIssues(repaired),
    ...collectMissingChildIssues(repaired),
    ...collectElementFieldIssues(repaired),
    ...collectPropIssues(repaired),
    ...collectEventIssues(repaired),
    ...collectWatchIssues(repaired),
    ...collectUnseededStateIssues(repaired),
    ...collectChartDataIssues(repaired),
    ...extractIntentMenu(repaired).issues,
  ];
  return { spec: repaired, issues, repairs };
}

function withElementDefaults(spec: JsonRenderSpec): JsonRenderSpec {
  const elements: Record<string, UIElement> = {};
  for (const [key, element] of Object.entries(spec.elements)) {
    elements[key] = {
      ...element,
      props: element.props ?? {},
      children: element.children ?? [],
    };
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

// ---- Element fields --------------------------------------------------------

// The renderer reads exactly seven fields off an element. A binding hoisted to
// the element ("$bindState": {"value": "form.name"}) or a state object parked
// there is silently dropped — the input renders unbound and the form does
// nothing.

const ELEMENT_FIELD_NAMES: ReadonlySet<string> = new Set(ElementFields);

function collectElementFieldIssues(spec: JsonRenderSpec): string[] {
  const issues: string[] = [];
  for (const [key, element] of Object.entries(spec.elements)) {
    for (const field of Object.keys(element)) {
      if (ELEMENT_FIELD_NAMES.has(field)) continue;
      issues.push(
        `elements/${key}: unknown element field "${field}". An element carries only: ${ElementFields.join(", ")}.` +
          elementFieldHint(field),
      );
    }
  }
  return issues;
}

function elementFieldHint(field: string): string {
  if (field.startsWith("$")) {
    return ` Expressions belong on the prop they drive: "props": {"value": {"${field}": "/form/name"}}.`;
  }
  if (field === "state") {
    return ` State is seeded once at the top of the spec ("state": {...}), not per element.`;
  }
  return "";
}

// ---- Component props -------------------------------------------------------

// Validation parses against the WIDENED schemas from prop-normal-forms.ts, so
// the declared input forms (gap 16, level 1, xKey) pass straight through. Each
// prop is checked on its own — never through .partial() on the whole object,
// which hid every missing required prop, and never after stripping expressions,
// which hid the rest.
//
// Presence-aware required-ness: a required prop is satisfied by ANY value,
// including a runtime expression ({$state}/{$template}/{$bindState}/{$item}),
// because the value arrives at render time. It is NOT satisfied by absence —
// a Chart with no `data` and no `kind` is an empty box, and used to validate.

const MAX_SUGGESTION_DISTANCE = 2;

function collectPropIssues(spec: JsonRenderSpec): string[] {
  const issues: string[] = [];
  for (const [key, element] of Object.entries(spec.elements)) {
    const contract = ComponentContracts[element.type];
    if (!contract) {
      const known = canvasCatalog.componentNames.join(", ");
      issues.push(`elements/${key}: unknown component type "${element.type}". Known types: ${known}`);
      continue;
    }
    // An element-level reference ({"$diff": "src/a.ts"} on a DiffViewer) is
    // expanded by the daemon at push time, AFTER this runs. Validate the
    // post-expansion shape so the authored form isn't rejected for props the
    // hydrator is about to supply.
    const elementView = withElementLevelReferenceExpanded(element);
    issues.push(...unknownPropIssues(key, elementView, contract));
    issues.push(...missingRequiredPropIssues(key, elementView, contract));
    issues.push(...staticPropTypeIssues(key, elementView));
    issues.push(...bindStateIssues(key, elementView, contract));
    issues.push(...formCheckIssues(key, elementView, contract));
  }
  return issues;
}

function unknownPropIssues(
  key: string,
  element: UIElement,
  contract: ComponentContract,
): string[] {
  const issues: string[] = [];
  for (const propName of Object.keys(element.props)) {
    if (contract.knownProps.includes(propName)) continue;
    const suggestion = suggestedPropName(propName, element.type, contract);
    const didYouMean = suggestion === null ? "" : ` Did you mean "${suggestion}"?`;
    issues.push(
      `elements/${key}/props/${propName}: unknown prop "${propName}" for ${element.type} — the renderer ignores it.${didYouMean} ` +
        `${element.type} accepts: ${contract.knownProps.join(", ")}.`,
    );
  }
  return issues;
}

// A declared alias that survived normalization (the normal-form name was
// already set, so the rename was skipped) resolves to its normal name; every
// other unknown name falls back to nearest-neighbour, which catches typos and
// stays silent on genuine dialect (there is no honest guess from "chartType"
// to "kind" — the known-prop list is the fix).
function suggestedPropName(
  propName: string,
  componentType: string,
  contract: ComponentContract,
): string | null {
  const aliases = PropNameAliases[componentType] ?? {};
  const aliasTarget = aliases[propName.toLowerCase()];
  if (aliasTarget !== undefined) return aliasTarget;
  return nearestName(propName, contract.knownProps);
}

function missingRequiredPropIssues(
  key: string,
  element: UIElement,
  contract: ComponentContract,
): string[] {
  const missing = contract.requiredProps.filter(
    (propName) => element.props[propName] === undefined,
  );
  return missing.map(
    (propName) =>
      `elements/${key}/props/${propName}: ${element.type} requires "${propName}", which is missing — ` +
      `give it a value or bind it ({"$state": "/path"}). ${element.type} requires: ${contract.requiredProps.join(", ")}.`,
  );
}

function staticPropTypeIssues(key: string, element: UIElement): string[] {
  const schema = WidenedComponentPropSchemas[element.type];
  if (!schema) return [];
  const issues: string[] = [];
  for (const [propName, value] of Object.entries(element.props)) {
    const field = schema.shape[propName];
    if (!field) continue;
    // {$state}/{$template}/{$item}/... resolve at render time; their shape is
    // checked by the state-seeding and chart-data passes, not by the schema.
    if (isExpressionValue(value)) continue;
    const parsed = field.safeParse(value);
    if (parsed.success) continue;
    for (const issue of parsed.error.issues) {
      const path = [propName, ...issue.path].join("/");
      issues.push(`elements/${key}/props/${path}: ${issue.message}`);
    }
  }
  return issues;
}

// ---- Two-way bindings ------------------------------------------------------

function bindStateIssues(
  key: string,
  element: UIElement,
  contract: ComponentContract,
): string[] {
  const issues: string[] = [];
  for (const [propName, value] of Object.entries(element.props)) {
    if (!isBindStateExpression(value)) continue;
    if (contract.bindableProp === propName) continue;
    issues.push(
      `elements/${key}/props/${propName}: $bindState on ${element.type}.${propName} never writes back. ` +
        unbindableFix(element.type, contract),
    );
  }
  return issues;
}

function unbindableFix(componentType: string, contract: ComponentContract): string {
  if (contract.bindableProp === null) {
    return (
      `${componentType} is read-only — use {"$state": "/path"} to read a value. ` +
      `$bindState belongs on a form component's value prop (Input/Textarea/Select/Checkbox/Switch/Slider/...).`
    );
  }
  return (
    `${componentType} writes back only through "${contract.bindableProp}" — move the binding to ` +
    `props/${contract.bindableProp}, or use {"$state": "/path"} for a read-only value.`
  );
}

function isBindStateExpression(value: unknown): boolean {
  return isPlainObject(value) && typeof value.$bindState === "string";
}

// ---- Field validation checks -----------------------------------------------
// props.checks[].type is a bare string in the schema, so an unknown check type
// silently never runs — and checks on an unbound field never run at all
// (@json-render/shadcn gates validation on the value binding).

function formCheckIssues(
  key: string,
  element: UIElement,
  contract: ComponentContract,
): string[] {
  const checks = element.props.checks;
  if (!Array.isArray(checks) || checks.length === 0) return [];
  const issues: string[] = [];
  checks.forEach((check, index) => {
    if (!isPlainObject(check)) return;
    const checkType = check.type;
    if (typeof checkType !== "string") return;
    if (KnownCheckTypes.includes(checkType)) return;
    const suggestion = nearestName(checkType, KnownCheckTypes);
    const didYouMean = suggestion === null ? "" : ` Did you mean "${suggestion}"?`;
    issues.push(
      `elements/${key}/props/checks/${index}/type: unknown check "${checkType}".${didYouMean} ` +
        `Known checks: ${KnownCheckTypes.join(", ")}.`,
    );
  });
  const bindableProp = contract.bindableProp;
  if (bindableProp === null) return issues;
  if (isBindStateExpression(element.props[bindableProp])) return issues;
  issues.push(
    `elements/${key}/props/checks: checks only run on a $bindState-bound field, and ${element.type}.${bindableProp} ` +
      `is not bound — nothing validates. Bind it: "${bindableProp}": {"$bindState": "/form/${key}"}.`,
  );
  return issues;
}

// ---- Events and actions ----------------------------------------------------

function collectEventIssues(spec: JsonRenderSpec): string[] {
  const issues: string[] = [];
  for (const [key, element] of Object.entries(spec.elements)) {
    const contract = ComponentContracts[element.type];
    if (!contract) continue;
    for (const [eventName, binding] of Object.entries(element.on ?? {})) {
      if (!contract.events.includes(eventName)) {
        issues.push(`elements/${key}/on/${eventName}: ${unemittedEventFix(element.type, eventName, contract)}`);
        continue;
      }
      issues.push(...actionBindingIssues(`elements/${key}/on/${eventName}`, binding));
    }
  }
  return issues;
}

function unemittedEventFix(
  componentType: string,
  eventName: string,
  contract: ComponentContract,
): string {
  if (contract.events.length === 0) {
    return (
      `${componentType} emits no events, so this binding never fires. ` +
      `Move it to a component that does (a Button emits "press").`
    );
  }
  return (
    `${componentType} does not emit "${eventName}", so this binding never fires. ` +
    `${componentType} emits: ${contract.events.join(", ")}. Rebind it under "${contract.events[0]}".`
  );
}

function actionBindingIssues(path: string, binding: unknown): string[] {
  const bindings = Array.isArray(binding) ? binding : [binding];
  const issues: string[] = [];
  for (const entry of bindings) {
    if (!isPlainObject(entry) || typeof entry.action !== "string") {
      issues.push(
        `${path}: an event binding is an object naming an action, e.g. ` +
          `{"action": "canvas.submit", "params": {"id": "signup"}} — got ${JSON.stringify(entry)}.`,
      );
      continue;
    }
    const actionName = entry.action;
    if (KnownActionNames.includes(actionName)) continue;
    const suggestion = nearestName(actionName, KnownActionNames);
    const didYouMean = suggestion === null ? "" : ` Did you mean "${suggestion}"?`;
    issues.push(
      `${path}: unknown action "${actionName}" — no handler is registered, so the binding does nothing.${didYouMean} ` +
        `Known actions: ${KnownActionNames.join(", ")}.`,
    );
  }
  return issues;
}

// watch maps a state POINTER to the actions that fire when the value there
// changes. It does not feed props: `"watch": {"data": "buildDuration"}` on a
// Chart neither watches nor supplies data.

function collectWatchIssues(spec: JsonRenderSpec): string[] {
  const issues: string[] = [];
  for (const [key, element] of Object.entries(spec.elements)) {
    for (const [watchPath, binding] of Object.entries(element.watch ?? {})) {
      if (!watchPath.startsWith("/")) {
        issues.push(
          `elements/${key}/watch/${watchPath}: "${watchPath}" is not a JSON Pointer state path. ` +
            `watch keys are pointers ("/series") whose value changes fire the bound actions — it does not feed props. ` +
            `To feed a prop from state, bind the prop: "props": {"<prop>": {"$state": "/${watchPath}"}}.`,
        );
        continue;
      }
      issues.push(...actionBindingIssues(`elements/${key}/watch${watchPath}`, binding));
    }
  }
  return issues;
}

// ---- Nearest known name ----------------------------------------------------
// Cheap, deterministic did-you-mean: the closest candidate within two edits
// (case-insensitive), which catches typos and case drift ("colums", "Label")
// and stays quiet when the model invented a name from another dialect.

function nearestName(name: string, candidates: readonly string[]): string | null {
  let nearest: string | null = null;
  let nearestDistance = MAX_SUGGESTION_DISTANCE + 1;
  for (const candidate of candidates) {
    const distance = editDistance(name.toLowerCase(), candidate.toLowerCase());
    if (distance >= nearestDistance) continue;
    nearest = candidate;
    nearestDistance = distance;
  }
  if (nearestDistance > MAX_SUGGESTION_DISTANCE) return null;
  return nearest;
}

function editDistance(from: string, to: string): number {
  let previousRow = Array.from({ length: to.length + 1 }, (_, index) => index);
  for (let fromIndex = 1; fromIndex <= from.length; fromIndex++) {
    const currentRow = [fromIndex];
    for (let toIndex = 1; toIndex <= to.length; toIndex++) {
      const substitutionCost = from[fromIndex - 1] === to[toIndex - 1] ? 0 : 1;
      const deletion = (previousRow[toIndex] ?? 0) + 1;
      const insertion = (currentRow[toIndex - 1] ?? 0) + 1;
      const substitution = (previousRow[toIndex - 1] ?? 0) + substitutionCost;
      currentRow.push(Math.min(deletion, insertion, substitution));
    }
    previousRow = currentRow;
  }
  return previousRow[to.length] ?? to.length;
}

// ---- Declared input-form normalization ---------------------------------------
// One generic pass driven entirely by the prop-normal-forms table: rename
// declared prop aliases to their normal-form names, then rewrite each declared
// input form to the normal form the renderer consumes. A normalization is only
// adopted when the widened schema accepts the result, so the table can never
// introduce an invalid value even if it drifts from the catalog. Anything the
// table does not declare is left for collectPropIssues to reject with the
// exact fix.

function applyDeclaredNormalForms(spec: JsonRenderSpec, repairs: string[]): JsonRenderSpec {
  const elements: Record<string, UIElement> = {};
  for (const [key, element] of Object.entries(spec.elements)) {
    const aliased = renameDeclaredPropAliases(key, element, repairs);
    elements[key] = normalizeDeclaredPropForms(key, aliased, repairs);
  }
  return { ...spec, elements };
}

function renameDeclaredPropAliases(key: string, element: UIElement, repairs: string[]): UIElement {
  const aliases = PropNameAliases[element.type];
  if (!aliases) return element;
  const props = { ...element.props };
  let changed = false;
  for (const [aliasName, normalName] of Object.entries(aliases)) {
    const presentAlias = Object.keys(props).find((name) => name.toLowerCase() === aliasName);
    if (presentAlias === undefined) continue;
    if (props[normalName] !== undefined) continue;
    props[normalName] = props[presentAlias];
    delete props[presentAlias];
    changed = true;
    repairs.push(`elements/${key}/props: renamed "${presentAlias}" → "${normalName}"`);
  }
  return changed ? { ...element, props } : element;
}

function normalizeDeclaredPropForms(key: string, element: UIElement, repairs: string[]): UIElement {
  const normalizers = PropNormalForms[element.type];
  if (!normalizers) return element;
  const props = { ...element.props };
  let changed = false;
  for (const [prop, normalize] of Object.entries(normalizers)) {
    const original = props[prop];
    if (original === undefined) continue;
    if (isExpressionValue(original)) continue;
    const normalized = normalize(original);
    if (normalized === original) continue;
    if (!isValidPropValue(element.type, prop, normalized)) continue;
    props[prop] = normalized;
    changed = true;
    repairs.push(
      `elements/${key}/props/${prop}: coerced ${JSON.stringify(original)} → ${JSON.stringify(normalized)}`,
    );
  }
  return changed ? { ...element, props } : element;
}

function isValidPropValue(type: string, prop: string, value: unknown): boolean {
  const field = WidenedComponentPropSchemas[type]?.shape[prop];
  if (!field) return false;
  return field.safeParse(value).success;
}

// ---- Expression shorthand ----------------------------------------------------
// "$state.build.duration" / "$bindState:/form/title" as a bare string is part
// of the declared expression grammar (src/shared/expressions.ts); this pass
// rewrites every occurrence in props to the object form.

function normalizeExpressionShorthand(spec: JsonRenderSpec, repairs: string[]): JsonRenderSpec {
  const elements: Record<string, UIElement> = {};
  let changed = false;
  for (const [key, element] of Object.entries(spec.elements)) {
    const props = replaceShorthandDeep(element.props, `elements/${key}/props`, repairs);
    if (props !== element.props) {
      elements[key] = { ...element, props: props as Record<string, unknown> };
      changed = true;
      continue;
    }
    elements[key] = element;
  }
  return changed ? { ...spec, elements } : spec;
}

function replaceShorthandDeep(value: unknown, path: string, repairs: string[]): unknown {
  if (typeof value === "string") {
    const expression = parseStateShorthand(value);
    if (expression === null) return value;
    repairs.push(`${path}: coerced ${JSON.stringify(value)} → ${JSON.stringify(expression)}`);
    return expression;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const mapped = value.map((entry, index) => {
      const replaced = replaceShorthandDeep(entry, `${path}/${index}`, repairs);
      if (replaced !== entry) changed = true;
      return replaced;
    });
    return changed ? mapped : value;
  }
  if (!isPlainObject(value)) return value;
  if (isExpressionValue(value)) return value;
  let changed = false;
  const mapped: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    const replaced = replaceShorthandDeep(entryValue, `${path}/${entryKey}`, repairs);
    if (replaced !== entryValue) changed = true;
    mapped[entryKey] = replaced;
  }
  return changed ? mapped : value;
}

// ---- The one heuristic -------------------------------------------------------
// Everything above is a declared contract; this is the single remaining guess.
// There is no Form component, but models under token pressure emit type "Form"
// for form containers, and Card is what they mean structurally. Mapping it
// beats rejecting the whole spec over a wrapper. Unknown types outside this
// table still reject with the full known-type list.

const UNKNOWN_COMPONENT_TYPE_ALIASES: Readonly<Record<string, string>> = {
  form: "Card",
};

function repairUnknownComponentTypes(spec: JsonRenderSpec, repairs: string[]): JsonRenderSpec {
  const elements: Record<string, UIElement> = {};
  let changed = false;
  for (const [key, element] of Object.entries(spec.elements)) {
    const isKnownType = WidenedComponentPropSchemas[element.type] !== undefined;
    const alias = unknownTypeAlias(element.type);
    if (!isKnownType && alias !== null) {
      elements[key] = { ...element, type: alias };
      repairs.push(`elements/${key}/type: coerced "${element.type}" → "${alias}"`);
      changed = true;
      continue;
    }
    elements[key] = element;
  }
  return changed ? { ...spec, elements } : spec;
}

function unknownTypeAlias(type: string): string | null {
  const normalized = type.trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(UNKNOWN_COMPONENT_TYPE_ALIASES, normalized)) {
    return null;
  }
  return UNKNOWN_COMPONENT_TYPE_ALIASES[normalized] ?? null;
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
  if (data.length === 0) return emptyChartDataMessage(key);
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

// A literal [] is an authoring mistake, never an empty-at-first chart. It paints
// one meaningless mark and no axis labels, and nothing can ever fill it: a
// static array is frozen into the spec, so the rows the model meant to plot are
// gone. The legitimate "no rows yet" chart binds data to state
// ("data": {"$state": "/series"}), which the agent and live sources can write
// into — that path is left alone, seeded empty or not.
function emptyChartDataMessage(key: string): string {
  return (
    `elements/${key}/props/data: Chart data is an empty array — the chart paints one blank mark with no axis labels, and a static [] can never fill. ` +
    `Seed the rows you are plotting (e.g. "data": [{"day": "Mon", "runs": 12}]), or, if the rows arrive later, bind data to state ` +
    `("data": {"$state": "/series"}) and seed "series" in the spec-level "state" — a bound chart may start empty, a literal one may not.`
  );
}

function seriesKeysOf(y: unknown): string[] {
  if (typeof y === "string") return [y];
  if (Array.isArray(y)) return y.filter((entry): entry is string => typeof entry === "string");
  return [];
}
