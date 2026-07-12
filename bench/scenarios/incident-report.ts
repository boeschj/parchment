import { CanvasTool } from "../config.ts";
import type { ScenarioDefinition } from "./types.ts";

export const incidentReportScenario: ScenarioDefinition = {
  id: "incident-report",
  title: "Incident postmortem report",
  parchmentTool: CanvasTool.Render,
  parchmentPrompt: `Use canvas_render to build an incident postmortem report with:
- A Callout with the verdict: "Checkout API returned 500s for 12 minutes due to a database
  connection pool exhaustion."
- A Steps component with the timeline: 1) Deploy at 14:02 raised connection pool size to 5,
  2) Traffic spike at 14:10 exhausted the pool, 3) Alerts fired at 14:12, 4) Pool size reverted
  at 14:14, 5) Recovered at 14:14.
- A Markdown block listing 2 action items: raise the default pool size, add a pool-exhaustion alert.`,
  htmlPrompt: `Write a single self-contained HTML file at ./incident.html for an incident postmortem
report titled "Incident Report" with:
- A summary: "Checkout API returned 500s for 12 minutes due to a database connection pool exhaustion."
- An ordered timeline (<ol> or <ul>) with 5 steps: deploy at 14:02, traffic spike at 14:10,
  alerts fired at 14:12, pool size reverted at 14:14, recovered at 14:14.
- A root cause section and 2 action items.
No external stylesheets, scripts, or CDN links.`,
  parchmentRequirement: {
    minimumCountByComponentType: { Callout: 1, Steps: 1 },
  },
  htmlRequirements: [
    { description: "declares an HTML document", pattern: /<html[\s>]/i, minimumMatches: 1 },
    { description: "titled as an incident report", pattern: /Incident Report/i, minimumMatches: 1 },
    { description: "has a timeline list with at least 5 items", pattern: /<li[\s>]/i, minimumMatches: 5 },
    { description: "names the root cause", pattern: /connection pool/i, minimumMatches: 1 },
  ],
};
