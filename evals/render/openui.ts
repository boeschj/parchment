// OpenUI Lang → json-render spec.
//
// THEIR PARSER, NOT OURS. `createParser(library.toJSONSchema())` is
// @openuidev/lang-core's own, so this file never has an opinion about what their
// grammar means: hoisting, positional-argument order, forward references,
// silently-dropped orphans and the reachability rule are all decided by the
// vendor's code. We receive a resolved element tree and translate it.
//
// Two things happen here, and only two:
//
//   1. THE TREE IS FLATTENED. OpenUI resolves to a nested tree; json-render takes
//      a flat element map keyed by id. A mechanical re-shaping, no semantics.
//
//   2. A QUERY BECOMES A REFERENCE. This is the important one. When a prop's
//      value is a pluck off a Query result — `csv.rows`, `gd.before`, the
//      {k:"Member", obj:{k:"RuntimeRef", refType:"query"}} node their parser
//      emits — it is replaced by the parchment reference expression that the tool
//      maps to (evals/catalog/openui-tools.ts). `Query("read_csv", {path: "x.csv"})`
//      plucked into DataTable.rows becomes {"$csv": "x.csv"}, and the DAEMON reads
//      the file — the same daemon, the same file, the same bytes that a parchment
//      <DataTable src="x.csv"/> resolves to.
//
// That second step is what makes this a fair fight rather than a rigged one. In a
// real OpenUI deployment the host's `toolProvider` executes the Query and hands
// the rows to the renderer. Here the daemon is that host. The model's output — the
// only thing this eval measures — is identical either way: it names a file and
// emits no rows.

import { createParser } from "@openuidev/lang-core";
import { createParchmentOpenUiLibrary } from "../catalog/openui-library.ts";
import {
  OPENUI_TOOL_CONTRACTS,
  type OpenUiToolContract,
  type OpenUiToolName,
} from "../catalog/openui-tools.ts";
import {
  ElementLevelReferences,
  PropValueReferences,
  referenceKeyOf,
  type PropValueReferenceContract,
  type ReferenceExpressionKey,
} from "../../src/shared/expressions.ts";
import type { JsonRenderSpec, UIElement } from "../../src/shared/types.ts";

// ---- What their parser hands back --------------------------------------------

const ROOT_ELEMENT_KEY = "root";

type ParsedQuery = {
  toolName: string;
  args: Record<string, unknown>;
};

type OpenUiElement = {
  type: "element";
  typeName: string;
  props: Record<string, unknown>;
  statementId?: string;
};

type OpenUiMember = {
  k: "Member";
  obj: { k: "RuntimeRef"; n: string; refType: string };
  field: string;
};

export type OpenUiDecode = { spec: JsonRenderSpec | null; issues: string[] };

export function compileOpenUiDocument(source: string): OpenUiDecode {
  const parsed = parseWithVendorParser(source);
  if (parsed.issues.length > 0) return { spec: null, issues: parsed.issues };
  if (parsed.root === null) {
    return { spec: null, issues: [MISSING_ROOT_ISSUE] };
  }

  const queries = collectQueries(parsed.queryStatements);
  const elements: Record<string, UIElement> = {};
  flattenElement(parsed.root, ROOT_ELEMENT_KEY, queries, elements);

  return {
    spec: { root: ROOT_ELEMENT_KEY, elements },
    issues: [],
  };
}

const MISSING_ROOT_ISSUE =
  'the program defines no `root`. Every openui-lang program must define `root = Card(...)`.';

type VendorParse = {
  root: OpenUiElement | null;
  queryStatements: readonly unknown[];
  issues: string[];
};

// Their parser's own complaints are the arm's repair signal, verbatim — the same
// contract every other arm gets (its OWN toolchain's error text, never ours).
function parseWithVendorParser(source: string): VendorParse {
  const library = createParchmentOpenUiLibrary();
  const parser = createParser(library.toJSONSchema());

  const parsed = parser.parse(source) as {
    root: unknown;
    queryStatements?: readonly unknown[];
    meta?: { errors?: readonly { message?: string }[]; orphaned?: readonly string[] };
  };

  const errors = parsed.meta?.errors ?? [];
  const issues = errors.map((error) => error.message ?? "openui-lang parse error");

  return {
    root: isOpenUiElement(parsed.root) ? parsed.root : null,
    queryStatements: parsed.queryStatements ?? [],
    issues,
  };
}

// ---- Queries -------------------------------------------------------------------

