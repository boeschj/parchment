// The compactness maximalist's position, represented at its best.
//
// Real component names, real prop names, real semantics — and the shortest
// possible structural keys ({t,p,c} rather than {type,props,children}). If the
// thesis is that familiarity beats compactness, this is the arm that gets to
// falsify it, so it is given a genuinely terse, complete, unambiguous reference
// rather than a caricature.
//
// Low fidelity by nature: a minified tree has nowhere to put a file reference.

import { ArmId, Fidelity, type Arm } from "../types.ts";
import { Notation } from "../catalog/surface.ts";
import { REAL_VOCABULARY } from "../catalog/vocabulary.ts";
import { createCanvasArm } from "./canvas-arm.ts";

export const terseJsonArm: Arm = createCanvasArm({
  id: ArmId.TerseJson,
  fidelity: Fidelity.Low,
  notation: Notation.TerseJson,
  vocabulary: REAL_VOCABULARY,
});
