import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { defineRegistry } from "@json-render/react";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { shadcnComponents } from "@json-render/shadcn";
import { CanvasExtensionDefinitions } from "../shared/catalog/index.ts";
import { PlanFile } from "./components/PlanFile.tsx";
import { DiffViewer } from "./components/DiffViewer.tsx";
import { MermaidEditor } from "./components/MermaidEditor.tsx";
import { Chart } from "./components/Chart.tsx";
import { DataTable } from "./components/DataTable.tsx";

// Browser side: include both definitions + React implementations.
// Defining the catalog locally (rather than importing the shared one) keeps
// the Renderer's component type inference precise and avoids dragging the
// 24KB prompt blob into the browser bundle.
export const browserCatalog = defineCatalog(schema, {
  components: {
    ...shadcnComponentDefinitions,
    ...CanvasExtensionDefinitions,
  },
  actions: {},
});

export const { registry } = defineRegistry(browserCatalog, {
  components: {
    ...shadcnComponents,
    PlanFile,
    DiffViewer,
    MermaidEditor,
    Chart,
    DataTable,
  },
});
