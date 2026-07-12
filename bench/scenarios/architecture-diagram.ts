import { CanvasTool } from "../config.ts";
import type { ScenarioDefinition } from "./types.ts";

export const architectureDiagramScenario: ScenarioDefinition = {
  id: "architecture-diagram",
  title: "Architecture diagram (3-tier system)",
  parchmentTool: CanvasTool.Render,
  parchmentPrompt: `Use canvas_render with a MermaidEditor component to render a mermaid architecture diagram
for a 3-tier system: a Client node calling an API node, which calls a Database node. Label the
nodes exactly "Client", "API", and "Database".`,
  htmlPrompt: `Write a single self-contained HTML file at ./architecture.html that diagrams a 3-tier
system: a Client box connected to an API box, connected to a Database box. Label the boxes
exactly "Client", "API", and "Database", and draw the connections with inline <svg> (lines
or arrows) — no external stylesheets, scripts, or CDN links.`,
  parchmentRequirement: {
    minimumCountByComponentType: { MermaidEditor: 1 },
  },
  htmlRequirements: [
    { description: "declares an HTML document", pattern: /<html[\s>]/i, minimumMatches: 1 },
    { description: "labels the Client node", pattern: /Client/, minimumMatches: 1 },
    { description: "labels the API node", pattern: /API/, minimumMatches: 1 },
    { description: "labels the Database node", pattern: /Database/, minimumMatches: 1 },
    { description: "draws at least 2 connections (svg lines/paths/arrows)", pattern: /<line[\s>]|<path[\s>]|<polyline[\s>]/i, minimumMatches: 2 },
  ],
};
