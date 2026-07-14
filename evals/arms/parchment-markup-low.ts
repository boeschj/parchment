// Parchment's markup dialect on the low rung: same familiar vocabulary, but the
// model must carry every byte it wants shown. Isolates the ladder from the syntax.

import { ArmId, Fidelity, type Arm } from "../types.ts";
import { Notation } from "../catalog/surface.ts";
import { REAL_VOCABULARY } from "../catalog/vocabulary.ts";
import { createCanvasArm } from "./canvas-arm.ts";

export const parchmentMarkupLowArm: Arm = createCanvasArm({
  id: ArmId.ParchmentMarkupLow,
  fidelity: Fidelity.Low,
  notation: Notation.Markup,
  vocabulary: REAL_VOCABULARY,
});
