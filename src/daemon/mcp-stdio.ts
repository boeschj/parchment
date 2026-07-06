#!/usr/bin/env bun
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { applySpecPatch, autoFixSpec, formatSpecIssues, validateSpec, type JsonPatch, type Spec } from "@json-render/core";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { canvasCatalog, CanvasExtensionDefinitions } from "../shared/catalog/index.ts";
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
  readBoard,
  resolveActiveSessionId,
  sendBoardOps,
  sendSlotOps,
} from "./canvas-client.ts";
import { summarizeBoardScene } from "./board.ts";
import { STATE_DIR } from "./state.ts";

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

// canvas_render accepts the FULL element grammar (on/repeat/watch/visible/state)
// so interactive specs survive the MCP input layer. catalog.zodSchema() is NOT
// used here — it strips those fields (json-render #222). Validation instead
// happens in three explicit passes below, and failures come back to the model
// as tool errors it can act on.
const SpecElementSchema = z.object({
  type: z.string(),
  props: z.record(z.string(), z.unknown()).default({}),
  children: z.array(z.string()).optional(),
  visible: z.unknown().optional(),
  on: z.record(z.string(), z.unknown()).optional(),
  repeat: z
    .object({ statePath: z.string(), key: z.string().optional() })
    .optional(),
  watch: z.record(z.string(), z.unknown()).optional(),
});

const SpecInputSchema = z
  .object({
    root: z.string().describe("Key of the root element."),
    elements: z
      .record(z.string(), SpecElementSchema)
      .describe(
        "Flat element map. Children reference sibling keys. Element fields: type, props, children, visible, on (event→action bindings), repeat ({statePath, key}), watch.",
      ),
    state: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Initial state model. Seed every path referenced by $state/$bindState/repeat. Put large datasets here once and reference them.",
      ),
  })
  .describe("json-render spec: flat element tree + optional initial state.");

const ComponentPropSchemas: Record<string, z.ZodType> = Object.fromEntries([
  ...Object.entries(shadcnComponentDefinitions).map(([name, definition]) => {
    const propsSchema = definition.props as unknown as z.ZodObject;
    // shadcn definitions mark optional props .nullable() (not .optional());
    // partial() tolerates omission while still catching wrong types and enums.
    return [name, propsSchema.partial()] as const;
  }),
  ...Object.entries(CanvasExtensionDefinitions).map(
    ([name, definition]) => [name, definition.props as z.ZodType] as const,
  ),
]);

// Expression-valued props ({$state}, {$bindState}, {$template}, ...) resolve at
// render time, so their static type never matches the prop schema — skip them.
function isExpressionValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(isExpressionValue);
  if (typeof value !== "object" || value === null) return false;
  return Object.keys(value).some((key) => key.startsWith("$"));
}

function staticPropsOnly(props: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(props).filter(([, value]) => !isExpressionValue(value));
  return Object.fromEntries(entries);
}

type SpecIssueList = string[];

function validateElementProps(spec: Spec): SpecIssueList {
  const issues: SpecIssueList = [];
  for (const [key, element] of Object.entries(spec.elements)) {
    const schema = ComponentPropSchemas[element.type];
    if (!schema) {
      const known = canvasCatalog.componentNames.join(", ");
      issues.push(`elements/${key}: unknown component type "${element.type}". Known types: ${known}`);
      continue;
    }
    const parsed = schema.safeParse(staticPropsOnly(element.props ?? {}));
    if (parsed.success) continue;
    for (const issue of parsed.error.issues) {
      const path = issue.path.length > 0 ? `props/${issue.path.join("/")}` : "props";
      issues.push(`elements/${key}/${path}: ${issue.message}`);
    }
  }
  return issues;
}

