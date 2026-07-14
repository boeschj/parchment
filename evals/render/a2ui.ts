// A2UI envelope stream → json-render spec.
//
// The translation is close to mechanical, because the two formats model the same
// thing:
//
//   A2UI                                json-render
//   ----------------------------------  ---------------------------------------
//   flat component list, tree by id     flat element map, children by key
//   props inline on the component       props under `props`
//   `child` / `children` (ids)          `children` (keys)
//   data model (a JSON document)        `state`
//   {"path": "/x"} (JSON Pointer)       {"$state": "/x"} (JSON Pointer)
//
// The data-model binding is the interesting row. A2UI components hold BINDINGS,
// not values; the values live in a separate document the agent populates with
// updateDataModel. json-render has exactly this split — `state` plus `$state`
// pointers — so the mapping is one-to-one and neither format is flattened into
// the other's shape.
//
// WHAT THE ADAPTER MUST NOT DO IS INVENT A REFERENCE. A2UI has no mechanism to
// name external content, so nothing here turns an A2UI message into a $csv, a
// $diff or a $log. Every byte on an A2UI page was emitted by the model, and the
// token count says so.

import { SlotKind } from "../../src/shared/types.ts";
import type { JsonRenderSpec, UIElement } from "../../src/shared/types.ts";

const ROOT_COMPONENT_ID = "root";

// The envelope keys, exactly as v1.0 names them.
const EnvelopeKey = {
  CreateSurface: "createSurface",
  UpdateComponents: "updateComponents",
  UpdateDataModel: "updateDataModel",
  DeleteSurface: "deleteSurface",
} as const;

// The two child slots. `child` is a single id (Card, Button); `children` is a
// list. Getting this wrong is a validation failure in A2UI too, so both are read.
const ChildSlot = {
  Single: "child",
  Many: "children",
} as const;

// A2UI's identity + structural keys are not props of the component — they are the
// envelope's own vocabulary, and must not be forwarded into the render spec.
const STRUCTURAL_KEYS: readonly string[] = ["id", "component", ChildSlot.Single, ChildSlot.Many];

// A2UI's DataBinding. `{"path": "/contact/email"}` is a JSON Pointer INTO the data
// model — the same pointer json-render's $state takes.
const DATA_BINDING_KEY = "path";
const STATE_EXPRESSION_KEY = "$state";

export type A2uiDecode = { spec: JsonRenderSpec | null; issues: string[] };

export function compileA2uiDocument(source: string): A2uiDecode {
  const messages = parseMessages(source);
  if (messages.issues.length > 0) return { spec: null, issues: messages.issues };

  const components = new Map<string, Record<string, unknown>>();
  const dataModel: Record<string, unknown> = {};

  for (const message of messages.value) {
    applyMessage(message, components, dataModel);
  }

  if (components.size === 0) {
    return { spec: null, issues: [NO_COMPONENTS_ISSUE] };
  }
  if (!components.has(ROOT_COMPONENT_ID)) {
    return { spec: null, issues: [MISSING_ROOT_ISSUE] };
  }

  const elements: Record<string, UIElement> = {};
  for (const [id, component] of components) {
    elements[id] = toElement(component);
  }

  const hasState = Object.keys(dataModel).length > 0;

  return {
    spec: {
      root: ROOT_COMPONENT_ID,
      elements,
      ...(hasState ? { state: dataModel } : {}),
    },
    issues: [],
  };
}

const NO_COMPONENTS_ISSUE =
  "the stream carried no components: expected a createSurface or updateComponents message with a components list.";
const MISSING_ROOT_ISSUE =
  'no component has "id": "root". Exactly one component must be the root of the tree.';

// ---- The stream ----------------------------------------------------------------

type ParsedMessages = { value: Record<string, unknown>[]; issues: string[] };

// Their own prompt says the response is "a single, raw JSON object (usually a list
// of A2UI messages)", and their spec publishes the stream as JSONL. Both are real
// A2UI, so both are accepted — refusing one of the two shapes their own docs use
// would be failing the arm on a technicality.
function parseMessages(source: string): ParsedMessages {
  const trimmed = source.trim();
  if (trimmed.length === 0) return { value: [], issues: ["the document is empty."] };

  const asJson = parseJsonArrayOrObject(trimmed);
  if (asJson !== null) return { value: asJson, issues: [] };

  return parseJsonLines(trimmed);
}

function parseJsonArrayOrObject(source: string): Record<string, unknown>[] | null {
  try {
    const parsed: unknown = JSON.parse(source);
    if (Array.isArray(parsed)) return parsed.filter(isPlainObject);
    if (isPlainObject(parsed)) return [parsed];
    return null;
  } catch {
    return null;
  }
}

