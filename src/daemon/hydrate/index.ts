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
  parseReferenceValue,
  propValueReferenceOf,
  referenceKeyOf,
  ReferenceExpressionKey,
  type SuppliedPropsOf,
} from "../../shared/expressions.ts";
import {
  buildHydratedMeta,
  hydrationByteSize,
  HydrationMode,
  type HydratedMeta,
} from "./meta.ts";
import type { JsonRenderSpec, UIElement } from "../../shared/types.ts";
import { LiveSourceKind, LogRefreshSelection, type LiveSourceConfig } from "../live/types.ts";
import { dataTableColumnsFromCsv } from "./columns.ts";
import type { CsvParseResult } from "./csv.ts";
import type { LogAggregationResult, LogReferenceOptions } from "./logs.ts";
import {
  resolveCsvReference,
  resolveDiffPatchReference,
  resolveDiffSidesReference,
  resolveFileReference,
  resolveImgReference,
  resolveLogReference,
  resolveReferencePath,
  type Resolved,
} from "./resolve.ts";

const HYDRATED_NAMESPACE = "hydrated";
const HYDRATED_META_NAMESPACE = "hydratedMeta";
const DIFF_VIEWER_TYPE = "DiffViewer";
const DIFF_SIBLING_OPTION_KEYS = ["base", "staged", "watch"] as const;
// Chart's series prop — the one a $log supplies from the file's own contents,
// and therefore the one a watched $log has to keep re-deriving.
const CHART_SERIES_PROP = "y";

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
  return Object.values(props).some((value) => parseReferenceValue(value) !== null);
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
  await hydratePropValues(key, hydrated, context);
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
  element: UIElement,
  context: WalkContext,
): Promise<void> {
  for (const [propName, value] of Object.entries(element.props)) {
    const reference = parseReferenceValue(value);
    if (!reference) continue;
    const rewritten = await hydratePropValue(key, element, propName, reference, context);
    if (rewritten !== undefined) element.props[propName] = rewritten;
  }
}

async function hydratePropValue(
  key: string,
  element: UIElement,
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
  const budgetError = recordHydrated(context, refId, resolved.value.value, mode);
  if (budgetError) {
    context.errors.push(`${location}: ${budgetError}`);
    return undefined;
  }
  if (resolved.note) context.notes.push(`${location}: ${resolved.note}`);
  const supplied = applySuppliedProps(key, element, propName, resolved.value.supplies, mode, context);
  registerValueWatch({
    kind,
    refId,
    displayPath: path,
    absPath: resolvedPath.absPath,
    reference,
    supplied,
    context,
  });
  return stateBinding(refId);
}

// ---- Props a reference supplies BESIDE the one it sits in -------------------

// A $csv in DataTable.rows also fills `columns` (PropValueReferences declares
// it; the resolution above offers the value). Each supplied prop lands in slot
// state and binds like any other hydrated value, so the browser sees ordinary
// state and an export carries the content.
//
// The author always wins: a hand-written `columns` is never overwritten — the
// derived shape is a floor, not a ceiling.
//
// Returns the refIds it actually filled, keyed by prop, so a watched reference
// can keep a SUPPLIED prop live too (a $log's `y` is the set of series the file
// contained — a level that first appears an hour from now belongs on the chart).
function applySuppliedProps(
  key: string,
  element: UIElement,
  propName: string,
  supplies: Record<string, unknown>,
  mode: HydrationMode,
  context: WalkContext,
): SuppliedRefIds {
  const filled: SuppliedRefIds = new Map();
  const contract = propValueReferenceOf(element.type, element.props);
  if (contract === null) return filled;
  if (contract.prop !== propName) return filled;

  for (const suppliedProp of contract.supplies) {
    if (element.props[suppliedProp] !== undefined) continue;
    const value = supplies[suppliedProp];
    if (value === undefined) continue;
    const refId = `${sanitizeSegment(key)}__${sanitizeSegment(suppliedProp)}`;
    const budgetError = recordHydrated(context, refId, value, mode);
    if (budgetError) {
      context.errors.push(`elements/${key}/props/${suppliedProp}: ${budgetError}`);
      continue;
    }
    element.props[suppliedProp] = stateBinding(refId);
    filled.set(suppliedProp, refId);
  }
  return filled;
}

type SuppliedRefIds = Map<string, string>;

// Only file-backed references re-resolve on change; a $csv row cap or a $img URL
// has nothing meaningful to stream.
function isWatchable(kind: ReferenceExpressionKey): boolean {
  return (
    kind === ReferenceExpressionKey.File ||
    kind === ReferenceExpressionKey.Diff ||
    kind === ReferenceExpressionKey.Log
  );
}

