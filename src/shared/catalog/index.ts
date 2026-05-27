import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
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

// Catalog used by the MCP server (Node-importable — no React).
// Browser-side combines these definitions with React implementations from
// @json-render/shadcn + src/browser/components/*.
export const canvasCatalog = defineCatalog(schema, {
  components: {
    ...shadcnComponentDefinitions,
    ...CanvasExtensionDefinitions,
  },
  actions: {},
});

export type CanvasCatalog = typeof canvasCatalog;
