// A Scenario is a fixed task both arms attempt: one prompt per arm (the
// parchment arm is told about canvas_render and the component vocabulary; the
// HTML arm is told to write one self-contained file) plus a machine-checkable
// definition of "correct" for each arm's artifact. Scenario files stay pure
// data — the checking logic lives in validators/, shared across all scenarios.

import type { CanvasTool } from "../config.ts";

export type ParchmentRequirement = {
  // Component `type` strings (e.g. "Chart", "Metric") that must each appear
  // at least the given number of times, summed across every element in every
  // slot the run produced.
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