// Their AST keeps a Query's tool name and args as literal nodes ({k:"Str"},
// {k:"Obj"}). Only literals can name a file, so only literals are read.
function collectQueries(queryStatements: readonly unknown[]): Map<string, ParsedQuery> {
  const queries = new Map<string, ParsedQuery>();

  for (const statement of queryStatements) {
    if (!isPlainObject(statement)) continue;

    const statementId = statement.statementId;
    const toolName = literalStringOf(statement.toolAST);
    if (typeof statementId !== "string" || toolName === null) continue;

    queries.set(statementId, { toolName, args: literalObjectOf(statement.argsAST) });
  }

  return queries;
}

function literalStringOf(node: unknown): string | null {
  if (!isPlainObject(node)) return null;
  if (node.k !== "Str") return null;
  return typeof node.v === "string" ? node.v : null;
}

function literalObjectOf(node: unknown): Record<string, unknown> {
  if (!isPlainObject(node)) return {};
  if (node.k !== "Obj") return {};
  if (!Array.isArray(node.entries)) return {};

  const literals: Record<string, unknown> = {};
  for (const entry of node.entries) {
    if (!Array.isArray(entry)) continue;
    const [key, valueNode] = entry;
    if (typeof key !== "string") continue;
    const value = literalValueOf(valueNode);
    if (value === undefined) continue;
    literals[key] = value;
  }
  return literals;
}

function literalValueOf(node: unknown): unknown {
  if (!isPlainObject(node)) return undefined;
  if (node.k === "Str") return node.v;
  if (node.k === "Num") return node.v;
  if (node.k === "Bool") return node.v;
  return undefined;
}

// The reference expression a Query lowers to: the tool's path argument becomes
// the $-key's value, and its other arguments become the reference's sibling
// options — the daemon's own convention, unchanged.
function referenceForQuery(query: ParsedQuery): Record<string, unknown> | null {
  const contract = contractFor(query.toolName);
  if (contract === null) return null;

  const path = query.args[contract.pathArg];
  if (typeof path !== "string") return null;

  const reference: Record<string, unknown> = { [contract.referenceKey]: path };
  for (const option of contract.optionArgs) {
    const value = query.args[option];
    if (value === undefined) continue;
    reference[option] = value;
  }
  return reference;
}

function contractFor(toolName: string): OpenUiToolContract | null {
  const contracts: Readonly<Record<string, OpenUiToolContract>> = OPENUI_TOOL_CONTRACTS;
  return contracts[toolName as OpenUiToolName] ?? null;
}

// ---- Flattening ------------------------------------------------------------------

function flattenElement(
  element: OpenUiElement,
  key: string,
  queries: ReadonlyMap<string, ParsedQuery>,
  elements: Record<string, UIElement>,
): void {
  const props: Record<string, unknown> = {};
  const children: string[] = [];

  for (const [prop, value] of Object.entries(element.props)) {
    if (prop === "children") {
      children.push(...flattenChildren(value, key, queries, elements));
      continue;
    }

    const resolved = resolvePropValue(value, queries);
    if (isSkippedArgument(resolved)) continue;
    props[prop] = resolved;
  }

  elements[key] = {
    type: element.typeName,
    props: normalizeReferences(element.typeName, props),
    ...(children.length > 0 ? { children } : {}),
  };
}

// A QUERY PLUCKED INTO SEVERAL PROPS IS STILL ONE REFERENCE.
//
// `DataTable(caption, csv.columns, csv.rows)` is the natural thing for a model to
// write, and it resolves to the SAME $csv on two different props. Left alone, the
// daemon would hydrate `rows` from the file and then find an author-written
// `columns` — a raw {$csv} object — sitting where the column list belongs, and
// refuse to overwrite it (hydration never clobbers a prop the author wrote). The
// table would render with garbage headers, and OpenUI would have lost a run to
// OUR adapter rather than to its format. The same trap sits under
// `Chart(kind, agg.data, agg.x, agg.y)`.
//
// The product already says exactly where a reference belongs and what it fills:
// PropValueReferences (a $csv lives in DataTable.rows and supplies `columns`; a
// $log lives in Chart.data and supplies `x` and `y`) and ElementLevelReferences (a
// $diff lives on the ELEMENT and supplies `file`, `before`, `after`). Those two
// tables are read here, so this lowering is the product's, not the harness's — it
// is what parchment's own compiler does when it lowers <DataTable src="x.csv"/>.
function normalizeReferences(
  componentType: string,
  props: Record<string, unknown>,
): Record<string, unknown> {
  const elementLevel = liftElementLevelReference(componentType, props);
  if (elementLevel !== null) return elementLevel;

  const contract = propValueContractFor(componentType);
  if (contract === null) return props;

  const reference = firstReferenceOfKind(props, contract.key);
  if (reference === null) return props;

  const kept: Record<string, unknown> = {};
  for (const [prop, value] of Object.entries(props)) {
    // Every other pluck off the same query names a prop the daemon supplies once
    // it has read the file. Dropping them is what lets it supply them.
    if (referenceKeyOf(value) === contract.key) continue;
    kept[prop] = value;
  }

  kept[contract.prop] = reference;
  return kept;
}

