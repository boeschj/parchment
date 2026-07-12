import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { defineRegistry } from "@json-render/react";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { shadcnComponents } from "@json-render/shadcn";
import { CanvasExtensionDefinitions } from "../shared/catalog/index.ts";
import { McpAppDefinition } from "../shared/catalog/extensions/McpApp.ts";
import { PlanFile } from "./components/PlanFile.tsx";
import { DiffViewer } from "./components/DiffViewer.tsx";
import { MermaidEditor } from "./components/MermaidEditor.tsx";
import { Chart } from "./components/Chart.tsx";
import { DataTable } from "./components/DataTable.tsx";
import { Metric } from "./components/Metric.tsx";
import { Steps } from "./components/Steps.tsx";
import { CodeBlock } from "./components/CodeBlock.tsx";
import { Callout } from "./components/Callout.tsx";
import { Terminal } from "./components/Terminal.tsx";
import { FileChange } from "./components/FileChange.tsx";
import { TestResults } from "./components/TestResults.tsx";
import { Markdown } from "./components/Markdown.tsx";
import { Scene3D } from "./components/Scene3D.tsx";
import { McpAppView } from "./components/McpAppView.tsx";
import { Upload } from "./components/Upload.tsx";
import { canvasShadcnOverrides } from "./registry/canvas-shadcn.tsx";

// Browser side: include both definitions + React implementations.
// Defining the catalog locally (rather than importing the shared one) keeps
// the Renderer's component type inference precise and avoids dragging the
// 24KB prompt blob into the browser bundle.
export const browserCatalog = defineCatalog(schema, {
  components: {
    ...shadcnComponentDefinitions,
    ...CanvasExtensionDefinitions,
    // Browser-only on purpose: McpApp elements are minted by the daemon's
    // canvas_app path; composed canvas_render specs may not name it (the MCP
    // validator rejects it as an unknown type).
    McpApp: McpAppDefinition,
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
//      DataTable, Metric, Steps, CodeBlock, Callout, Terminal, FileChange,
//      TestResults, Markdown).
export const { registry } = defineRegistry(browserCatalog, {
  components: {
    ...shadcnComponents,
    ...canvasShadcnOverrides,
    PlanFile,
    DiffViewer,
    MermaidEditor,
    Chart,
    DataTable,
    Metric,
    Steps,
    CodeBlock,
    Callout,
    Terminal,
    FileChange,
    TestResults,
    Markdown,
    Scene3D,
    Upload,
    McpApp: McpAppView,
  },
});
