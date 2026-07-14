// The factory the raw-html and raw-jsx arms are built from.
//
// These arms get no component catalog, because they HAVE no component catalog —
// the model already knows the format. That near-zero protocol cost is not an
// oversight in the eval; it is the competing format's genuine advantage, and the
// whole point of measuring output tokens rather than schema tokens is to see
// whether it is enough.
//
// Their system prompts state the output contract and the sandbox, and stop. They
// are not told to paste file contents and they are not told to avoid it: they
// simply have no mechanism to reference a file, and what that costs them is the
// finding. Hobbling them further, or quietly helping them, would both be cheating.

import { AuthoringSurface, Fidelity, type Arm, type ArmId } from "../types.ts";
import { buildRepairPrompt } from "./repair-prompt.ts";
import { buildTaskPrompt, writtenFileInstruction } from "./task-encoding.ts";

export type WrittenFileArmInput = {
  readonly id: ArmId;
  readonly outputFile: string;
  readonly systemPrompt: string;
};

export function createWrittenFileArm(input: WrittenFileArmInput): Arm {
  const { id, outputFile, systemPrompt } = input;
  const authoringInstruction = writtenFileInstruction(outputFile);

  return {
    id,
    // No reference mechanism exists in a file the model writes by hand. The rung
    // is a property of the format, not a choice the eval makes for it.
    fidelity: Fidelity.Low,
    surface: AuthoringSurface.WrittenFile,
    systemPrompt,
    encodeTask: (scenario) => buildTaskPrompt(scenario, authoringInstruction),
    repairPrompt: buildRepairPrompt,
  };
}
