import { CanvasTool } from "../config.ts";
import type { ScenarioDefinition } from "./types.ts";

const CSV_SNIPPET = `name,role,tickets_closed
Ada Lovelace,Engineer,42
Grace Hopper,Engineer,58
Alan Turing,Lead,31
Margaret Hamilton,Manager,19`;

export const csvDataTableScenario: ScenarioDefinition = {
  id: "csv-data-table",
  title: "Data table from a CSV snippet",
  parchmentTool: CanvasTool.Table,
  parchmentPrompt: `Use canvas_table to render this CSV as a sortable data table:

${CSV_SNIPPET}`,
  htmlPrompt: `Write a single self-contained HTML file at ./table.html rendering this CSV as an HTML table (one <tr> per row, including a header row):

${CSV_SNIPPET}

No external stylesheets, scripts, or CDN links.`,
  parchmentRequirement: {
    minimumCountByComponentType: { DataTable: 1 },
  },
  htmlRequirements: [
    { description: "declares an HTML document", pattern: /<html[\s>]/i, minimumMatches: 1 },
    { description: "renders a table", pattern: /<table[\s>]/i, minimumMatches: 1 },
    // Header row + 4 data rows.
    { description: "has at least 5 table rows", pattern: /<tr[\s>]/i, minimumMatches: 5 },
    { description: "includes every employee name", pattern: /Ada Lovelace/, minimumMatches: 1 },
    { description: "includes every employee name", pattern: /Grace Hopper/, minimumMatches: 1 },
    { description: "includes every employee name", pattern: /Alan Turing/, minimumMatches: 1 },
    { description: "includes every employee name", pattern: /Margaret Hamilton/, minimumMatches: 1 },
  ],
};
