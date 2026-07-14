#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { applySpecPatch, type JsonPatch, type Spec } from "@json-render/core";
import { canvasCatalog } from "../shared/catalog/index.ts";
import { PlanFilePropsSchema } from "../shared/catalog/extensions/PlanFile.ts";
import { SlotKind, SlotOrigin, type JsonRenderSpec } from "../shared/types.ts";
import {
  canvasSessionUrl,
  closeSlot,
  openApp,
  pushSlot,
  putLiveSources,
  resolveActiveSessionId,
  sendSlotOps,
} from "./canvas-client.ts";
import { LiveSourceInputSchema } from "./live/types.ts";
import { prepareSpec } from "./spec-validation.ts";
import { STATE_DIR } from "./state.ts";
import { ensureLibrarySeeded, listLibraryEntryNames, readLibraryEntry, writeLibraryEntry } from "./library.ts";

// Fresh installs see the shipped starter templates in canvas_library from
// the first tool call — cheap no-op on every call after the first (guarded
// by the ~/.parchment/library/.seeded marker).
ensureLibrarySeeded();

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
      .describe("Flat element map; children reference sibling keys."),
    state: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Initial state; seed every bound path once."),
  })
  .describe("json-render spec: flat element tree + optional state.");

function specRejection(issues: string[]): ReturnType<typeof errorText> {
  const bulleted = issues.map((issue) => `- ${issue}`).join("\n");
  return errorText(
    new Error(
      `spec rejected (${issues.length} issue${issues.length === 1 ? "" : "s"}):\n${bulleted}\nFix these exact issues and re-push with the same slotId.`,
    ),
  );
}

const server = new McpServer({ name: "parchment", version: "0.1.0" });