// What a resolved reference yields: the value the referenced prop binds to, plus
// the companion values this KIND of reference can also supply. Who TAKES those
// is not the resolver's call — PropValueReferences decides, so the same $csv
// hands DataTable its `columns` and hands a Chart nothing but rows to plot.
type ResolvedReference = {
  value: unknown;
  supplies: Record<string, unknown>;
};

async function resolveByKind(
  kind: ReferenceExpressionKey,
  displayPath: string,
  absPath: string,
  reference: Record<string, unknown>,
  context: WalkContext,
): Promise<Resolved<ResolvedReference>> {
  if (kind === ReferenceExpressionKey.File) {
    return asReference(resolveFileReference(absPath, stringOption(reference.lines)), suppliesNothing);
  }
  if (kind === ReferenceExpressionKey.Csv) {
    return asReference(resolveCsvReference(absPath, numberOption(reference.limit)), csvReference);
  }
  if (kind === ReferenceExpressionKey.Log) {
    return asReference(resolveLogReference(absPath, logOptionsOf(reference)), logReference);
  }
  if (kind === ReferenceExpressionKey.Img) {
    return asReference(resolveImgReference(absPath, context.buildBlobUrl), suppliesNothing);
  }
  const patch = await resolveDiffPatchReference(context.cwd, absPath, displayPath, {
    base: stringOption(reference.base),
    staged: reference.staged === true,
  });
  return asReference(patch, suppliesNothing);
}

// A $csv fills its prop with the ROWS and offers the table's shape: the header
// row, typed and right-aligned where the cells are numbers, is exactly what
// DataTable's `columns` is. The supplies record is typed from the shared
// contract, so a prop declared there and not produced here is a compile error.
function csvReference(csv: CsvParseResult): ResolvedReference {
  const supplies: SuppliedPropsOf<typeof ReferenceExpressionKey.Csv> = {
    columns: dataTableColumnsFromCsv(csv),
  };
  return { value: csv.rows, supplies };
}

// A $log fills `data` with the aggregated rows and offers the two props that
// describe them: which key is the X axis (the bucket) and which key(s) are the
// series. Both are answers the daemon computed by reading the file — the model
// asked the question and the daemon shaped the chart.
function logReference(log: LogAggregationResult): ResolvedReference {
  const supplies: SuppliedPropsOf<typeof ReferenceExpressionKey.Log> = { x: log.x, y: log.y };
  return { value: log.rows, supplies };
}

// $file, $diff and $img fill exactly the one prop they sit in.
function suppliesNothing(value: string): ResolvedReference {
  return { value, supplies: {} };
}

// The sibling options of a {$log}, read off the authored reference. Every one is
// optional but `groupBy`, and the aggregator — not this reader — decides what a
// bad one means, so both the push and the live refresh reject identically.
function logOptionsOf(reference: Record<string, unknown>): LogReferenceOptions {
  return {
    groupBy: stringOption(reference.groupBy),
    match: stringOption(reference.match),
    parser: stringOption(reference.parser),
    pattern: stringOption(reference.pattern),
    series: stringOption(reference.series),
    metric: stringOption(reference.metric),
  };
}

function asReference<T>(
  resolved: Resolved<T>,
  project: (value: T) => ResolvedReference,
): Resolved<ResolvedReference> {
  if (!resolved.ok) return resolved;
  const reference = project(resolved.value);
  if (resolved.note === undefined) return { ok: true, value: reference };
  return { ok: true, value: reference, note: resolved.note };
}

type ValueWatch = {
  kind: ReferenceExpressionKey;
  refId: string;
  displayPath: string;
  absPath: string;
  reference: Record<string, unknown>;
  supplied: SuppliedRefIds;
  context: WalkContext;
};

function registerValueWatch(watch: ValueWatch): void {
  const { kind, refId, absPath, reference, context } = watch;
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
        displayPath: watch.displayPath,
        base: stringOption(reference.base),
        staged: reference.staged === true,
      }),
    );
    return;
  }
  if (kind === ReferenceExpressionKey.Log) registerLogWatch(watch);
}

// A watched $log re-aggregates the whole file on every change — the rows are a
// function of all of it, so there is nothing to append. When `series` split the
// chart, the series LIST is re-derived beside the rows: a log that starts
// emitting FATAL an hour after the push grows a line for it, live.
function registerLogWatch(watch: ValueWatch): void {
  const { refId, absPath, reference, context } = watch;
  const options = logOptionsOf(reference);
  context.watchSources.push(
    referenceRefreshSource(refId, absPath, {
      kind: "log",
      absPath,
      options,
      select: LogRefreshSelection.Rows,
    }),
  );

  const seriesRefId = watch.supplied.get(CHART_SERIES_PROP);
  if (options.series === null || seriesRefId === undefined) return;
  context.watchSources.push(
    referenceRefreshSource(seriesRefId, absPath, {
      kind: "log",
      absPath,
      options,
      select: LogRefreshSelection.SeriesKeys,
    }),
  );
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
