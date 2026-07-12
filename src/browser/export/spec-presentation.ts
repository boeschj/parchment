import type { JsonRenderSpec, UIElement } from "../../shared/types.ts";

// A live slot renders its interactive form (editable textareas, source panes,
// dead export buttons). An exported document wants the presentational form:
// the rendered diagram alone, a full non-editable table, no controls that
// cannot work in a static file. These per-type prop overrides turn a slot's
// spec into its document-shaped twin before it is rendered offscreen for
// capture. Overrides win over whatever the spec set.
const PresentationOverrides = {
  MermaidEditor: { editable: false, showSource: false },
  DataTable: { exportable: false, editable: false },
  PlanFile: { editable: false },
} as const satisfies Record<string, Record<string, unknown>>;

type PresentableType = keyof typeof PresentationOverrides;

function isPresentableType(type: string): type is PresentableType {
  return type in PresentationOverrides;
}

function applyPresentationOverrides(element: UIElement): UIElement {
  if (!isPresentableType(element.type)) return element;
  const overrides = PresentationOverrides[element.type];
  return { ...element, props: { ...element.props, ...overrides } };
}

// Pure: returns a new spec whose elements carry document-friendly props. Never
// mutates the input — the live slot keeps its interactive spec untouched.
export function toPresentationSpec(spec: JsonRenderSpec): JsonRenderSpec {
  const elements: Record<string, UIElement> = {};
  for (const [key, element] of Object.entries(spec.elements)) {
    elements[key] = applyPresentationOverrides(element);
  }
  return { ...spec, elements };
}
