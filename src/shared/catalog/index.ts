import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import * as z from "zod/v4";
import { PlanFileDefinition } from "./extensions/PlanFile.ts";
import { DiffViewerDefinition } from "./extensions/DiffViewer.ts";
import { MermaidEditorDefinition } from "./extensions/MermaidEditor.ts";
import { ChartDefinition } from "./extensions/Chart.ts";
import { DataTableDefinition } from "./extensions/DataTable.ts";

export const CanvasExtensionDefinitions = {
  PlanFile: PlanFileDefinition,
  DiffViewer: DiffViewerDefinition,
  MermaidEditor: MermaidEditorDefinition,
  Chart: ChartDefinition,
  DataTable: DataTableDefinition,
} as const;

// Canvas-specific actions. The browser registers handlers for these in
// canvas-actions.ts; specs (from MCP server) bind `on.<event>` to them so
// component interactions flow back through ActionProvider instead of every
// component calling fetch() directly.
//
// Keep these intentionally small and discrete. Continuous value edits flow
// via state binding + onStateChange; actions are for discrete events
// (commit-this-comment, flush-now, etc.).
export const CanvasActionDefinitions = {
  "canvas.commentMermaid": {
    params: z.object({
      nodeId: z.string().describe("ID of the mermaid node the comment is anchored to."),
      body: z.string().describe("Comment text. Markdown supported."),
    }),
    description:
      "Attach a user comment to a mermaid node. The browser fires this when the user clicks a node and submits a comment.",
  },
  "canvas.flushPending": {
    params: z.object({}),
    description:
      "Force-flush any pending debounced edits in the current slot immediately. Bind to a 'Send now' Button's on.press.",
  },
} as const;

// Catalog used by the MCP server (Node-importable — no React).
// Browser-side combines these definitions with React implementations from
// @json-render/shadcn + src/browser/components/*.
export const canvasCatalog = defineCatalog(schema, {
  components: {
    ...shadcnComponentDefinitions,
    ...CanvasExtensionDefinitions,
  },
  actions: CanvasActionDefinitions,
});

export type CanvasCatalog = typeof canvasCatalog;
