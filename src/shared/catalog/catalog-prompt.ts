// The catalog as a model should see it: one dense signature per component,
// derived from the same widened schemas and contracts spec-validation.ts
// rejects against, so the prompt and the validator cannot drift.
//
// @json-render/core's catalog.prompt() re-serializes every Zod field as prose
// and spends 3,745 tokens listing 52 components. A signature says the same
// thing — prop names, required-ness, enum values, events, the bindable prop —
// in a form the model already reads fluently (a function signature), for a
// fraction of the tokens. Nothing the validator enforces is dropped:
// catalog-prompt.test.ts asserts every required prop, event, enum value and
// bindable prop in ComponentContracts is recoverable from this text.
//
// What is deliberately KEPT, because no type can carry it:
//   - each component's one-line description (it steers component CHOICE, which
//     the validator never checks: a Table where a Chart belonged still renders)
//   - the enum values themselves (the did-you-mean in spec-validation exists
//     because models guess them)

import * as z from "zod/v4";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { CanvasActionDefinitions, CanvasExtensionDefinitions } from "./index.ts";
import {
  ComponentContracts,
  ElementFields,
  KnownActionNames,
  KnownCheckTypes,
} from "./component-contracts.ts";
import { WidenedComponentPropSchemas } from "./prop-normal-forms.ts";

const OPTIONAL_MARKER = "?";
const CHILDREN_MARKER = "+children";
const EVENTS_MARKER = "->";
const BIND_MARKER = "=bind:";
const UNKNOWN_TYPE = "any";

export function compactCatalogPrompt(): string {
  return [
    formatSection(),
    componentSection(),
    actionSection(),
    rulesSection(),
  ].join("\n\n");
}

// ---- Components ------------------------------------------------------------

// `Name(required: type, optional?: type) +children ->event,event =bind:prop`
export function componentSignature(componentName: string): string {
  const contract = ComponentContracts[componentName];
  if (!contract) throw new Error(`catalog-prompt: no contract for "${componentName}"`);
  const shape = WidenedComponentPropSchemas[componentName]?.shape ?? {};
  const props = contract.knownProps.map((propName) =>
    propSignature(propName, shape[propName], contract.requiredProps.includes(propName)),
  );
  const suffixes = [
    acceptsChildren(componentName) ? CHILDREN_MARKER : "",
    contract.events.length > 0 ? `${EVENTS_MARKER}${contract.events.join(",")}` : "",
    contract.bindableProp ? `${BIND_MARKER}${contract.bindableProp}` : "",
  ].filter((suffix) => suffix.length > 0);
  return `${componentName}(${props.join(", ")})${suffixes.map((suffix) => ` ${suffix}`).join("")}`;
}

function propSignature(
  propName: string,
  field: z.ZodType | undefined,
  isRequired: boolean,
): string {
  const marker = isRequired ? "" : OPTIONAL_MARKER;
  return `${propName}${marker}: ${typeNotation(field)}`;
}

function componentSection(): string {
  const names = Object.keys(ComponentContracts);
  const lines = names.map((componentName) => {
    const description = descriptionOf(componentName);
    const hint = description.length > 0 ? ` — ${description}` : "";
    return `${componentSignature(componentName)}${hint}`;
  });
  return [
    `COMPONENTS (${names.length}) — signature is the contract:`,
    `  Name(required: type, optional?: type) ${CHILDREN_MARKER} ${EVENTS_MARKER}events ${BIND_MARKER}prop`,
    `  "a|b" = the only accepted values. ${CHILDREN_MARKER} = takes child keys.`,
    `  ${EVENTS_MARKER} = the only events it emits (any other "on" binding never fires).`,
    `  ${BIND_MARKER} = the only prop {"$bindState"} writes back through.`,
    `  A prop not in the signature does not exist — it is REJECTED, not ignored.`,
    `  Any prop may take an expression instead of a literal.`,
    "",
    ...lines,
  ].join("\n");
}

function acceptsChildren(componentName: string): boolean {
  const definition = componentDefinitions()[componentName];
  return (definition?.slots?.length ?? 0) > 0;
}

function descriptionOf(componentName: string): string {
  return componentDefinitions()[componentName]?.description ?? "";
}

type CatalogDefinition = {
  slots?: readonly string[];
  description?: string;
};

function componentDefinitions(): Readonly<Record<string, CatalogDefinition>> {
  return { ...shadcnComponentDefinitions, ...CanvasExtensionDefinitions };
}

// ---- Type notation ---------------------------------------------------------
// Walks the widened Zod schema the validator parses against, so the notation
// and the accepted values are the same fact.