server.registerTool(
  "canvas_plan",
  {
    title: "Render an Editable Plan",
    description:
      "Render a SHORT editable plan (≤300 words of markdown) the user will rewrite in their own words — a Tiptap WYSIWYG editor, not a layout primitive. Only for plans the user refines; analyses, reports, and 'render this markdown' belong in canvas_render.",
    inputSchema: z.object({
      title: z.string().optional().describe("Slot title shown in the tab strip."),
      props: PlanFilePropsSchema,
      slotId: z.string().optional().describe("Existing slot id to replace, else a new slot."),
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
  "canvas_render",
  {
    title: "Compose a Generative UI",
    description:
      "DEFAULT tool for rich content — charts, tables, diagrams, forms, documents, dashboards — composed from a 52-component catalog. Specs carry `state`, $state/$bindState/$template expressions, repeat lists, and `on` event bindings (interactive forms). Prop values also accept reference forms the daemon hydrates from local sources — {\"$file\"}, {\"$diff\"}, {\"$csv\"}, {\"$img\"}, optionally {\"watch\":true} (see canvas-tools references/content-refs.md). Invalid specs return a precise issue list — fix and re-push with the same slotId. Composition and grammar: the canvas-tools and canvas-spec skills.",
    inputSchema: z.object({
      title: z.string().describe("Slot title shown in the tab strip."),
      kind: z
        .enum([
          SlotKind.Render,
          SlotKind.Dashboard,
          SlotKind.Report,
        ])
        .optional()
        .describe("'dashboard' for metrics/charts, 'report' for long-form prose, else 'render' (default)."),
      spec: SpecInputSchema,
      slotId: z.string().optional().describe("Existing slot id to replace, else a new slot."),
    }),
  },
  async ({ title, kind, spec, slotId }) => {
    try {
      const resolvedSessionId = await resolveSessionId();
      const { spec: preparedSpec, issues } = prepareSpec(spec as unknown as JsonRenderSpec);
      if (issues.length > 0) {
        return specRejection(issues);
      }
      const slot = await pushSlot({
        sessionId: resolvedSessionId,
        cwd,
        kind: kind ?? SlotKind.Render,
        title,
        spec: preparedSpec,
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
  "canvas_live",
  {
    title: "Stream Live Data into a Slot",
    description:
      "Attach live data sources to a rendered slot so its state keeps updating with no further tool calls. Render a spec whose components bind to state paths seeded as [], then register sources here targeting them; each call replaces the slot's full source set ([] stops streaming). claude-sessions is a built-in fleet+cost scanner. NOTE: command-poll sources do NOT start on your say-so — the user must approve the exact command in the canvas first, and the tool result tells you which are waiting. Cookbook: canvas-tools references/live-data.md.",
    inputSchema: z.object({
      slotId: z.string().describe("Slot to feed, from a prior canvas_render."),
      sources: z
        .array(LiveSourceInputSchema)
        .describe("The slot's complete source set — replaces any previous registration."),
    }),
  },
  async ({ slotId, sources }) => {
    try {
      const resolvedSessionId = await resolveSessionId();
      const { sourceIds, pendingApproval } = await putLiveSources(
        resolvedSessionId,
        slotId,
        sources,
      );
      if (sourceIds.length === 0) {
        return {
          content: [
            { type: "text" as const, text: `Stopped live streaming for slot ${slotId}.` },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Streaming ${sourceIds.join(", ")} into slot ${slotId}. State updates flow with no further tool calls.${pendingApprovalNote(pendingApproval)} View: ${canvasSessionUrl(resolvedSessionId)}`,
          },
        ],
      };
    } catch (caught) {
      return errorText(caught);
    }
  },
);

// command-poll runs a shell command on a timer, so the user approves it in the
// canvas before it executes. Say so plainly: an agent told "streaming" while a
// source sits parked will keep waiting for data that is never coming.
function pendingApprovalNote(pendingApproval: string[]): string {
  if (pendingApproval.length === 0) return "";
  return ` NOT RUNNING YET: ${pendingApproval.join(", ")} ${pendingApproval.length === 1 ? "is" : "are"} waiting for the user to approve the command in the canvas — tell them to approve it there.`;
}

server.registerTool(
  "canvas_app",
  {
    title: "Open an MCP App in a Canvas Slot",
    description:
      "Host a third-party MCP app UI (mcp-ui / SEP-1865) in a sandboxed canvas slot. Use an app server from ~/.parchment/apps.json, or register one inline with command/url (only what the user provided — never install anything). Call its `tool` or open a ui:// `resource`; its model-context updates arrive next turn as untrusted <canvas-edit kind=\"app-model-context\">. Details: canvas-tools references/mcp-apps.md.",
    inputSchema: z.object({
      server: z
        .string()
        .describe("App server name in apps.json, or the name to register command/url under."),
      command: z
        .string()
        .optional()
        .describe("stdio app server executable (e.g. 'bun'). User-supplied only."),
      args: z.array(z.string()).optional().describe("Arguments for command."),
      env: z.record(z.string(), z.string()).optional().describe("Literal env vars for the stdio server."),
      inheritEnv: z.array(z.string()).optional().describe("Daemon env var NAMES to forward (allowlist)."),
      url: z.url().optional().describe("Remote HTTP app server URL instead of a command."),
      tool: z.string().optional().describe("Tool to call; its UI renders in the slot."),
      toolArgs: z.record(z.string(), z.unknown()).optional().describe("Arguments for tool."),
      resource: z.string().optional().describe("A ui:// resource to open instead of a tool."),
      title: z.string().optional().describe("Slot title. Defaults to the tool name."),
      slotId: z.string().optional().describe("Existing slot id to replace, else a new slot."),
    }),
  },
  async ({ server: serverName, command, args, env, inheritEnv, url, tool, toolArgs, resource, title, slotId }) => {
    try {
      if (!tool && !resource) {
        return errorText(new Error("canvas_app needs a `tool` to call or a ui:// `resource` to open"));
      }
      const register = buildRegistration({ command, args, env, inheritEnv, url });
      const resolvedSessionId = await resolveSessionId();
      const outcome = await openApp({
        sessionId: resolvedSessionId,
        cwd,
        server: serverName,
        ...(register !== null ? { register } : {}),
        ...(tool !== undefined ? { tool } : {}),
        ...(toolArgs !== undefined ? { toolArgs } : {}),
        ...(resource !== undefined ? { resource } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(slotId !== undefined ? { slotId } : {}),
      });
      const lines = [
        `Opened MCP app "${serverName}" in canvas slot ${outcome.slot.id} (resource ${outcome.resourceUri}).`,
        `View: ${canvasSessionUrl(resolvedSessionId)}`,
        outcome.summary.length > 0 ? `App output:\n${outcome.summary}` : "",
      ].filter(Boolean);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (caught) {
      return errorText(caught);
    }
  },
);

type RegistrationFields = {
  command?: string | undefined;
  args?: string[] | undefined;
  env?: Record<string, string> | undefined;
  inheritEnv?: string[] | undefined;
  url?: string | undefined;
};

function buildRegistration(fields: RegistrationFields): Record<string, unknown> | null {
  if (fields.url !== undefined) {
    return { url: fields.url };
  }
  if (fields.command !== undefined) {
    return {
      command: fields.command,
      args: fields.args ?? [],
      env: fields.env ?? {},
      inheritEnv: fields.inheritEnv ?? [],
    };
  }
  return null;
}

server.registerTool(
  "canvas_snapshot",
  {
    title: "See a Canvas Slot",
    description:
      "Export a rendered slot as a PNG to verify the layout, then fix problems by re-pushing the same slotId. Requires a connected canvas browser tab.",
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

server.registerTool(
  "canvas_patch",
  {
    title: "Patch a Rendered Slot",
    description:
      "PATCH-FIRST: for a small change to a slot already on the canvas (a metric value, an added row, a toggled visibility) — ~10x cheaper than re-rendering. RFC 6902 JSON Patch against the slot spec; paths like /elements/<key>/props/<prop>, /state/<path>, append with '-'. The patched spec is re-validated; failures reject. Examples: canvas-tools references/patch-cookbook.md.",
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
      const { spec: preparedSpec, issues } = prepareSpec(patched as unknown as JsonRenderSpec);
      if (issues.length > 0) {
        return specRejection(issues);
      }
      const updated = await pushSlot({
        sessionId: resolvedSessionId,
        cwd,
        kind: slot.kind,
        title: title ?? slot.title,
        spec: preparedSpec,
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
// One tool over three actions. Entries are a named copy of {title, kind, spec,
// state} under ~/.parchment/library/ (src/daemon/library.ts owns the file
// format and slugification, shared with the daemon's HTTP routes for the
// browser's library panel). Users can also drop hand-written spec files there.

const LibraryAction = {
  Save: "save",
  Load: "load",
  List: "list",
} as const;

function textResult(text: string): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text }] };
}

async function saveSlotToLibrary(name: string, slotId: string): Promise<ReturnType<typeof errorText | typeof textResult>> {
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
  const hasState = slot.state !== undefined && Object.keys(slot.state).length > 0;
  const target = writeLibraryEntry({
    name,
    savedAt: Date.now(),
    title: slot.title,
    kind: slot.kind,
    spec: slot.spec,
    ...(hasState ? { state: slot.state } : {}),
  });
  return textResult(`Saved "${slot.title}" to library as ${name} (${target}).`);
}

async function loadSlotFromLibrary(name: string, slotId: string | undefined): Promise<ReturnType<typeof errorText | typeof okText>> {
  const resolvedSessionId = await resolveSessionId();
  const entry = readLibraryEntry(name);
  if (!entry) {
    const available = listLibraryEntryNames().join(", ");
    return errorText(new Error(`no saved UI named "${name}". Available: ${available || "(library is empty)"}`));
  }
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
}

function listLibrary(): ReturnType<typeof textResult> {
  const names = listLibraryEntryNames();
  if (names.length === 0) {
    return textResult("Library is empty.");
  }
  const lines = names.map((name) => {
    const entry = readLibraryEntry(name);
    if (!entry) return `- ${name} — (unreadable)`;
    const saved = new Date(entry.savedAt).toISOString().slice(0, 10);
    return `- ${name} — "${entry.title}" (${entry.kind}, saved ${saved})`;
  });
  return textResult(`Saved UIs:\n${lines.join("\n")}`);
}

server.registerTool(
  "canvas_library",
  {
    title: "Save, Load, or List Saved UIs",
    description:
      "The user's reusable UI library (~/.parchment/library/). action 'save' stores a rendered slot under a name; 'load' re-renders a saved UI onto the canvas; 'list' shows what's saved (starter templates included).",
    inputSchema: z.object({
      action: z.enum([LibraryAction.Save, LibraryAction.Load, LibraryAction.List]),
      name: z.string().optional().describe("Library name (save/load). Lowercased and slugified."),
      slotId: z.string().optional().describe("save: slot to store. load: slot to replace instead of allocating a new one."),
    }),
  },
  async ({ action, name, slotId }) => {
    try {
      if (action === LibraryAction.Save) {
        if (!name || !slotId) {
          return errorText(new Error("action 'save' requires both `name` and `slotId`."));
        }
        return await saveSlotToLibrary(name, slotId);
      }
      if (action === LibraryAction.Load) {
        if (!name) {
          return errorText(new Error("action 'load' requires `name`."));
        }
        return await loadSlotFromLibrary(name, slotId);
      }
      return listLibrary();
    } catch (caught) {
      return errorText(caught);
    }
  },
);

server.registerTool(
  "canvas_close",
  {
    title: "Close a Canvas Slot",
    description: "Remove a slot from the canvas when it's no longer relevant.",
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
