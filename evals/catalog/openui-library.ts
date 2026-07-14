// PARCHMENT'S CATALOG, EXPRESSED AS AN OPENUI LANG LIBRARY.
//
// This is the cleanest experiment in the whole matrix, and it is the one
// docs/internal/research/rival-formats.md calls for by name ("O-parchcat"): the
// SAME 21 components, with the SAME prose, carrying the SAME accepted values —
// and the only thing that differs is the grammar the model authors in. Anything
// else would be measuring which vendor wrote a tighter prompt generator.
//
// EVERY LINE OF THE PROMPT IS OPENUI'S OWN. The signatures, the syntax rules, the
// Query section, the hoisting warnings, the "Important Rules" — all of it comes
// out of `library.prompt()` in @openuidev/lang-core@0.2.9 (MIT), their shipped
// generator, called exactly as their docs call it. We wrote none of it.
//
// WE DELIBERATELY DID NOT USE THEIR benchmarks/system-prompt.txt. It is a
// checked-in static file, and it is the `toolCalls: false` variant: it contains
// no Query, no Mutation, no `$`, no `@`. It is also stale against their own
// library (it documents a row-oriented `Table(columns, rows)` that their current
// column-oriented `Table(columns: Col[])` replaced). Benchmarking against it
// would hand OpenUI a dialect in which the model HAS NO CHOICE but to paste the
// content — a strawman that would have handed us the win by omission. Their
// generator, with tools on, is OpenUI Lang at its best, and that is what this
// arm gets.

import { createLibrary, defineComponent } from "@openuidev/lang-core";
import * as z from "zod/v4";
import { WidenedComponentPropSchemas } from "../../src/shared/catalog/prop-normal-forms.ts";
import { ElementLevelReferences, PropValueReferences } from "../../src/shared/expressions.ts";
import {
  COMPONENT_SURFACE,
  SURFACE_COMPONENTS,
  acceptsChildrenIn,
  documentedPropNamesOf,
  isRequiredProp,
  notationOf,
  type SurfaceComponentName,
} from "./vocabulary.ts";

// OpenUI's root rule: `root = <RootComponent>(...)`. Card is the outermost
// surface in parchment's own examples, so it is the root here too.
const OPENUI_ROOT_COMPONENT = "Card";
const OPENUI_LIBRARY_ID = "parchment";

// A container's children are its FIRST positional argument, which is OpenUI's own
// convention throughout their standard library (`Stack([children], "row", "l")`).
const CHILDREN_PROP = "children";

// ---- The catalog, in OpenUI's notation ---------------------------------------

export function createParchmentOpenUiLibrary() {
  const components = SURFACE_COMPONENTS.map(defineSurfaceComponent);
  return createLibrary({
    id: OPENUI_LIBRARY_ID,
    components,
    root: OPENUI_ROOT_COMPONENT,
  });
}

// `defineComponent` also takes the React renderer that OpenUI's own runtime would
// mount. This eval never mounts it: an OpenUI program is parsed by their parser,
// translated to a render spec, and painted by parchment's browser — so the
// renderer is genuinely unused, and saying so with null is more honest than
// supplying a component nothing calls.
const RENDERER_UNUSED = null;

function defineSurfaceComponent(component: SurfaceComponentName) {
  return defineComponent({
    name: component,
    props: z.object(propSchemaFor(component)),
    description: describeComponent(component),
    component: RENDERER_UNUSED,
  });
}

// Positional-argument ORDER is Zod key order (OpenUI's rule 4), so this is the
// order the model will write its arguments in. Children first, then the
// component's documented props in the order parchment documents them.
function propSchemaFor(component: SurfaceComponentName): Record<string, z.ZodType> {
  const schema: Record<string, z.ZodType> = {};

  if (acceptsChildrenIn(component)) {
    schema[CHILDREN_PROP] = z.array(z.any()).optional();
  }

  for (const prop of documentedPropNamesOf(component)) {
    schema[prop] = propTypeFor(component, prop);
  }

  return schema;
}

// The accepted values come from the PRODUCT, exactly as they come for every other
// arm — parchment's own prompt prints `notationOf`, and so does this one. An arm
// that was not told `direction` takes "horizontal" would fail for want of
// INFORMATION rather than for want of expressiveness, and that is a manufactured
// loss, which is the same sin as a manufactured win.
function propTypeFor(component: SurfaceComponentName, prop: string): z.ZodType {
  const fromNotation = zodFromNotation(notationOf(component, prop));
  const widened = WidenedComponentPropSchemas[component]?.shape[prop];
  const schema = fromNotation ?? widened ?? z.any();

  if (isRequiredUnlessReferenced(component, prop)) return schema.optional();
  if (isRequiredProp(component, prop)) return schema;
  return schema.optional();
}