// A $diff belongs in props, beside its options, not inside `before` — that is the
// shape the validator and the hydrator both read.
function liftElementLevelReference(
  componentType: string,
  props: Record<string, unknown>,
): Record<string, unknown> | null {
  const contract = ElementLevelReferences[componentType as keyof typeof ElementLevelReferences];
  if (contract === undefined) return null;

  const reference = firstReferenceOfKind(props, contract.key);
  if (reference === null) return null;

  const supplied: readonly string[] = contract.supplies;

  const kept: Record<string, unknown> = {};
  for (const [prop, value] of Object.entries(props)) {
    if (referenceKeyOf(value) === contract.key) continue;
    // `file`, `before` and `after` are what the $diff SUPPLIES. A literal the
    // model wrote into one of them would fight the daemon's own resolution.
    if (supplied.includes(prop)) continue;
    kept[prop] = value;
  }

  return { ...kept, ...reference };
}

function firstReferenceOfKind(
  props: Readonly<Record<string, unknown>>,
  key: ReferenceExpressionKey,
): Record<string, unknown> | null {
  for (const value of Object.values(props)) {
    if (referenceKeyOf(value) !== key) continue;
    if (isPlainObject(value)) return value;
  }
  return null;
}

function propValueContractFor(componentType: string): PropValueReferenceContract | null {
  const table: Readonly<Record<string, PropValueReferenceContract>> = PropValueReferences;
  return table[componentType] ?? null;
}

// `null` IS OPENUI'S SKIPPED-ARGUMENT IDIOM, NOT A NULL VALUE.
//
// Arguments are positional, so a model that wants the fifth one must write
// something in the third. OpenUI's OWN generated prompt does exactly this —
// `Select("dateRange", [SelectItem("7", "Last 7 days")], null, null, $dateRange)`
// — so `null` here means "not provided", and it must be dropped rather than
// forwarded.
//
// Forwarding it is a trap that costs the arm a run it should have won: the
// product's validator rejects `required field "columns" cannot be null`, and
// OpenUI would have been marked down for following its own vendor's documented
// idiom. That is a harness artifact wearing a format's clothes, and it is exactly
// the kind of thing that would make every honest number in this table worthless.
function isSkippedArgument(value: unknown): boolean {
  return value === null || value === undefined;
}

// A prop whose value is a pluck off a Query becomes the reference that Query
// names. Everything else is a literal the model actually emitted, and travels
// through untouched.
function resolvePropValue(
  value: unknown,
  queries: ReadonlyMap<string, ParsedQuery>,
): unknown {
  const member = asQueryMember(value);
  if (member === null) return value;

  const query = queries.get(member.obj.n);
  if (query === undefined) return value;

  return referenceForQuery(query) ?? value;
}

function asQueryMember(value: unknown): OpenUiMember | null {
  if (!isPlainObject(value)) return null;
  if (value.k !== "Member") return null;

  const obj = value.obj;
  if (!isPlainObject(obj)) return null;
  if (obj.k !== "RuntimeRef") return null;
  if (typeof obj.n !== "string") return null;

  return value as unknown as OpenUiMember;
}

function flattenChildren(
  value: unknown,
  parentKey: string,
  queries: ReadonlyMap<string, ParsedQuery>,
  elements: Record<string, UIElement>,
): string[] {
  if (!Array.isArray(value)) return [];

  const keys: string[] = [];
  for (const [index, child] of value.entries()) {
    if (!isOpenUiElement(child)) continue;

    const key = childKeyFor(child, parentKey, index);
    keys.push(key);
    flattenElement(child, key, queries, elements);
  }
  return keys;
}

// The model's own statement name is the element key when it has one — so the
// archived spec reads the way the model wrote it, and a reader can line the two
// up. A positional fallback keeps inline (unnamed) children addressable.
function childKeyFor(child: OpenUiElement, parentKey: string, index: number): string {
  const statementId = child.statementId;
  if (typeof statementId === "string" && statementId.length > 0) return statementId;
  return `${parentKey}-${index}`;
}

function isOpenUiElement(value: unknown): value is OpenUiElement {
  if (!isPlainObject(value)) return false;
  if (value.type !== "element") return false;
  if (typeof value.typeName !== "string") return false;
  return isPlainObject(value.props);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
