// What each component in the catalog ACTUALLY accepts and emits — derived from
// the schemas and implementations the browser renders against, never a
// hand-kept parallel list. spec-validation.ts rejects against these tables, so
// "the daemon accepted this spec" means "this spec renders".
//
// The tables answer four questions per component:
//   knownProps     — every prop name the renderer reads (anything else is dead)
//   requiredProps  — props with no value and no null form; absent = blank render
//   events         — the events the implementation emits (an `on` binding for
//                    any other event never fires)
//   bindableProp   — the prop $bindState writes back through (all others are
//                    read-only, so a $bindState on them silently never writes)

import * as z from "zod/v4";
import { builtInValidationFunctions } from "@json-render/core";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { CanvasActionDefinitions, CanvasExtensionDefinitions } from "./index.ts";
import { PropNameAliases, WidenedComponentPropSchemas } from "./prop-normal-forms.ts";

export type ComponentContract = {
  knownProps: readonly string[];
  requiredProps: readonly string[];
  events: readonly string[];
  bindableProp: string | null;
  // Declared input names that normalize to a known prop (prop-normal-forms).
  // Lowercase, matched case-insensitively — an incoming "xKey" is not unknown.
  aliasNames: readonly string[];
};

// The prop each component writes back through json-render's `bindings` map,
// read off the shadcn implementations (each reads `bindings?.<prop>` and
// ignores every other bound prop). The canvas extensions (PlanFile,
// MermaidEditor, DiffViewer, DataTable) post their edits straight to the
// daemon instead of writing state, so they bind nothing.
const BINDABLE_VALUE_PROPS: Readonly<Record<string, string>> = {
  Input: "value",
  Textarea: "value",
  Select: "value",
  Radio: "value",
  Slider: "value",
  Tabs: "value",
  ToggleGroup: "value",
  DropdownMenu: "value",
  Checkbox: "checked",
  Switch: "checked",
  Toggle: "pressed",
  ButtonGroup: "selected",
  Pagination: "page",
};

// Actions json-render's own ActionProvider executes before it consults the
// handler map (@json-render/react). The canvas handlers registered in
// src/browser/canvas-actions.ts are the CanvasActionDefinitions keys.
const BUILT_IN_ACTION_NAMES = [
  "setState",
  "pushState",
  "removeState",
  "validateForm",
  "push",
  "pop",
] as const;

export const KnownActionNames: readonly string[] = [
  ...Object.keys(CanvasActionDefinitions),
  ...BUILT_IN_ACTION_NAMES,
];

// Field-level validation check types (`props.checks[].type`). The prop schema
// types this as a bare string, so an unknown check silently never runs.
export const KnownCheckTypes: readonly string[] = Object.keys(builtInValidationFunctions);

// The only fields an element carries. Anything else — a $bindState or state
// object hoisted to the element — is dropped by the renderer.
export const ElementFields = ["type", "props", "children", "on", "visible", "repeat", "watch"] as const;

export type ElementField = (typeof ElementFields)[number];

type CatalogComponentDefinition = {
  props: z.ZodObject;
  events?: readonly string[];
};

function catalogDefinitions(): Readonly<Record<string, CatalogComponentDefinition>> {
  const definitions: Record<string, CatalogComponentDefinition> = {};
  const merged = { ...shadcnComponentDefinitions, ...CanvasExtensionDefinitions };
  for (const [componentName, definition] of Object.entries(merged)) {
    definitions[componentName] = definition;
  }
  return definitions;
}

export const ComponentContracts: Readonly<Record<string, ComponentContract>> = Object.fromEntries(
  Object.entries(catalogDefinitions()).map(([componentName, definition]) => {
    return [componentName, contractOf(componentName, definition)] as const;
  }),
);

function contractOf(
  componentName: string,
  definition: CatalogComponentDefinition,
): ComponentContract {
  const shape = widenedShapeOf(componentName);
  const knownProps = Object.keys(shape);
  return {
    knownProps,
    requiredProps: knownProps.filter((propName) => isRequiredField(shape[propName])),
    events: definition.events ?? [],
    bindableProp: bindablePropOf(componentName, knownProps),
    aliasNames: Object.keys(PropNameAliases[componentName] ?? {}),
  };
}

// The widened schema (declared input forms folded in) is what validation parses
// against, so its shape — not the base definition's — is the known-prop set.
function widenedShapeOf(componentName: string): Record<string, z.ZodType | undefined> {
  const schema = WidenedComponentPropSchemas[componentName];
  if (!schema) {
    throw new Error(`component-contracts: no widened schema for "${componentName}"`);
  }
  return schema.shape;
}

// json-render catalogs mark a prop optional by making it NULLABLE (the key
// stays in the shape so a model always sees it), so a prop is only genuinely
// required when it accepts neither a missing value nor null.
function isRequiredField(field: z.ZodType | undefined): boolean {
  if (!field) return false;
  const acceptsMissing = field.safeParse(undefined).success;
  const acceptsNull = field.safeParse(null).success;
  return !acceptsMissing && !acceptsNull;
}

function bindablePropOf(componentName: string, knownProps: readonly string[]): string | null {
  const bindableProp = BINDABLE_VALUE_PROPS[componentName];
  if (bindableProp === undefined) return null;
  if (!knownProps.includes(bindableProp)) {
    throw new Error(
      `component-contracts: "${componentName}.${bindableProp}" is bindable but not in the component's props schema`,
    );
  }
  return bindableProp;
}
