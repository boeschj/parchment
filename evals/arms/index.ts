// The arm registry. Keyed by ArmId so the runner cannot invent one, and typed so
// a new ArmId that nobody built fails the compile rather than the run.

import { ArmId, type Arm } from "../types.ts";
import { parchmentMarkupHighArm } from "./parchment-markup-high.ts";
import { parchmentMarkupLowArm } from "./parchment-markup-low.ts";
import { parchmentJsonHighArm } from "./parchment-json-high.ts";
import { parchmentJsonLowArm } from "./parchment-json-low.ts";
import { scrambledMarkupHighArm } from "./scrambled-markup-high.ts";
import { scrambledMarkupLowArm } from "./scrambled-markup-low.ts";
import { terseJsonArm } from "./terse-json.ts";
import { openUiLangArm } from "./openui-lang.ts";
import { rawHtmlArm } from "./raw-html.ts";
import { rawJsxArm } from "./raw-jsx.ts";

export const ARMS = {
  [ArmId.ParchmentMarkupHigh]: parchmentMarkupHighArm,
  [ArmId.ParchmentMarkupLow]: parchmentMarkupLowArm,
  [ArmId.ParchmentJsonHigh]: parchmentJsonHighArm,
  [ArmId.ParchmentJsonLow]: parchmentJsonLowArm,
  [ArmId.ScrambledMarkupHigh]: scrambledMarkupHighArm,
  [ArmId.ScrambledMarkupLow]: scrambledMarkupLowArm,
  [ArmId.TerseJson]: terseJsonArm,
  [ArmId.OpenUiLang]: openUiLangArm,
  [ArmId.RawHtml]: rawHtmlArm,
  [ArmId.RawJsx]: rawJsxArm,
} as const satisfies Record<ArmId, Arm>;

export function armFor(id: ArmId): Arm {
  return ARMS[id];
}

// The arms the matrix actually runs. openui-lang is registered but not runnable —
// it throws on use, by design — so it is excluded here rather than silently
// producing a strawman's numbers.
export const RUNNABLE_ARM_IDS: readonly ArmId[] = Object.values(ArmId).filter(
  (id) => id !== ArmId.OpenUiLang,
);

export { RAW_HTML_OUTPUT_FILE } from "./raw-html.ts";
export { RAW_JSX_OUTPUT_FILE } from "./raw-jsx.ts";
