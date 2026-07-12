import { CanvasTool } from "../config.ts";
import type { ScenarioDefinition } from "./types.ts";

// The flagship demo scenario from the launch story: a KPI row plus two
// charts, the shape every "keep a dashboard of X" pitch reduces to.
export const statusDashboardScenario: ScenarioDefinition = {
  id: "status-dashboard",
  title: "CI status dashboard (KPI row + 2 charts)",
  parchmentTool: CanvasTool.Render,
  parchmentPrompt: `Use canvas_render to build a CI status dashboard with:
- A KPI row of 3 Metric tiles: Build Pass Rate 94%, Avg Build Time 4m12s, Open Incidents 2.
- A bar Chart of build durations in minutes for the last 7 days (Mon-Sun): 12, 8, 15, 9, 20, 7, 11.
- A line Chart of daily deploy counts for the last 7 days (Mon-Sun): 3, 5, 2, 6, 4, 7, 3.
Compose these inside a Grid/Stack layout in one canvas_render call.`,
  htmlPrompt: `Write a single self-contained HTML file at ./dashboard.html for a CI status dashboard with:
- A KPI row showing 3 numbers: Build Pass Rate 94%, Avg Build Time 4m12s, Open Incidents 2.
- A bar chart of build durations in minutes for the last 7 days (Mon-Sun): 12, 8, 15, 9, 20, 7, 11.
- A line chart of daily deploy counts for the last 7 days (Mon-Sun): 3, 5, 2, 6, 4, 7, 3.
Use inline <svg> or <canvas> for the charts — no external stylesheets, scripts, or CDN links; the file must open and render standalone from disk.`,
  parchmentRequirement: {
    minimumCountByComponentType: { Metric: 3, Chart: 2 },
  },
  htmlRequirements: [
    { description: "declares an HTML document", pattern: /<html[\s>]/i, minimumMatches: 1 },
    { description: "renders at least 2 charts (svg or canvas)", pattern: /<svg[\s>]|<canvas[\s>]/i, minimumMatches: 2 },
    { description: "shows the build pass rate", pattern: /94%/, minimumMatches: 1 },
    { description: "shows the average build time", pattern: /4m\s*12s|4:12/, minimumMatches: 1 },
    // A wide window: real markup wraps a KPI label and its value in separate
    // tags (e.g. `<div class="kpi-label">Open Incidents</div><div class="kpi-value">2</div>`),
    // easily 100+ characters apart even for one KPI tile.
    { description: "shows the open incident count", pattern: /Open Incidents[\s\S]{0,200}?\b2\b/i, minimumMatches: 1 },
  ],
};
