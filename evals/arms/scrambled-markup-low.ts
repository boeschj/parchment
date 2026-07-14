// parchment-markup-low with every identifier replaced by an opaque token. Pairs
// with scrambled-markup-high so the vocabulary effect can be read off at BOTH
// rungs — if familiarity only helps on one of them, that is worth knowing.

import { ArmId, Fidelity, type Arm } from "../types.ts";
import { Notation } from "../catalog/surface.ts";
import { SCRAMBLED_VOCABULARY } from "../catalog/vocabulary.ts";
import { createCanvasArm } from "./canvas-arm.ts";

export const scrambledMarkupLowArm: Arm = createCanvasArm({
  id: ArmId.ScrambledMarkupLow,
  fidelity: Fidelity.Low,
  notation: Notation.Markup,
  vocabulary: SCRAMBLED_VOCABULARY,
});
