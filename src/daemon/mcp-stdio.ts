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
import {
  canvasSessionUrl,
  closeSlot,
  pushSlot,
  resolveActiveSessionId,
} from "./canvas-client.ts";

const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const envSessionId =
  process.env.CANVAS_SESSION_ID ??
  process.env.CLAUDE_CODE_SESSION_ID ??
  null;

// Resolved each tool call (NOT cached at startup):
// - If env hint exists, use it.
// - Otherwise ask the daemon for the active session — the one with the highest
//   recent statusline heartbeat, biased by matching cwd. This is what makes
//   plugin-spawned MCP servers work even when Claude Code doesn't export
//   CLAUDE_CODE_SESSION_ID into the plugin's MCP env.
async function resolveSessionId(): Promise<string> {
  if (envSessionId) return envSessionId;
  const active = await resolveActiveSessionId(cwd);
  return active ?? "default";
}

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

function okText(slotId: string, resolvedSessionId: string): { content: [{ type: "text"; text: string }] } {
  debugLog(`OK slot=${slotId} session=${resolvedSessionId}`);
  return {
    content: [
      {
        type: "text",
        text: `Rendered to canvas slot ${slotId}. View: ${canvasSessionUrl(resolvedSessionId)}`,
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
    title: "Render an Editable Plan",
    description:
      "Render a SHORT, EDITABLE plan (≤300 words of markdown) the user will iterate on. This is a Tiptap WYSIWYG textarea — it is NOT a layout primitive. ONLY use this when the user asked for a plan they will refine; their wording matters and they will rewrite it. DO NOT use for analyses, reports, code architecture writeups, summaries, investigation results, or 'render this markdown' requests — those belong in canvas_render with composed shadcn components (Stack + Heading + Text + Card + MermaidEditor + DataTable + Chart). If you find yourself dumping >300 words of markdown into this tool, you're using the wrong tool — switch to canvas_render.",
    inputSchema: z.object({
      title: z.string().optional().describe("Optional slot title shown in the tab strip."),
      props: PlanFilePropsSchema,
      slotId: z.string().optional().describe("If supplied and a slot with this id exists, replace it. Otherwise allocate a new slot."),
    }),
  },
  async ({ title, props, slotId }) => {
    try {
      const resolvedSessionId = await resolveSessionId();
      const slot = await pushSlot({
        sessionId: resolvedSessionId,
        cwd,
        kind: SlotKind.Plan,
        title: title ?? props.title ?? "Plan",
        spec: singleElementSpec("PlanFile", props),
        origin: SlotOrigin.McpTool,
        ...(slotId !== undefined ? { slotId } : {}),
      });
      return okText(slot.id, resolvedSessionId);
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
      const resolvedSessionId = await resolveSessionId();
      const slot = await pushSlot({
        sessionId: resolvedSessionId,
        cwd,
        kind: SlotKind.Diagram,
        title: title ?? props.title ?? "Diagram",
        spec: singleElementSpec("MermaidEditor", props),
        origin: SlotOrigin.McpTool,
        ...(slotId !== undefined ? { slotId } : {}),
      });
      return okText(slot.id, resolvedSessionId);
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
      const resolvedSessionId = await resolveSessionId();
      const slot = await pushSlot({
        sessionId: resolvedSessionId,
        cwd,
        kind: SlotKind.Diff,
        title: title ?? `Diff: ${props.file}`,
        spec: singleElementSpec("DiffViewer", props),
        origin: SlotOrigin.McpTool,
        ...(slotId !== undefined ? { slotId } : {}),
      });
      return okText(slot.id, resolvedSessionId);
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
      const resolvedSessionId = await resolveSessionId();
      const slot = await pushSlot({
        sessionId: resolvedSessionId,
        cwd,
        kind: SlotKind.Table,
        title: title ?? props.caption ?? "Table",
        spec: singleElementSpec("DataTable", props),
        origin: SlotOrigin.McpTool,
        ...(slotId !== undefined ? { slotId } : {}),
      });
      return okText(slot.id, resolvedSessionId);
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
    title: "Compose a Generative UI",
    description:
      "DEFAULT TOOL for rich content. Render a COMPOSED UI from the 41-component catalog (Stack, Grid, Card, Heading, Text, Badge, Button, Tabs, Alert, Table, Separator, Accordion, Avatar, Progress, Tooltip, Input, Select, Switch, ... + the 5 canvas extensions: PlanFile, DiffViewer, MermaidEditor, Chart, DataTable). Use this WHENEVER you have something to show that isn't a one-liner — analyses, reports, dashboards, investigations, architecture writeups, multi-section explanations. COMPOSE the layout: outer Stack, Heading for the title, MermaidEditor for any diagram, Card sections for major chunks, DataTable for tabular data, Chart for metrics, Text for prose. Do NOT fall back to canvas_plan for long markdown — that's a single editable textarea, not a layout. The spec is validated against the catalog (props for each element are Zod-checked).",
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
      const resolvedSessionId = await resolveSessionId();
      const validated = canvasCatalog.validate(spec);
      const finalSpec = validated.success ? (validated.data as JsonRenderSpec) : (spec as JsonRenderSpec);
      const slot = await pushSlot({
        sessionId: resolvedSessionId,
        cwd,
        kind: kind ?? SlotKind.Render,
        title,
        spec: finalSpec,
        origin: SlotOrigin.McpTool,
        ...(slotId !== undefined ? { slotId } : {}),
      });
      return okText(slot.id, resolvedSessionId);
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
      const resolvedSessionId = await resolveSessionId();
      await closeSlot(resolvedSessionId, slotId);
      return {
        content: [{ type: "text", text: `Closed canvas slot ${slotId}.` }],
      };
    } catch (caught) {
      return errorText(caught);
    }
  },
);

debugLog(`startup envSessionId=${envSessionId ?? "(none, will resolve per-call)"} cwd=${cwd} catalogSize=${canvasCatalog.componentNames.length} envCanvas=${process.env.CANVAS_SESSION_ID ?? "(unset)"} envClaude=${process.env.CLAUDE_CODE_SESSION_ID ?? "(unset)"}`);
// One-time probe: dump every env var whose name hints at "session", "claude",
// "canvas", "plugin", or "cc_". This is how we learn whether plugin-spawned
// MCP subprocesses get CLAUDE_CODE_SESSION_ID (and under what name).
const relevantEnvKeys = Object.keys(process.env)
  .filter((key) => /^(CLAUDE|CC_|CANVAS|PLUGIN|SESSION)/i.test(key))
  .sort();
debugLog(
  `env-probe ${relevantEnvKeys
    .map((key) => `${key}=${(process.env[key] ?? "").slice(0, 80)}`)
    .join(" | ")}`,
);

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