function specRejection(issues: SpecIssueList): ReturnType<typeof errorText> {
  const bulleted = issues.map((issue) => `- ${issue}`).join("\n");
  return errorText(
    new Error(
      `spec rejected (${issues.length} issue${issues.length === 1 ? "" : "s"}):\n${bulleted}\nFix these exact issues and re-push with the same slotId.`,
    ),
  );
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
        spec: singleElementSpec("MermaidEditor", { editable: true, ...props }),
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

server.registerTool(
  "canvas_render",
  {
    title: "Compose a Generative UI",
    description:
      "DEFAULT TOOL for rich content — anything you'd otherwise explain in more than a paragraph of terminal text. Composes UI from a 49-component catalog: layout (Stack, Grid, Card, Tabs, Separator, Accordion), coding-agent widgets (Metric, Steps, CodeBlock, Callout, Terminal, FileChange, TestResults, Markdown, MermaidEditor, DiffViewer, Chart, DataTable, PlanFile), forms (Input, Select, Switch, Button, ...). Specs support initial `state`, $state/$bindState/$template expressions, repeat-over-state lists, and `on` event bindings — Button on.press → canvas.submit delivers form payloads back to your next turn, which lets you build working forms and mini-apps over MCP tools. Consult the canvas-tools skill for composition patterns and the canvas-spec skill for grammar. Invalid specs are REJECTED with an issue list — fix the issues and re-push with the same slotId. After substantial renders, verify visually with canvas_snapshot.",
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
      spec: SpecInputSchema,
      slotId: z.string().optional(),
    }),
  },
  async ({ title, kind, spec, slotId }) => {
    try {
      const resolvedSessionId = await resolveSessionId();
      const { spec: fixedSpec } = autoFixSpec(spec as unknown as Spec);
      const structural = validateSpec(fixedSpec, { checkOrphans: false });
      const structuralIssues = structural.valid
        ? []
        : formatSpecIssues(structural.issues).split("\n").filter(Boolean);
      const propIssues = validateElementProps(fixedSpec);
      const allIssues = [...structuralIssues, ...propIssues];
      if (allIssues.length > 0) {
        return specRejection(allIssues);
      }
      const slot = await pushSlot({
        sessionId: resolvedSessionId,
        cwd,
        kind: kind ?? SlotKind.Render,
        title,
        spec: fixedSpec as unknown as JsonRenderSpec,
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
  "canvas_snapshot",
  {
    title: "See a Canvas Slot",
    description:
      "Export a rendered canvas slot as a PNG you can actually look at. Call this after any substantial canvas_render to verify the layout reads well (answer visible up top, tiles in rows, no text walls), then fix problems by re-pushing the same slotId. Requires a connected canvas browser tab.",
    inputSchema: z.object({
      slotId: z.string().describe("The slot id returned by a prior canvas_* tool."),
    }),
  },
  async ({ slotId }) => {
    try {
      const resolvedSessionId = await resolveSessionId();
      const result = await sendSlotOps(resolvedSessionId, { exportPng: { slotId } });
      if (!result.ok || !result.pngBase64) {
        return errorText(new Error(result.error ?? "slot export failed"));
      }
      return {
        content: [{ type: "image" as const, data: result.pngBase64, mimeType: "image/png" as const }],
      };
    } catch (caught) {
      return errorText(caught);
    }
  },
);

// ---- Board tools ----------------------------------------------------------
// The board is a shared Excalidraw scene: the user draws with the full
// Excalidraw UI, Claude draws through these tools, both see the same scene
// live. Conversion happens in the connected browser tab, so draw tools fail
// fast (with the canvas URL) when no tab is open.

const BOARD_OP_FALLBACK_ERROR = "board op failed";

function boardOpFailure(result: { error?: string }): ReturnType<typeof errorText> {
  return errorText(new Error(result.error ?? BOARD_OP_FALLBACK_ERROR));
}

const BOARD_SKELETON_GUIDE =
  "Elements use Excalidraw's skeleton format: { type: 'rectangle'|'ellipse'|'diamond'|'text'|'line'|'arrow', x, y, width?, height?, label?: { text }, id?, strokeColor?, backgroundColor? }. " +
  "Give shapes ids and connect them with arrows via start/end: { type: 'arrow', x, y, start: { id: 'a' }, end: { id: 'b' } } — attachment points are computed automatically. " +
  "You must lay out x/y yourself (a column/grid plan works well); read the board first so new elements don't overlap existing ones.";

server.registerTool(
  "board_read",
  {
    title: "Read the Shared Board",
    description:
      "Read the shared Excalidraw board. Default 'summary' returns a compact structural list (type, id, position, text) — use it to plan edits and avoid overlap. 'full' returns raw element JSON; only request it when you need exact geometry.",
    inputSchema: z.object({
      format: z.enum(["summary", "full"]).optional(),
    }),
  },
  async ({ format }) => {
    try {
      const resolvedSessionId = await resolveSessionId();
      const scene = await readBoard(resolvedSessionId);
      const text =
        format === "full" ? JSON.stringify(scene.elements) : summarizeBoardScene(scene);
      return { content: [{ type: "text", text }] };
    } catch (caught) {
      return errorText(caught);
    }
  },
);

server.registerTool(
  "board_add_elements",
  {
    title: "Draw on the Shared Board",
    description:
      `Add elements to the shared Excalidraw board — the primary way to draw and to make targeted additions to an existing scene. ${BOARD_SKELETON_GUIDE}`,
    inputSchema: z.object({
      elements: z
        .array(z.record(z.string(), z.unknown()))
        .min(1)
        .describe("Excalidraw skeleton elements to add."),
    }),
  },
  async ({ elements }) => {
    try {
      const resolvedSessionId = await resolveSessionId();
      const result = await sendBoardOps(resolvedSessionId, { addSkeletons: elements });
      if (!result.ok) return boardOpFailure(result);
      return {
        content: [
          {
            type: "text",
            text: `Added ${elements.length} elements — board now has ${result.elementCount ?? "?"}. View: ${canvasSessionUrl(resolvedSessionId)}`,
          },
        ],
      };
    } catch (caught) {
      return errorText(caught);
    }
  },
);

server.registerTool(
  "board_draw_mermaid",
  {
    title: "Draw a Diagram onto the Board",
    description:
      "Convert mermaid syntax into hand-drawn Excalidraw elements on the shared board, with automatic layout. Best for drawing a whole diagram from scratch (flowchart, sequence, class, ER, state). The result is a one-shot insert — for follow-up tweaks, use board_add_elements / board_delete_elements instead of re-drawing.",
    inputSchema: z.object({
      mermaid: z.string().describe("Mermaid source, e.g. 'flowchart LR\\n  a[Client] --> b[API]'"),
    }),
  },
  async ({ mermaid }) => {
    try {
      const resolvedSessionId = await resolveSessionId();
      const result = await sendBoardOps(resolvedSessionId, { addMermaid: mermaid });
      if (!result.ok) return boardOpFailure(result);
      return {
        content: [
          {
            type: "text",
            text: `Diagram drawn — board now has ${result.elementCount ?? "?"} elements. View: ${canvasSessionUrl(resolvedSessionId)}`,
          },
        ],
      };
    } catch (caught) {
      return errorText(caught);
    }
  },
);

server.registerTool(
  "board_delete_elements",
  {
    title: "Delete Board Elements",
    description:
      "Remove elements from the shared board by id (get ids from board_read). Deleting a shape also detaches its bound label.",
    inputSchema: z.object({
      elementIds: z.array(z.string()).min(1),
    }),
  },
  async ({ elementIds }) => {
    try {
      const resolvedSessionId = await resolveSessionId();
      const result = await sendBoardOps(resolvedSessionId, { deleteElementIds: elementIds });
      if (!result.ok) return boardOpFailure(result);
      return {
        content: [
          {
            type: "text",
            text: `Deleted ${elementIds.length} elements — board now has ${result.elementCount ?? "?"}.`,
          },
        ],
      };
    } catch (caught) {
      return errorText(caught);
    }
  },
);

server.registerTool(
  "board_snapshot",
  {
    title: "See the Shared Board",
    description:
      "Export the current board as a PNG you can actually look at. Use after drawing to verify your work, or when the user says they've drawn/changed something on the board.",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const resolvedSessionId = await resolveSessionId();
      const result = await sendBoardOps(resolvedSessionId, { exportPng: true });
      if (!result.ok || !result.pngBase64) {
        return errorText(new Error(result.error ?? "board export failed"));
      }
      return {
        content: [{ type: "image" as const, data: result.pngBase64, mimeType: "image/png" as const }],
      };
    } catch (caught) {
      return errorText(caught);
    }
  },
);

server.registerTool(
  "canvas_patch",
  {
    title: "Patch a Rendered Slot",
    description:
      "Surgically update an existing slot with RFC 6902 JSON Patch operations against its spec — ~10x cheaper than re-sending the whole spec for small changes. Paths are relative to the spec object: /elements/<key>/props/<prop>, /elements/<key> (add/remove whole elements — remember to also patch the parent's children array), /state/<path>, /root. Use for iterations: new chart data, added tiles, text fixes, theme/prop tweaks. The patched spec is re-validated; failures reject with an issue list and the slot keeps its previous state.",
    inputSchema: z.object({
      slotId: z.string().describe("The slot to patch."),
      patches: z
        .array(
          z.object({
            op: z.enum(["add", "replace", "remove", "move", "copy", "test"]),
            path: z.string().describe("RFC 6901 pointer into the spec, e.g. /elements/chart/props/data"),
            value: z.unknown().optional(),
            from: z.string().optional(),
          }),
        )
        .min(1),
      title: z.string().optional().describe("Optionally retitle the slot."),
    }),
  },
  async ({ slotId, patches, title }) => {
    try {
      const resolvedSessionId = await resolveSessionId();
      const slotPath = join(STATE_DIR, "sessions", resolvedSessionId, "slots", `${slotId}.json`);
      if (!existsSync(slotPath)) {
        return errorText(new Error(`slot ${slotId} not found for session ${resolvedSessionId}`));
      }
      const slot = JSON.parse(readFileSync(slotPath, "utf8")) as {
        title: string;
        kind: SlotKind;
        spec: JsonRenderSpec;
      };
      let patched = slot.spec as unknown as Spec;
      for (const patch of patches) {
        const patchOp: JsonPatch = {
          op: patch.op,
          path: patch.path,
          ...(patch.value !== undefined ? { value: patch.value } : {}),
          ...(patch.from !== undefined ? { from: patch.from } : {}),
        };
        patched = applySpecPatch(patched, patchOp);
      }
      const structural = validateSpec(patched, { checkOrphans: false });
      const structuralIssues = structural.valid
        ? []
        : formatSpecIssues(structural.issues).split("\n").filter(Boolean);
      const propIssues = validateElementProps(patched);
      const allIssues = [...structuralIssues, ...propIssues];
      if (allIssues.length > 0) {
        return specRejection(allIssues);
      }
      const updated = await pushSlot({
        sessionId: resolvedSessionId,
        cwd,
        kind: slot.kind,
        title: title ?? slot.title,
        spec: patched as unknown as JsonRenderSpec,
        origin: SlotOrigin.McpTool,
        slotId,
      });
      return okText(updated.id, resolvedSessionId);
    } catch (caught) {
      return errorText(caught);
    }
  },
);

// ---- Saved UI library -----------------------------------------------------
// Slots persist on disk as full Slot JSON; the library is a named copy of
// {title, kind, spec, state} under ~/.canvas/library/. Users can also drop
// hand-written spec files there — anything loadable by canvas_load.

const LIBRARY_DIR = join(STATE_DIR, "library");

function libraryNameToPath(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length === 0) throw new Error(`invalid library name: "${name}"`);
  return join(LIBRARY_DIR, `${slug}.json`);
}

type LibraryEntry = {
  name: string;
  savedAt: number;
  title: string;
  kind: SlotKind;
  spec: JsonRenderSpec;
  state?: Record<string, unknown>;
};

server.registerTool(
  "canvas_save",
  {
    title: "Save a Slot to the UI Library",
    description:
      "Save a rendered slot's UI (spec + state) under a reusable name in the user's library (~/.canvas/library/). Use when the user says they like a view and wants to keep/reuse it. Reload later with canvas_load.",
    inputSchema: z.object({
      slotId: z.string().describe("The slot id to save."),
      name: z.string().describe("Library name, e.g. 'perf-dashboard'. Lowercased and slugified."),
    }),
  },
  async ({ slotId, name }) => {
    try {
      const resolvedSessionId = await resolveSessionId();
      const slotPath = join(STATE_DIR, "sessions", resolvedSessionId, "slots", `${slotId}.json`);
      if (!existsSync(slotPath)) {
        return errorText(new Error(`slot ${slotId} not found on disk for session ${resolvedSessionId}`));
      }
      const slot = JSON.parse(readFileSync(slotPath, "utf8")) as {
        title: string;
        kind: SlotKind;
        spec: JsonRenderSpec;
        state?: Record<string, unknown>;
      };
      const entry: LibraryEntry = {
        name,
        savedAt: Date.now(),
        title: slot.title,
        kind: slot.kind,
        spec: slot.spec,
        ...(slot.state && Object.keys(slot.state).length > 0 ? { state: slot.state } : {}),
      };
      mkdirSync(LIBRARY_DIR, { recursive: true });
      const target = libraryNameToPath(name);
      writeFileSync(target, JSON.stringify(entry, null, 2));
      return {
        content: [{ type: "text" as const, text: `Saved "${slot.title}" to library as ${name} (${target}).` }],
      };
    } catch (caught) {
      return errorText(caught);
    }
  },
);

server.registerTool(
  "canvas_load",
  {
    title: "Load a Saved UI from the Library",
    description:
      "Render a previously saved UI from the user's library onto the canvas. Refresh its data afterwards by re-pushing with the returned slotId if the saved data is stale.",
    inputSchema: z.object({
      name: z.string().describe("Library name used at save time."),
      slotId: z.string().optional().describe("Replace this slot instead of allocating a new one."),
    }),
  },
  async ({ name, slotId }) => {
    try {
      const resolvedSessionId = await resolveSessionId();
      const target = libraryNameToPath(name);
      if (!existsSync(target)) {
        const available = existsSync(LIBRARY_DIR)
          ? readdirSync(LIBRARY_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).join(", ")
          : "";
        return errorText(new Error(`no saved UI named "${name}". Available: ${available || "(library is empty)"}`));
      }
      const entry = JSON.parse(readFileSync(target, "utf8")) as LibraryEntry;
      const spec: JsonRenderSpec = entry.state ? { ...entry.spec, state: entry.state } : entry.spec;
      const slot = await pushSlot({
        sessionId: resolvedSessionId,
        cwd,
        kind: entry.kind ?? SlotKind.Render,
        title: entry.title ?? entry.name,
        spec,
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
  "canvas_library",
  {
    title: "List Saved UIs",
    description: "List the user's saved canvas UIs (name, title, saved date) from ~/.canvas/library/.",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      if (!existsSync(LIBRARY_DIR)) {
        return { content: [{ type: "text" as const, text: "Library is empty." }] };
      }
      const lines = readdirSync(LIBRARY_DIR)
        .filter((file) => file.endsWith(".json"))
        .map((file) => {
          try {
            const entry = JSON.parse(readFileSync(join(LIBRARY_DIR, file), "utf8")) as LibraryEntry;
            const saved = entry.savedAt ? new Date(entry.savedAt).toISOString().slice(0, 10) : "?";
            return `- ${file.replace(/\.json$/, "")} — "${entry.title}" (${entry.kind}, saved ${saved})`;
          } catch {
            return `- ${file.replace(/\.json$/, "")} — (unreadable)`;
          }
        });
      const text = lines.length > 0 ? `Saved UIs:\n${lines.join("\n")}` : "Library is empty.";
      return { content: [{ type: "text" as const, text }] };
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
