import { CanvasTool } from "../config.ts";
import type { ScenarioDefinition } from "./types.ts";

// The setup half of metric (c), tokens-per-live-update: this scenario builds
// the initial dashboard the same way every other scenario does. The update
// half — what a "live update" costs each arm once the dashboard exists — is
// a separate concern with its own interface; see live-update-plan.ts.
export const liveLogDashboardScenario: ScenarioDefinition = {
  id: "live-log-dashboard",
  title: "Live log dashboard (setup half of tokens-per-update)",
  parchmentTool: CanvasTool.Render,
  parchmentPrompt: `Use canvas_render to build a log monitoring dashboard: a line Chart of
error-rate-per-minute seeded with these 5 initial points: 2, 3, 1, 4, 2, and a DataTable of
the 3 most recent log lines: [ERROR] db timeout, [WARN] slow query 800ms, [INFO] cache
cleared. Put the chart's data in the spec's initial state and reference it, so later updates
can append to that state path.`,
  htmlPrompt: `Write a single self-contained HTML file at ./log-dashboard.html: a line chart
(inline <svg> or <canvas>) of error-rate-per-minute seeded with 5 initial points: 2, 3, 1, 4, 2,
and a <table> of the 3 most recent log lines: [ERROR] db timeout, [WARN] slow query 800ms,
[INFO] cache cleared. No external stylesheets, scripts, or CDN links.`,
  parchmentRequirement: {
    minimumCountByComponentType: { Chart: 1, DataTable: 1 },
  },
  htmlRequirements: [
    { description: "declares an HTML document", pattern: /<html[\s>]/i, minimumMatches: 1 },
    { description: "renders a chart (svg or canvas)", pattern: /<svg[\s>]|<canvas[\s>]/i, minimumMatches: 1 },
    { description: "renders a log table", pattern: /<table[\s>]/i, minimumMatches: 1 },
    { description: "shows the seeded log lines", pattern: /db timeout/, minimumMatches: 1 },
  ],
};
