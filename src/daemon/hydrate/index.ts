// The push-time hydrator. Given a spec the agent authored with reference
// expressions ({$file}, {$diff}, {$csv}, {$img}) and the session's cwd, it
// resolves each reference, lands the resolved value in the slot's reserved
// "/hydrated/<ref-id>" state namespace, and rewrites the prop that carried the
// reference into a plain {$state} binding. The browser then sees ordinary
// state — exports carry the content, and a re-push with the same slotId
// re-hydrates fresh. References with {watch:true} additionally yield live
// reference-refresh sources the caller registers with the live engine.

import {
  isPlainObject,
  isReferenceExpression,
  parseReferenceShorthand,
  referenceKeyOf,
  ReferenceExpressionKey,
} from "../../shared/expressions.ts";
import {
  buildHydratedMeta,
  hydrationByteSize,
  HydrationMode,
  type HydratedMeta,
} from "./meta.ts";
import type { JsonRenderSpec, UIElement } from "../../shared/types.ts";
import { LiveSourceKind, type LiveSourceConfig } from "../live/types.ts";
import {
  resolveCsvReference,
  resolveDiffPatchReference,
  resolveDiffSidesReference,
  resolveFileReference,
  resolveImgReference,
  resolveReferencePath,
  type Resolved,
} from "./resolve.ts";

const HYDRATED_NAMESPACE = "hydrated";
const HYDRATED_META_NAMESPACE = "hydratedMeta";
const DIFF_VIEWER_TYPE = "DiffViewer";
const DIFF_SIBLING_OPTION_KEYS = ["base", "staged", "watch"] as const;

// One slot's references share a budget, so a spec cannot smuggle 40 near-cap
// files past the per-file limit and land 20 MB in a single slot's state.
const MAX_SLOT_HYDRATION_BYTES = 2 * 1024 * 1024;

export { HydrationMode, type HydratedMeta } from "./meta.ts";

export type HydrateInput = {
  spec: JsonRenderSpec;
  cwd: string;
  buildBlobUrl: (absPath: string) => string;
};

export type HydrateResult = {
  spec: JsonRenderSpec;
  watchSources: LiveSourceConfig[];
  notes: string[];
  errors: string[];
};

// Cheap pre-scan so specs with no references (the overwhelming majority) skip
// the clone-and-walk entirely.
export function specHasReferences(spec: JsonRenderSpec): boolean {
  for (const element of Object.values(spec.elements)) {
    if (elementHasReference(element)) return true;
  }
  return false;
}

function elementHasReference(element: UIElement): boolean {
  const props = element.props ?? {};
  if (typeof props[ReferenceExpressionKey.Diff] === "string") return true;
  return Object.values(props).some(isReferenceValue);
}

function isReferenceValue(value: unknown): boolean {
  if (typeof value === "string") return parseReferenceShorthand(value) !== null;
  return isReferenceExpression(value);
}

export async function hydrateSpec(input: HydrateInput): Promise<HydrateResult> {
  if (!specHasReferences(input.spec)) {
    return { spec: input.spec, watchSources: [], notes: [], errors: [] };
  }
  const spec = structuredClone(input.spec);
  const context: WalkContext = {
    cwd: input.cwd,
    buildBlobUrl: input.buildBlobUrl,
    hydrated: {},
    meta: {},
    budgetUsedBytes: 0,
    watchSources: [],
    notes: [],
    errors: [],
  };

  for (const [key, element] of Object.entries(spec.elements)) {
    spec.elements[key] = await hydrateElement(key, element, context);
  }

  seedHydratedState(spec, context.hydrated, context.meta);
  return {
    spec,
    watchSources: context.watchSources,
    notes: context.notes,
    errors: context.errors,
  };
}

type WalkContext = {
  cwd: string;
  buildBlobUrl: (absPath: string) => string;
  hydrated: Record<string, unknown>;
  meta: Record<string, HydratedMeta>;
  budgetUsedBytes: number;
  watchSources: LiveSourceConfig[];
  notes: string[];
  errors: string[];
};

// The single place a resolved value enters slot state: charges the slot's
// hydration budget, then records the value plus its snapshot/live metadata.
// Returns an error message when the budget is spent, so the caller can reject
// the push rather than silently truncate.
function recordHydrated(
  context: WalkContext,
  refId: string,
  value: unknown,
  mode: HydrationMode,
): string | null {
  const bytes = hydrationByteSize(value);
  const totalBytes = context.budgetUsedBytes + bytes;
  if (totalBytes > MAX_SLOT_HYDRATION_BYTES) {
    return `would put this slot at ${Math.ceil(totalBytes / 1024)} KB of hydrated content, over the ${MAX_SLOT_HYDRATION_BYTES / 1024} KB per-slot budget — narrow a line range, cap CSV rows, or split across slots.`;
  }
  context.budgetUsedBytes = totalBytes;
  context.hydrated[refId] = value;
  context.meta[refId] = buildHydratedMeta(value, mode);
  return null;
}