// "REQUIRED UNLESS REFERENCED" — the same label parchment's own high-fidelity
// prompt prints, and OpenUI must get the same permission or it loses to a trap.
//
// A DataTable's `columns` is required, and the daemon fills it once a $csv has
// named the file. parchment's markup arm simply omits the attribute. OpenUI's
// arguments are POSITIONAL, so a model that wants to reach `rows` must put
// something in `columns` — and its vendor's own idiom for a skipped argument is
// `null` (their generated prompt: `Select("dateRange", [...], null, null,
// $dateRange)`). Declared required, their parser then rejects that null outright:
//
//     required field "columns" cannot be null
//
// The arm would have failed the csv scenario for obeying its own documentation,
// with a reference mechanism that worked perfectly. So every prop the DAEMON can
// supply from a reference — read off the product's own tables, never a list kept
// here — is optional in this library, exactly as it is optional in parchment's
// prompt.
function isRequiredUnlessReferenced(component: SurfaceComponentName, prop: string): boolean {
  return daemonSuppliedPropsOf(component).includes(prop);
}

function daemonSuppliedPropsOf(component: SurfaceComponentName): readonly string[] {
  const elementLevel = ElementLevelReferences[component as keyof typeof ElementLevelReferences];
  const propValue = PropValueReferences[component as keyof typeof PropValueReferences];

  return [...(elementLevel?.supplies ?? []), ...(propValue?.supplies ?? [])];
}

const ENUM_SEPARATOR = "|";
const ARRAY_SUFFIX = "[]";

const PrimitiveNotation = {
  String: "str",
  Number: "num",
  Boolean: "bool",
  Object: "obj",
  Any: "any",
} as const;

// The product's printed notation, turned back into the Zod that prints it. It is
// the same string parchment's own prompt shows the model, so no arm is told a
// value set the other is not. Anything richer than a scalar, an enum, or an array
// of them (a Chart's data rows, a Steps' items) is left to the widened schema,
// which OpenUI's own signature builder already renders faithfully.
function zodFromNotation(notation: string): z.ZodType | null {
  const scalar = scalarFromNotation(notation);
  if (scalar !== null) return scalar;

  const isEnum = notation.includes(ENUM_SEPARATOR) && !notation.includes("{");
  if (!isEnum) return null;

  const members = notation.split(ENUM_SEPARATOR);
  const scalarMembers = members.map(scalarFromNotation);
  const isScalarUnion = scalarMembers.every((member) => member !== null);
  if (isScalarUnion) return z.union(scalarMembers as [z.ZodType, z.ZodType]);

  const isPlainEnum = members.every((member) => /^[\w.-]+$/.test(member));
  if (!isPlainEnum) return null;
  return z.enum(members as [string, ...string[]]);
}

function scalarFromNotation(notation: string): z.ZodType | null {
  if (notation === PrimitiveNotation.String) return z.string();
  if (notation === PrimitiveNotation.Number) return z.number();
  if (notation === PrimitiveNotation.Boolean) return z.boolean();
  if (notation === PrimitiveNotation.Any) return z.any();
  if (notation === `${PrimitiveNotation.String}${ARRAY_SUFFIX}`) return z.array(z.string());
  if (notation === `${PrimitiveNotation.Number}${ARRAY_SUFFIX}`) return z.array(z.number());
  if (notation === `${PrimitiveNotation.Object}${ARRAY_SUFFIX}`) return z.array(z.any());
  return null;
}

// OpenUI carries one description per COMPONENT where parchment's prompt carries
// one sentence per PROP. The prose is the same prose, moved into the slot
// OpenUI's format has for it — so the arm is told everything parchment's arm is
// told, in OpenUI's own idiom. It buys OpenUI nothing on the headline metric
// (which counts OUTPUT tokens) and it removes any suggestion we starved it.
function describeComponent(component: SurfaceComponentName): string {
  const spec = COMPONENT_SURFACE[component];
  const propProse = Object.entries(spec.props)
    .map(([prop, meaning]) => `${prop}: ${meaning}`)
    .join(" ");
  return `${spec.purpose} ${propProse}`;
}
