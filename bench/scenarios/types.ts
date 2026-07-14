// A Scenario is a fixed task every arm attempts: a prompt per authoring surface
// (the parchment arms are told about canvas_render and the component vocabulary;
// the HTML arm is told to write one self-contained file) plus a machine-checkable
// definition of "correct" for each artifact. Scenario files stay pure data — the
// checking logic lives in validators/, shared across all scenarios.
//
// The two parchment arms — JSON spec and markup dialect — share this file's
// `parchmentPrompt`, `parchmentTool`, and `parchmentRequirement` verbatim. That
// is not a shortcut: the markup dialect COMPILES to the very same components, so
// a requirement stated in component types is satisfied identically either way,
// and running the identical prompt is what makes the two arms comparable. The
// markup arm's only extra input is the dialect steer the runner appends
// (MARKUP_ARM_INSTRUCTION in ../config.ts).

import type { CanvasTool } from "../config.ts";

export type ParchmentRequirement = {
  // Component `type` strings (e.g. "Chart", "Metric") that must each appear
  // at least the given number of times, summed across every element in every
  // slot the run produced. Checked against BOTH parchment arms.
  minimumCountByComponentType: Record<string, number>;
};

export type HtmlRequirement = {
  description: string;
  pattern: RegExp;
  minimumMatches: number;
};

export type ScenarioDefinition = {
  id: string;
  title: string;
  // The one canvas_* tool this scenario's parchment prompt asks the model to
  // call — the ONLY tool --allowedTools grants the parchment arm, so a run
  // can't "cheat" by reaching for a different authoring surface than the one
  // under test.
  parchmentTool: CanvasTool;
  parchmentPrompt: string;
  htmlPrompt: string;
  parchmentRequirement: ParchmentRequirement;
  htmlRequirements: HtmlRequirement[];
};