async function hydrateElement(
  key: string,
  element: UIElement,
  context: WalkContext,
): Promise<UIElement> {
  const hydrated: UIElement = { ...element, props: { ...(element.props ?? {}) } };
  await expandElementLevelDiff(key, hydrated, context);
  await hydratePropValues(key, hydrated.props, context);
  return hydrated;
}

// ---- Element-level $diff (DiffViewer before/after) -------------------------

async function expandElementLevelDiff(
  key: string,
  element: UIElement,
  context: WalkContext,
): Promise<void> {
  const props = element.props;
  const path = props[ReferenceExpressionKey.Diff];
  if (typeof path !== "string") return;
  if (element.type !== DIFF_VIEWER_TYPE) {
    context.errors.push(
      `elements/${key}: "$diff" as a props key expands a DiffViewer's before/after; on ${element.type}, use $diff as a prop value for a unified patch, e.g. {"code": {"$diff": "${path}"}}.`,
    );
    consumeDiffKeys(element);
    return;
  }
  const options = { base: stringOption(props.base), staged: props.staged === true };
  const watch = readDiffWatchFlag(element);
  consumeDiffKeys(element);

  const resolvedPath = resolveReferencePath(context.cwd, path);
  if (!resolvedPath.ok) {
    context.errors.push(`elements/${key}/props/$diff: ${resolvedPath.error}`);
    return;
  }
  const result = await resolveDiffSidesReference(context.cwd, resolvedPath.absPath, path, options);
  if (!result.ok) {
    context.errors.push(`elements/${key}/props/$diff: ${result.error}`);
    return;
  }
  const refId = `${sanitizeSegment(key)}__eldiff`;
  const mode = watch ? HydrationMode.Live : HydrationMode.Snapshot;
  const budgetError = recordHydrated(context, refId, result.value, mode);
  if (budgetError) {
    context.errors.push(`elements/${key}/props/$diff: ${budgetError}`);
    return;
  }
  props.before = stateBinding(`${refId}/before`);
  props.after = stateBinding(`${refId}/after`);
  props.file = stateBinding(`${refId}/file`);
  if (watch) {
    context.watchSources.push(
      referenceRefreshSource(refId, resolvedPath.absPath, {
        kind: "diff-sides",
        cwd: context.cwd,
        absPath: resolvedPath.absPath,
        displayPath: path,
        base: options.base,
        staged: options.staged,
      }),
    );
  }
}

// The $diff watch flag is authored as a sibling prop ({"$diff": "a.ts",
// "watch": true}), but `watch` is a RESERVED json-render element field, and the
// MCP-side prepareSpec pass (autoFixSpec) relocates any `watch` key it finds in
// props up to the element level. So by the time a spec reaches the daemon the
// flag legitimately sits at EITHER place depending on the push path. Read both.
// Only a literal `true` is ours — a real element-level watch binding is a map of
// state paths, so this can never swallow one.
function readDiffWatchFlag(element: UIElement): boolean {
  const relocated: unknown = element.watch;
  return element.props.watch === true || relocated === true;
}

function consumeDiffKeys(element: UIElement): void {
  delete element.props[ReferenceExpressionKey.Diff];
  for (const optionKey of DIFF_SIBLING_OPTION_KEYS) delete element.props[optionKey];
  // A relocated flag would otherwise reach the renderer as watch: true, which
  // is not a valid watch map.
  if ((element.watch as unknown) === true) delete element.watch;
}

// ---- Prop-value references -------------------------------------------------

async function hydratePropValues(
  key: string,
  props: Record<string, unknown>,
  context: WalkContext,
): Promise<void> {
  for (const [propName, value] of Object.entries(props)) {
    const reference = referenceOf(value);
    if (!reference) continue;
    const rewritten = await hydratePropValue(key, propName, reference, context);
    if (rewritten !== undefined) props[propName] = rewritten;
  }
}

// Both the object form ({$file:..., lines:...}) and the string shorthand
// ("$file:...") normalize to one flat record the walker reads options off.
function referenceOf(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") return parseReferenceShorthand(value);
  if (isReferenceExpression(value) && isPlainObject(value)) return value;
  return null;
}

