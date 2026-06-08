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
import { canvasShadcnOverrides } from "./registry/canvas-shadcn.tsx";

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

// Registry merge order (later wins):
//   1. shadcnComponents — defaults for the 36 primitives
//   2. canvasShadcnOverrides — our owned implementations matching Style
//      Guide for: Card, Stack, Grid, Separator, Heading, Text, Badge,
//      Button, Alert. Same prop contracts as shadcn so Claude's specs
//      still validate, but pill buttons + 24px-radius surfaces + Geist
//      typography + gold accent.
//   3. Canvas extensions (PlanFile, DiffViewer, MermaidEditor, Chart,
//      DataTable).
export const { registry } = defineRegistry(browserCatalog, {
  components: {
    ...shadcnComponents,
    ...canvasShadcnOverrides,
    PlanFile,
    DiffViewer,
    MermaidEditor,
    Chart,
    DataTable,
  },
});
