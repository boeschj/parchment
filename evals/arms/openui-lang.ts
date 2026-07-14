// INTENTIONALLY UNIMPLEMENTED.
//
// A rival format we have not read the spec for yet. Encoding it from memory would
// produce a caricature that loses, and a rigged loss is worse than no data — it
// would discredit every honest number in the matrix beside it.
//
// So this arm exists, is typed, is registered, and THROWS. It cannot be quietly
// included in a run and it cannot silently score zero: anything that touches its
// prompt or its task encoding fails loudly.
//
// To implement: read the spec, write the reference the way its own docs would
// write it, and give it the same fair shot as every other arm.

import { ArmId, AuthoringSurface, Fidelity, type Arm } from "../types.ts";

const NOT_IMPLEMENTED =
  "openui-lang not implemented — awaiting docs/internal/research/rival-formats.md";

export const openUiLangArm: Arm = {
  id: ArmId.OpenUiLang,
  fidelity: Fidelity.Low,
  surface: AuthoringSurface.CanvasTool,

  get systemPrompt(): string {
    throw new Error(NOT_IMPLEMENTED);
  },

  encodeTask(): string {
    throw new Error(NOT_IMPLEMENTED);
  },

  repairPrompt(): string {
    throw new Error(NOT_IMPLEMENTED);
  },
};
