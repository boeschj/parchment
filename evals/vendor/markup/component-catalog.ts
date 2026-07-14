// The bridge between HTML/JSX attribute spelling and the catalog's real prop
// schema. HTML parsers lowercase every tag and attribute name, so this module
// derives — from the SAME widened schemas the daemon validates against — a
// lowercase→camelCase prop map, a per-component boolean/number prop set, and
// the set of components that accept element children. Deriving instead of
// hand-listing means the dialect can never drift from the catalog: add a prop
// to a component and markup can address it the next build.

import * as z from "zod/v4";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { CanvasExtensionDefinitions } from "../../../src/shared/catalog/index.ts";
import { WidenedComponentPropSchemas } from "../../../src/shared/catalog/prop-normal-forms.ts";

type ComponentIntrospection = {
  canonicalName: string;
  propNameByLowercase: Readonly<Record<string, string>>;
  booleanProps: ReadonlySet<string>;
  numberProps: ReadonlySet<string>;
  propNames: readonly string[];
  acceptsChildren: boolean;
};

// Unwraps optional/default/nullable wrappers to the field's base schema. The
// widened schemas wrap normalized props in z.preprocess, but no boolean or
// number prop carries a normalizer, so preprocess never hides a base type we
// classify here. The field is treated as opaque — instanceof is the only thing
// we ask of it — so no zod internals leak into the signature.
function baseFieldOf(field: unknown): unknown {
  let current = field;
  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodDefault ||
    current instanceof z.ZodNullable
  ) {
    current = current.unwrap();
  }
  return current;
}

function isBooleanField(field: unknown): boolean {
  return baseFieldOf(field) instanceof z.ZodBoolean;
}

function isNumberField(field: unknown): boolean {
  return baseFieldOf(field) instanceof z.ZodNumber;
}

const componentsAcceptingChildren = deriveComponentsAcceptingChildren();

function deriveComponentsAcceptingChildren(): ReadonlySet<string> {
  const definitions = { ...shadcnComponentDefinitions, ...CanvasExtensionDefinitions };
  const names = new Set<string>();
  for (const [name, definition] of Object.entries(definitions)) {
    if (!("slots" in definition)) continue;
    if (Array.isArray(definition.slots) && definition.slots.length > 0) names.add(name);
  }
  return names;
}

function introspectComponent(canonicalName: string, schema: z.ZodObject): ComponentIntrospection {
  const propNameByLowercase: Record<string, string> = {};
  const booleanProps = new Set<string>();
  const numberProps = new Set<string>();
  const propNames = Object.keys(schema.shape);
  for (const propName of propNames) {
    propNameByLowercase[propName.toLowerCase()] = propName;
    const field = schema.shape[propName];
    if (field === undefined) continue;
    if (isBooleanField(field)) booleanProps.add(propName);
    if (isNumberField(field)) numberProps.add(propName);
  }
  return {
    canonicalName,
    propNameByLowercase,
    booleanProps,
    numberProps,
    propNames,
    acceptsChildren: componentsAcceptingChildren.has(canonicalName),
  };
}

const introspectionByComponent: Readonly<Record<string, ComponentIntrospection>> =
  Object.fromEntries(
    Object.entries(WidenedComponentPropSchemas).map(
      ([name, schema]) => [name, introspectComponent(name, schema)] as const,
    ),
  );

const canonicalNameByLowercase: Readonly<Record<string, string>> = Object.fromEntries(
  Object.keys(introspectionByComponent).map((name) => [name.toLowerCase(), name] as const),
);

// Case-insensitive component resolution: <Metric>, <metric>, and <METRIC> all
// resolve to the catalog's "Metric".
export function resolveComponentName(tag: string): string | null {
  return canonicalNameByLowercase[tag.toLowerCase()] ?? null;
}

export function propNameFor(component: string, lowercaseAttr: string): string | null {
  return introspectionByComponent[component]?.propNameByLowercase[lowercaseAttr] ?? null;
}

export function isBooleanProp(component: string, prop: string): boolean {
  return introspectionByComponent[component]?.booleanProps.has(prop) ?? false;
}

export function isNumberProp(component: string, prop: string): boolean {
  return introspectionByComponent[component]?.numberProps.has(prop) ?? false;
}

export function acceptsChildren(component: string): boolean {
  return introspectionByComponent[component]?.acceptsChildren ?? false;
}

export function knownPropNamesFor(component: string): readonly string[] {
  return introspectionByComponent[component]?.propNames ?? [];
}