// Takes the core interface, not the ZodType class: the wrappers expose their
// inner schema as $ZodType, and every Zod class implements it.
function typeNotation(field: z.core.$ZodType | undefined): string {
  if (!field) return UNKNOWN_TYPE;

  // A prop is declared optional by wrapping; the notation carries optionality
  // in the "?" marker, so unwrap to the type the value must actually land on.
  if (field instanceof z.ZodOptional) return typeNotation(field.def.innerType);
  if (field instanceof z.ZodNullable) return typeNotation(field.def.innerType);
  if (field instanceof z.ZodDefault) return typeNotation(field.def.innerType);
  // z.preprocess(normalize, base) — `out` is the base field the validator parses.
  if (field instanceof z.ZodPipe) return typeNotation(field.def.out);

  if (field instanceof z.ZodEnum) return Object.keys(field.def.entries).join("|");
  if (field instanceof z.ZodLiteral) return field.def.values.map(String).join("|");
  if (field instanceof z.ZodUnion) return unionNotation(field.def.options);
  if (field instanceof z.ZodArray) return `${typeNotation(field.def.element)}[]`;
  if (field instanceof z.ZodObject) return objectNotation(field.def.shape);
  if (field instanceof z.ZodString) return "str";
  if (field instanceof z.ZodNumber) return "num";
  if (field instanceof z.ZodBoolean) return "bool";
  if (field instanceof z.ZodRecord) return "obj";
  return UNKNOWN_TYPE;
}

function unionNotation(options: readonly z.core.$ZodType[]): string {
  const notations = options.map(typeNotation);
  const distinct = [...new Set(notations)];
  return distinct.join("|");
}

function objectNotation(shape: Record<string, z.ZodType>): string {
  const fields = Object.entries(shape).map(([fieldName, field]) => {
    const marker = isOptionalField(field) ? OPTIONAL_MARKER : "";
    return `${fieldName}${marker}: ${typeNotation(field)}`;
  });
  return `{${fields.join(", ")}}`;
}

function isOptionalField(field: z.ZodType): boolean {
  return field.safeParse(undefined).success || field.safeParse(null).success;
}

// ---- Actions ---------------------------------------------------------------

function actionSection(): string {
  const canvasActions = Object.entries(CanvasActionDefinitions).map(([actionName, definition]) => {
    const params = Object.keys(definition.params.shape).join(", ");
    return `${actionName}(${params}) — ${definition.description}`;
  });
  const builtInNames = KnownActionNames.filter(
    (actionName) => !Object.keys(CanvasActionDefinitions).includes(actionName),
  );
  return [
    `ACTIONS — bind under "on": {"<event>": {"action": "<name>", "params": {...}}}.`,
    `  An action not listed here has no handler: the binding silently does nothing.`,
    "",
    ...canvasActions,
    `built-in: ${builtInNames.join(", ")} (setState/pushState/removeState take {statePath, value}; validateForm takes {statePath?})`,
  ].join("\n");
}

// ---- Format and rules ------------------------------------------------------

function formatSection(): string {
  return [
    "Output a json-render spec: a FLAT element map. Children are referenced by key, never nested.",
    "",
    '{"root":"page","state":{"form":{"title":""}},"elements":{',
    ' "page":{"type":"Stack","props":{"gap":"lg"},"children":["m1","title-in"]},',
    ' "m1":{"type":"Metric","props":{"label":"p99","value":"412 ms"},"children":[]},',
    ' "title-in":{"type":"Input","props":{"label":"Title","name":"title","value":{"$bindState":"/form/title"}},"children":[]}}}',
    "",
    `An element carries ONLY these fields: ${ElementFields.join(", ")}. Anything else is dropped.`,
    "on / repeat / watch / visible are TOP-LEVEL element fields, never inside props.",
    "",
    "EXPRESSIONS (any prop value):",
    '  {"$state":"/path"} read · {"$bindState":"/path"} two-way (only on the =bind: prop)',
    '  {"$template":"Hi ${/user/name}"} interpolate · {"$cond":c,"$then":a,"$else":b} branch',
    '  In repeat scope: {"$item":"field"} · {"$index":true} · {"$bindItem":"field"}',
    "",
    "STATE: seed every path you reference in the spec-level \"state\" object — an unseeded path is REJECTED.",
    'REPEAT: {"repeat":{"statePath":"/todos","key":"id"}} renders the element once per array item. Use it for lists; never hand-roll one element per row.',
    'WATCH: keys are JSON Pointers ("/series"), whose value changes fire the bound actions. It does not feed props.',
    `CHECKS: props.checks = [{"type":"required","message":"..."}]. Known types: ${KnownCheckTypes.join(", ")}. Checks only run on a $bindState-bound field.`,
  ].join("\n");
}

function rulesSection(): string {
  return [
    "RULES:",
    "1. Every key in a children array exists in elements. Leaves carry \"children\": [].",
    "2. Every prop is in the component's signature; every required prop has a value (an expression counts).",
    "3. Every \"on\" event is one the component emits; every action name is real.",
    "4. Chart plots raw numbers (57, not \"57\" or \"57%\"). Metric values are preformatted strings.",
    "5. Seed realistic sample data in state — never leave an array empty.",
  ].join("\n");
}
