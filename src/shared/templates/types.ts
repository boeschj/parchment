import type { JsonRenderSpec, SlotKind } from "../types.ts";

// A starter template shipped with the plugin — seeded into a fresh install's
// ~/.parchment/library/ so canvas_library has real, well-composed examples
// from the first session onward instead of an empty list.
export type StarterTemplate = {
  name: string;
  title: string;
  kind: SlotKind;
  spec: JsonRenderSpec;
};
