// The factory every catalog-authoring arm is built from.
//
// parchment-markup-*, parchment-json-*, scrambled-markup-* and terse-json all come
// out of this one function. They therefore share their grammar, their task
// encoding, and their repair phrasing BY CONSTRUCTION — the only things that vary
// are the three knobs the experiment turns: notation, vocabulary, and rung.
// Nothing else can drift, because there is nowhere else for it to drift.

import { AuthoringSurface, Fidelity, type Arm, type ArmId } from "../types.ts";
import { renderSurfaceReference, type Notation } from "../catalog/surface.ts";
import type { Vocabulary } from "../catalog/vocabulary.ts";
import { buildRepairPrompt } from "./repair-prompt.ts";
import {
  PASTE_ONLY_INSTRUCTION,
  REFERENCE_CAPABLE_INSTRUCTION,
  buildTaskPrompt,
} from "./task-encoding.ts";

export type CanvasArmInput = {
  readonly id: ArmId;
  readonly fidelity: Fidelity;
  readonly notation: Notation;
  readonly vocabulary: Vocabulary;
};

export function createCanvasArm(input: CanvasArmInput): Arm {
  const { id, fidelity, notation, vocabulary } = input;
  const systemPrompt = renderSurfaceReference({ vocabulary, fidelity, notation });
  const authoringInstruction = authoringInstructionFor(fidelity);

  return {
    id,
    fidelity,
    surface: AuthoringSurface.CanvasTool,
    systemPrompt,
    encodeTask: (scenario) => buildTaskPrompt(scenario, authoringInstruction),
    repairPrompt: buildRepairPrompt,
  };
}

function authoringInstructionFor(fidelity: Fidelity): string {
  if (fidelity === Fidelity.High) return REFERENCE_CAPABLE_INSTRUCTION;
  return PASTE_ONLY_INSTRUCTION;
}
