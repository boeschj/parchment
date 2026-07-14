// Parchment's markup dialect on the high rung: familiar vocabulary, and the page
// may name a file instead of carrying it. The thesis arm.

import { ArmId, Fidelity, type Arm } from "../types.ts";
import { Notation } from "../catalog/surface.ts";
import { REAL_VOCABULARY } from "../catalog/vocabulary.ts";
import { createCanvasArm } from "./canvas-arm.ts";

export const parchmentMarkupHighArm: Arm = createCanvasArm({
  id: ArmId.ParchmentMarkupHigh,
  fidelity: Fidelity.High,
  notation: Notation.Markup,
  vocabulary: REAL_VOCABULARY,
});
