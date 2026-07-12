import type { ScenarioDefinition } from "./types.ts";
import { statusDashboardScenario } from "./status-dashboard.ts";
import { csvDataTableScenario } from "./csv-data-table.ts";
import { architectureDiagramScenario } from "./architecture-diagram.ts";
import { incidentReportScenario } from "./incident-report.ts";
import { validatedFormScenario } from "./validated-form.ts";
import { liveLogDashboardScenario } from "./live-log-dashboard.ts";

export const SCENARIOS: readonly ScenarioDefinition[] = [
  statusDashboardScenario,
  csvDataTableScenario,
  architectureDiagramScenario,
  incidentReportScenario,
  validatedFormScenario,
  liveLogDashboardScenario,
];

export function findScenario(scenarioId: string): ScenarioDefinition {
  const scenario = SCENARIOS.find((candidate) => candidate.id === scenarioId);
  if (!scenario) {
    const knownIds = SCENARIOS.map((candidate) => candidate.id).join(", ");
    throw new Error(`unknown scenario id "${scenarioId}". Known scenarios: ${knownIds}`);
  }
  return scenario;
}

export type { ScenarioDefinition } from "./types.ts";