function parseJsonLines(source: string): ParsedMessages {
  const lines = source.split("\n").filter((line) => line.trim().length > 0);
  const value: Record<string, unknown>[] = [];
  const issues: string[] = [];

  for (const [index, line] of lines.entries()) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (isPlainObject(parsed)) value.push(parsed);
    } catch (error) {
      issues.push(`line ${index + 1} is not valid JSON (${messageOf(error)}).`);
    }
  }

  return { value, issues };
}

// ---- The envelope --------------------------------------------------------------

function applyMessage(
  message: Record<string, unknown>,
  components: Map<string, Record<string, unknown>>,
  dataModel: Record<string, unknown>,
): void {
  const createSurface = message[EnvelopeKey.CreateSurface];
  if (isPlainObject(createSurface)) {
    // createSurface may carry the whole UI inline — components AND dataModel are
    // both optional on it, and their own contact-form example uses both shapes.
    collectComponents(createSurface.components, components);
    mergeDataModel(dataModel, createSurface.dataModel);
  }

  const updateComponents = message[EnvelopeKey.UpdateComponents];
  if (isPlainObject(updateComponents)) {
    collectComponents(updateComponents.components, components);
  }

  const updateDataModel = message[EnvelopeKey.UpdateDataModel];
  if (isPlainObject(updateDataModel)) {
    applyDataModelUpdate(dataModel, updateDataModel);
  }
}

function collectComponents(
  value: unknown,
  components: Map<string, Record<string, unknown>>,
): void {
  if (!Array.isArray(value)) return;

  for (const component of value) {
    if (!isPlainObject(component)) continue;
    const id = component.id;
    if (typeof id !== "string") continue;
    // Later messages update earlier ones — upsert, which is A2UI's own semantics.
    components.set(id, component);
  }
}

// updateDataModel is an upsert at a JSON Pointer: an absent `path` (or "/")
// replaces the whole model, and an absent `value` removes the key. Straight from
// the spec, because a stream that used the shorthand and got mis-read would look
// like the model's error and would not be.
function applyDataModelUpdate(
  dataModel: Record<string, unknown>,
  update: Record<string, unknown>,
): void {
  const path = update[DATA_BINDING_KEY];
  const value = update.value;

  const replacesWholeModel = typeof path !== "string" || path === "" || path === "/";
  if (replacesWholeModel) {
    mergeDataModel(dataModel, value);
    return;
  }

  writePointer(dataModel, path, value);
}

function mergeDataModel(dataModel: Record<string, unknown>, value: unknown): void {
  if (!isPlainObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    dataModel[key] = nested;
  }
}

// RFC 6901, the subset a generated UI actually uses: object keys, created as it
// walks. json-render reads the same pointers out of `state`.
function writePointer(root: Record<string, unknown>, pointer: string, value: unknown): void {
  const segments = pointer.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return;

  let cursor: Record<string, unknown> = root;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (!isPlainObject(next)) {
      const created: Record<string, unknown> = {};
      cursor[segment] = created;
      cursor = created;
      continue;
    }
    cursor = next;
  }

  const leaf = segments[segments.length - 1] ?? "";
  if (value === undefined) {
    delete cursor[leaf];
    return;
  }
  cursor[leaf] = value;
}

// ---- One component -------------------------------------------------------------

function toElement(component: Record<string, unknown>): UIElement {
  const props: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(component)) {
    if (STRUCTURAL_KEYS.includes(key)) continue;
    props[key] = toPropValue(value);
  }

  const children = childIdsOf(component);
  const type = typeof component.component === "string" ? component.component : "";

  return {
    type,
    props,
    ...(children.length > 0 ? { children } : {}),
  };
}

// A2UI's DataBinding becomes json-render's $state — the SAME JSON Pointer, into
// the SAME document. Recursive, because a binding can sit inside an array or an
// object prop.
function toPropValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toPropValue);
  if (!isPlainObject(value)) return value;

  const pointer = value[DATA_BINDING_KEY];
  const isDataBinding = Object.keys(value).length === 1 && typeof pointer === "string";
  if (isDataBinding) return { [STATE_EXPRESSION_KEY]: pointer };

  const mapped: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    mapped[key] = toPropValue(nested);
  }
  return mapped;
}

function childIdsOf(component: Record<string, unknown>): string[] {
  const single = component[ChildSlot.Single];
  if (typeof single === "string") return [single];

  const many = component[ChildSlot.Many];
  if (!Array.isArray(many)) return [];

  return many.filter((id): id is string => typeof id === "string");
}

// ---- shared ---------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { SlotKind };
