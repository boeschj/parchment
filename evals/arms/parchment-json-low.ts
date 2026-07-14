// The json-render spec on the low rung. With terse-json, this is the pair that
// prices the spec's structural keys against a minified version of the same tree.

import { ArmId, Fidelity, type Arm } from "../types.ts";
import { Notation } from "../catalog/surface.ts";
import { REAL_VOCABULARY } from "../catalog/vocabulary.ts";
import { createCanvasArm } from "./canvas-arm.ts";

export const parchmentJsonLowArm: Arm = createCanvasArm({
  id: ArmId.ParchmentJsonLow,
  fidelity: Fidelity.Low,
  notation: Notation.Json,
  vocabulary: REAL_VOCABULARY,
});