async function hydratePropValue(
  key: string,
  propName: string,
  reference: Record<string, unknown>,
  context: WalkContext,
): Promise<unknown> {
  const kind = referenceKeyOf(reference);
  const path = kind ? reference[kind] : undefined;
  if (kind === null || typeof path !== "string") return undefined;

  const resolvedPath = resolveReferencePath(context.cwd, path);
  const location = `elements/${key}/props/${propName}`;
  if (!resolvedPath.ok) {
    context.errors.push(`${location}: ${resolvedPath.error}`);
    return undefined;
  }

  const resolved = await resolveByKind(kind, path, resolvedPath.absPath, reference, context);
  if (!resolved.ok) {
    context.errors.push(`${location}: ${resolved.error}`);
    return undefined;
  }

  const refId = `${sanitizeSegment(key)}__${sanitizeSegment(propName)}`;
  const mode = isWatchable(kind) && reference.watch === true ? HydrationMode.Live : HydrationMode.Snapshot;
  const budgetError = recordHydrated(context, refId, resolved.value, mode);
  if (budgetError) {
    context.errors.push(`${location}: ${budgetError}`);
    return undefined;
  }
  if (resolved.note) context.notes.push(`${location}: ${resolved.note}`);
  registerValueWatch(kind, refId, path, resolvedPath.absPath, reference, context);
  return stateBinding(refId);
}

// Only file-backed text references re-resolve on change; a $csv row cap or a
// $img URL has nothing meaningful to stream.
function isWatchable(kind: ReferenceExpressionKey): boolean {
  return kind === ReferenceExpressionKey.File || kind === ReferenceExpressionKey.Diff;
}

function resolveByKind(
  kind: ReferenceExpressionKey,
  displayPath: string,
  absPath: string,
  reference: Record<string, unknown>,
  context: WalkContext,
): Promise<Resolved<unknown>> | Resolved<unknown> {
  if (kind === ReferenceExpressionKey.File) {
    return resolveFileReference(absPath, stringOption(reference.lines));
  }
  if (kind === ReferenceExpressionKey.Csv) {
    return resolveCsvReference(absPath, numberOption(reference.limit));
  }
  if (kind === ReferenceExpressionKey.Img) {
    return resolveImgReference(absPath, context.buildBlobUrl);
  }
  return resolveDiffPatchReference(context.cwd, absPath, displayPath, {
    base: stringOption(reference.base),
    staged: reference.staged === true,
  });
}

function registerValueWatch(
  kind: ReferenceExpressionKey,
  refId: string,
  displayPath: string,
  absPath: string,
  reference: Record<string, unknown>,
  context: WalkContext,
): void {
  if (reference.watch !== true) return;
  if (kind === ReferenceExpressionKey.File) {
    context.watchSources.push(
      referenceRefreshSource(refId, absPath, {
        kind: "file",
        absPath,
        lines: stringOption(reference.lines),
      }),
    );
    return;
  }
  if (kind === ReferenceExpressionKey.Diff) {
    context.watchSources.push(
      referenceRefreshSource(refId, absPath, {
        kind: "diff-patch",
        cwd: context.cwd,
        absPath,
        displayPath,
        base: stringOption(reference.base),
        staged: reference.staged === true,
      }),
    );
  }
}

// ---- Shared helpers --------------------------------------------------------

function referenceRefreshSource(
  refId: string,
  watchPath: string,
  target: Extract<LiveSourceConfig, { kind: typeof LiveSourceKind.ReferenceRefresh }>["target"],
): LiveSourceConfig {
  return {
    kind: LiveSourceKind.ReferenceRefresh,
    id: refId,
    statePath: `/${HYDRATED_NAMESPACE}/${refId}`,
    metaStatePath: `/${HYDRATED_META_NAMESPACE}/${refId}`,
    watchPath,
    target,
  };
}

// Values land under the reserved "/hydrated" namespace (what props bind to);
// their snapshot/live metadata lands beside it under "/hydratedMeta", so an
// export or a reader can tell fresh content from a stale snapshot without the
// bindings ever having to know about it.
function seedHydratedState(
  spec: JsonRenderSpec,
  hydrated: Record<string, unknown>,
  meta: Record<string, HydratedMeta>,
): void {
  if (Object.keys(hydrated).length === 0) return;
  const existingState = spec.state ?? {};
  spec.state = {
    ...existingState,
    [HYDRATED_NAMESPACE]: { ...recordAt(existingState, HYDRATED_NAMESPACE), ...hydrated },
    [HYDRATED_META_NAMESPACE]: { ...recordAt(existingState, HYDRATED_META_NAMESPACE), ...meta },
  };
}

function recordAt(state: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = state[key];
  return isPlainObject(existing) ? existing : {};
}

function stateBinding(pointerBody: string): { $state: string } {
  return { $state: `/${HYDRATED_NAMESPACE}/${pointerBody}` };
}

function sanitizeSegment(segment: string): string {
  return segment.replace(/[^A-Za-z0-9_]/g, "_");
}

function stringOption(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberOption(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
