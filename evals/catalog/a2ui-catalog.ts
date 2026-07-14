// PARCHMENT'S CATALOG, EXPRESSED AS AN A2UI CUSTOM CATALOG.
//
// THE CATALOG IS THE WHOLE FAIRNESS QUESTION FOR THIS ARM, SO IT IS STATED
// PLAINLY. A2UI's basic catalog is 18 components — Text, Image, Icon, Video,
// AudioPlayer, Row, Column, List, Card, Tabs, Modal, Divider, Button, TextField,
// CheckBox, ChoicePicker, Slider, DateTimeInput — and it contains NO Chart and NO
// Table. (Verified against the live catalog.json; a regex for chart|table|graph|plot
// returns zero hits. Their own "financial data grid" example builds a 3-row table
// by hand out of 17 components.) Benchmarking A2UI on a charting task with that
// catalog would produce a spectacular failure that has NOTHING to do with its
// format. It would be a textbook strawman, and it would discredit every other
// number in the table beside it.
//
// So A2UI is given a CUSTOM catalog: parchment's own 21 components, with the same
// prose and the same accepted values every other arm gets. This is not a favour
// and it is not a deviation from their spec — it is what their spec tells you to
// do (a2ui_protocol.md):
//
//     "Defining your own catalog allows you to restrict the agent to using exactly
//      the components and visual language that exist in your application. To use
//      your own catalog, simply include it in the prompt in place of the basic
//      catalog."
//
// and
//
//     "While the Basic Catalog is useful for starting out, most production
//      applications will define their own catalog to reflect their specific design
//      system."
//
// WHAT A2UI DOES NOT GET, BECAUSE IT DOES NOT HAVE IT: a content-avoidance
// mechanism. There is no URI, resource, data-source, tool-call or lazy-fetch
// concept anywhere in the v1.0 schema set — the only `url` properties in the whole
// catalog belong to Image, Video and AudioPlayer. Its data model is populated by
// the AGENT, inline, via createSurface.dataModel / updateDataModel.value. That
// absence is a finding, and it is reported as one; it is not something the harness
// did to it.

import {
  COMPONENT_SURFACE,
  SURFACE_COMPONENTS,
  acceptsChildrenIn,
  documentedPropNamesOf,
  isRequiredProp,
  notationOf,
  type SurfaceComponentName,
} from "./vocabulary.ts";

// A2UI's structural slots. A container names its children by ID — the adjacency
// list is the format's defining feature, and `children` is the ChildList type its
// own validator-compliance rule requires for a list of child ids.
const CHILDREN_SLOT = "children";

const PROP_INDENT = "  ";
const REQUIRED_LABEL = " (required)";

// ---- The catalog, as the prompt shows it -------------------------------------

export function renderA2uiCatalog(): string {
  const blocks = SURFACE_COMPONENTS.map(renderComponentBlock);
  return ["# Component catalog", "", ...blocks].join("\n");
}

function renderComponentBlock(component: SurfaceComponentName): string {
  const spec = COMPONENT_SURFACE[component];
  const propLines = documentedPropNamesOf(component).map((prop) => renderPropLine(component, prop));
  const childrenLine = acceptsChildrenIn(component)
    ? [`${PROP_INDENT}${CHILDREN_SLOT}: string[] — ids of this component's children.`]
    : [];

  return [
    `${component} — ${spec.purpose}`,
    ...childrenLine,
    ...propLines,
    `${PROP_INDENT}e.g. ${renderExample(component)}`,
    "",
  ].join("\n");
}

// Same prose, same accepted values, same required-ness as every other arm — read
// off the product, never hand-kept here.
function renderPropLine(component: SurfaceComponentName, prop: string): string {
  const meaning = propMeaningOf(component, prop);
  const notation = notationOf(component, prop);
  const required = isRequiredProp(component, prop) ? REQUIRED_LABEL : "";
  return `${PROP_INDENT}${prop}${required}: ${notation} — ${meaning}`;
}

function propMeaningOf(component: SurfaceComponentName, prop: string): string {
  const props: Readonly<Record<string, string>> = COMPONENT_SURFACE[component].props;
  return props[prop] ?? "";
}

// A2UI's component encoding: props sit INLINE on the component object, beside its
// id and its component name. There is no `props` wrapper and no `children: []` on
// a leaf — which is materially leaner than json-render's encoding of the same
// information, and is exactly why this arm is a serious rival on density.
function renderExample(component: SurfaceComponentName): string {
  const example = COMPONENT_SURFACE[component].example;
  const encoded = { id: exampleIdFor(component), component, ...example };
  return JSON.stringify(encoded);
}

function exampleIdFor(component: SurfaceComponentName): string {
  return component.toLowerCase();
}
