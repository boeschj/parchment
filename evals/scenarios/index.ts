// Every scenario the matrix can run, in one registry.
//
// The three LADDER scenarios are the headline: their source data lives on disk,
// so an arm that can reference a path emits a handful of tokens while an arm
// that cannot must paste thousands. The six PORTED scenarios carry their data
// inline (that is how the old suite posed them) and exist so the new numbers
// stay comparable to the old, invalidated ones.

import type { EvalScenario } from "../types.ts";
import { ladderScenarios } from "./ladder.ts";
import { portedScenarios } from "./ported.ts";

export const everyScenario: readonly EvalScenario[] = [
  ...ladderScenarios,
  ...portedScenarios,
];

export function scenarioById(scenarioId: string): EvalScenario {
  const scenario = everyScenario.find((candidate) => candidate.id === scenarioId);
  if (!scenario) {
    throw new Error(
      `unknown scenario "${scenarioId}". Known scenarios: ${everyScenarioId().join(", ")}`,
    );
  }
  return scenario;
}

export function everyScenarioId(): readonly string[] {
  return everyScenario.map((scenario) => scenario.id);
}

export { ladderScenarios } from "./ladder.ts";
export { portedScenarios } from "./ported.ts";
