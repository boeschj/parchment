import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import * as z from "zod/v4";
import { PlanFileDefinition } from "./extensions/PlanFile.ts";
import { DiffViewerDefinition } from "./extensions/DiffViewer.ts";
import { MermaidEditorDefinition } from "./extensions/MermaidEditor.ts";
import { ChartDefinition } from "./extensions/Chart.ts";
import { DataTableDefinition } from "./extensions/DataTable.ts";
import { MetricDefinition } from "./extensions/Metric.ts";
import { StepsDefinition } from "./extensions/Steps.ts";
import { CodeBlockDefinition } from "./extensions/CodeBlock.ts";
import { CalloutDefinition } from "./extensions/Callout.ts";
import { TerminalDefinition } from "./extensions/Terminal.ts";
import { FileChangeDefinition } from "./extensions/FileChange.ts";
import { TestResultsDefinition } from "./extensions/TestResults.ts";
import { MarkdownDefinition } from "./extensions/Markdown.ts";
import { Scene3DDefinition } from "./extensions/Scene3D.ts";
import { UploadDefinition } from "./extensions/Upload.ts";

export const CanvasExtensionDefinitions = {
  PlanFile: PlanFileDefinition,
  DiffViewer: DiffViewerDefinition,
  MermaidEditor: MermaidEditorDefinition,
  Chart: ChartDefinition,
  DataTable: DataTableDefinition,
  Metric: MetricDefinition,
  Steps: StepsDefinition,
  CodeBlock: CodeBlockDefinition,
  Callout: CalloutDefinition,
  Terminal: TerminalDefinition,
  FileChange: FileChangeDefinition,
  TestResults: TestResultsDefinition,
  Markdown: MarkdownDefinition,
  Scene3D: Scene3DDefinition,
  Upload: UploadDefinition,
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
  "canvas.submit": {
    params: z.object({
      id: z
        .string()
        .describe("Semantic id of what is being submitted, e.g. 'create-ticket-form'"),
      payload: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          'The data being submitted. Use {"$state": "/form"} to send current form state — expressions are resolved before delivery.',
        ),
    }),
    description:
      'Deliver a discrete submission (form data, a choice, a confirmation) back to Claude. It arrives on Claude\'s next turn as a <canvas-edit kind="form-submit"> block. Bind to a Button\'s on.press.',
  },
  "canvas.intent": {
    params: z.object({
      id: z
        .string()
        .describe("Semantic intent id, unique within the slot, e.g. 'retry-failed' or 'approve-deploy'."),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "STATIC JSON only — baked into the payload when the slot is rendered. No $state expressions (those belong to canvas.submit). The browser submits just the id; the daemon injects the params it recorded, so a page cannot alter them.",
        ),
    }),
    description:
      'Offer a structured action button (a menu of things you\'re prepared to do). On press it arrives as <canvas-edit kind="intent"> with the exact {id, params} you rendered — payload verified by the daemon. Bind to a Button\'s on.press for "Retry failed", "Deploy", "Open PR"-style controls.',
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
