#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { canvasCatalog } from "../shared/catalog/index.ts";
import {
  PlanFilePropsSchema,
} from "../shared/catalog/extensions/PlanFile.ts";
import {
  DiffViewerPropsSchema,
} from "../shared/catalog/extensions/DiffViewer.ts";
import {
  MermaidEditorPropsSchema,
} from "../shared/catalog/extensions/MermaidEditor.ts";
import {
  DataTablePropsSchema,
} from "../shared/catalog/extensions/DataTable.ts";
import { SlotKind, SlotOrigin, type JsonRenderSpec } from "../shared/types.ts";
import { canvasSessionUrl, closeSlot, CanvasDaemonError, pushSlot } from "./canvas-client.ts";

// CANVAS_SESSION_ID is the override (set by install or for testing); fall
// back to CLAUDE_CODE_SESSION_ID which Claude Code exports in every MCP
// subprocess env (verified in spike).
const sessionId =
  process.env.CANVAS_SESSION_ID ??
  process.env.CLAUDE_CODE_SESSION_ID ??
  "default";
const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

function debugLog(line: string): void {
  if (process.env.CANVAS_MCP_DEBUG !== "1") return;
  try {
    const { appendFileSync } = require("node:fs") as typeof import("node:fs");
    appendFileSync("/tmp/canvas-mcp-debug.log", `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    // best-effort
  }
}

const ELEMENT_KEY = "main";

function singleElementSpec(type: string, props: Record<string, unknown>): JsonRenderSpec {
  return {
    root: ELEMENT_KEY,
    elements: {
      [ELEMENT_KEY]: { type, props, children: [] },
    },
  };
}

function okText(slotId: string): { content: [{ type: "text"; text: string }] } {
  debugLog(`OK slot=${slotId} session=${sessionId}`);
  return {
    content: [
      {
        type: "text",
        text: `Rendered to canvas slot ${slotId}. View: ${canvasSessionUrl(sessionId)}`,
      },
    ],
  };
}

function errorText(err: unknown): { content: [{ type: "text"; text: string }]; isError: true } {
  const message = err instanceof Error ? err.message : String(err);
  debugLog(`ERR ${message}`);
  return {
    content: [{ type: "text", text: `canvas error: ${message}` }],
    isError: true,
  };
}

const server = new McpServer({ name: "clawd-canvas", version: "0.2.0" });

server.registerTool(
  "canvas_plan",
  {
    title: "Render a Plan",
    description:
      "Render an editable plan as a PlanFile component. The user can edit the markdown in a WYSIWYG Tiptap editor; their edits flow back to your next turn as a <canvas-edit kind=\"plan-edit\"> block. Use for any multi-step plan, design doc, or rationale the user should be able to refine in place.",
    inputSchema: z.object({
      title: z.string().optional().describe("Optional slot title shown in the tab strip."),
      props: PlanFilePropsSchema,
      slotId: z.string().optional().describe("If supplied and a slot with this id exists, replace it. Otherwise allocate a new slot."),
    }),
  },
  async ({ title, props, slotId }) => {
    try {
      const slot = await pushSlot({
        sessionId,
        cwd,
        kind: SlotKind.Plan,
        title: title ?? props.title ?? "Plan",
        spec: singleElementSpec("PlanFile", props),
        origin: SlotOrigin.McpTool,
        ...(slotId !== undefined ? { slotId } : {}),
      });
      return okText(slot.id);
    } catch (caught) {
      return errorText(caught);
    }
  },
);

server.registerTool(
  "canvas_diagram",
  {
    title: "Render an Editable Diagram",
    description:
      "Render an editable mermaid diagram. Source pane + live render; the user can click any node to leave a comment and source edits flow back to your next turn. Use for architecture, sequences, state machines, ER, gantts.",
    inputSchema: z.object({
      title: z.string().optional(),
      props: MermaidEditorPropsSchema,
      slotId: z.string().optional(),
    }),
  },
  async ({ title, props, slotId }) => {
    try {
      const slot = await pushSlot({
        sessionId,
        cwd,
        kind: SlotKind.Diagram,
        title: title ?? props.title ?? "Diagram",
        spec: singleElementSpec("MermaidEditor", props),
        origin: SlotOrigin.McpTool,
        ...(slotId !== undefined ? { slotId } : {}),
      });
      return okText(slot.id);
    } catch (caught) {
      return errorText(caught);
    }
  },
);

server.registerTool(
  "canvas_diff",
  {
    title: "Render a Code Diff",
    description:
      "Render a side-by-side Monaco diff. The 'after' side is editable by default — the user can refine your proposed change before applying. Edits flow back as <canvas-edit kind=\"diff-edit\">. Use when you're proposing a code change the user should review and tweak.",
    inputSchema: z.object({
      title: z.string().optional(),
      props: DiffViewerPropsSchema,
      slotId: z.string().optional(),
    }),
  },
  async ({ title, props, slotId }) => {
    try {
      const slot = await pushSlot({
        sessionId,
        cwd,
        kind: SlotKind.Diff,
        title: title ?? `Diff: ${props.file}`,
        spec: singleElementSpec("DiffViewer", props),
        origin: SlotOrigin.McpTool,
        ...(slotId !== undefined ? { slotId } : {}),
      });
      return okText(slot.id);
    } catch (caught) {
      return errorText(caught);
    }
  },
);

server.registerTool(
  "canvas_table",
  {
    title: "Render a Data Table",
    description:
      "Render tabular data as a sortable DataTable with CSV export and optional inline edit. Use for query results, schedules, manifests, financial line items, any 'columns × rows' shape.",
    inputSchema: z.object({
      title: z.string().optional(),
      props: DataTablePropsSchema,
      slotId: z.string().optional(),
    }),
  },
  async ({ title, props, slotId }) => {
    try {
      const slot = await pushSlot({
        sessionId,
        cwd,
        kind: SlotKind.Table,
        title: title ?? props.caption ?? "Table",
        spec: singleElementSpec("DataTable", props),
        origin: SlotOrigin.McpTool,
        ...(slotId !== undefined ? { slotId } : {}),
      });
      return okText(slot.id);
    } catch (caught) {
      return errorText(caught);
    }
  },
);

// canvas_render uses the FULL canvas catalog (36 shadcn + 5 extensions) as its
// inputSchema, so Claude can compose arbitrary UI from any component. Use this
// for dashboards, reports, multi-component compositions.
const FullCanvasSpecSchema = canvasCatalog.zodSchema();

server.registerTool(
  "canvas_render",
  {
    title: "Render a Composed UI Spec",
    description:
      "Render an arbitrary json-render spec composed from the full catalog (36 shadcn components: Card, Stack, Grid, Tabs, Heading, Text, Badge, Button, Input, Select, Table, Alert, Dialog, ... — plus 5 canvas extensions: PlanFile, DiffViewer, MermaidEditor, Chart, DataTable). The spec must conform to the catalog schema; props for each element are validated. Use this for dashboards, reports, mixed-content compositions, or anything that doesn't fit the canvas_plan / canvas_diagram / canvas_diff / canvas_table shortcuts.",
    inputSchema: z.object({
      title: z.string().describe("Slot title shown in the tab strip."),
      kind: z
        .enum([
          SlotKind.Render,
          SlotKind.Dashboard,
          SlotKind.Report,
        ])
        .optional()
        .describe("Slot kind: 'dashboard' for metrics/charts compositions, 'report' for long-form mixed content, 'render' (default) for general UI."),
      spec: FullCanvasSpecSchema,
      slotId: z.string().optional(),
    }),
  },
  async ({ title, kind, spec, slotId }) => {
    try {
      const validated = canvasCatalog.validate(spec);
      const finalSpec = validated.success ? (validated.data as JsonRenderSpec) : (spec as JsonRenderSpec);
      const slot = await pushSlot({
        sessionId,
        cwd,
        kind: kind ?? SlotKind.Render,
        title,
        spec: finalSpec,
        origin: SlotOrigin.McpTool,
        ...(slotId !== undefined ? { slotId } : {}),
      });
      return okText(slot.id);
    } catch (caught) {
      return errorText(caught);
    }
  },
);

server.registerTool(
  "canvas_close",
  {
    title: "Close a Canvas Slot",
    description:
      "Remove a previously-rendered slot from the canvas. Use when a slot is no longer relevant (e.g., the user finished the task it was supporting).",
    inputSchema: z.object({
      slotId: z.string().describe("The slot id returned by a prior canvas_* tool."),
    }),
  },
  async ({ slotId }) => {
    try {
      await closeSlot(sessionId, slotId);
      return {
        content: [{ type: "text", text: `Closed canvas slot ${slotId}.` }],
      };
    } catch (caught) {
      return errorText(caught);
    }
  },
);

debugLog(`startup sessionId=${sessionId} cwd=${cwd} catalogSize=${canvasCatalog.componentNames.length} envCanvas=${process.env.CANVAS_SESSION_ID ?? "(unset)"} envClaude=${process.env.CLAUDE_CODE_SESSION_ID ?? "(unset)"}`);

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
