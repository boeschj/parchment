// The same catalog and the same rung as parchment-markup-high, expressed as the
// json-render spec. Isolates NOTATION from vocabulary: if markup wins here, it
// wins on syntax, not on the component names.

import { ArmId, Fidelity, type Arm } from "../types.ts";
import { Notation } from "../catalog/surface.ts";
import { REAL_VOCABULARY } from "../catalog/vocabulary.ts";
import { createCanvasArm } from "./canvas-arm.ts";

export const parchmentJsonHighArm: Arm = createCanvasArm({
  id: ArmId.ParchmentJsonHigh,
  fidelity: Fidelity.High,
  notation: Notation.Json,
  vocabulary: REAL_VOCABULARY,
});
