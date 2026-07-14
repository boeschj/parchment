// parchment-markup-high with every identifier replaced by an opaque token.
//
// Identical grammar, identical runtime, identical structure, identical semantic
// descriptions — word for word. The ONLY difference is that <Chart kind="bar">
// is now <C08 a1="bar">. Whatever this arm costs above its twin is the price of
// unfamiliar vocabulary, and nothing else.

import { ArmId, Fidelity, type Arm } from "../types.ts";
import { Notation } from "../catalog/surface.ts";
import { SCRAMBLED_VOCABULARY } from "../catalog/vocabulary.ts";
import { createCanvasArm } from "./canvas-arm.ts";

export const scrambledMarkupHighArm: Arm = createCanvasArm({
  id: ArmId.ScrambledMarkupHigh,
  fidelity: Fidelity.High,
  notation: Notation.Markup,
  vocabulary: SCRAMBLED_VOCABULARY,
});
