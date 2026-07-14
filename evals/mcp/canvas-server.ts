#!/usr/bin/env bun
// The eval's canvas MCP server: a THIN WRAPPER over the shipped canvas_render,
// and nothing more.
//
// It used to be a reimplementation. The markup compiler and the reference
// hydrator were unmerged branches when the eval was written, so this server drove
// a vendored copy of one and a stub of the other. Both merged (b12803c, 43e3ed2)
// and the copies stayed — which meant the benchmark was measuring a mirror of the
// product, not the product. Every number it produced was, strictly, about code
// nobody ships. That is fixed here: this file now runs the SAME pipeline as
// src/daemon/mcp-stdio.ts, line for line —
//
//     compileMarkup  →  prepareSpec  →  POST /slots
//                                        (the daemon hydrates the references)
//
// WHY THE WRAPPER STILL EXISTS, given it forks nothing:
//   1. It talks to a SCRATCH daemon (evals/daemon.ts, HOME=scratch, port 7830+),
//      so an eval run can never write a slot into the operator's real canvas.
//   2. It exposes canvas_render and NOTHING else. A model handed canvas_snapshot
//      or canvas_patch would burn turns on tools the comparison does not control
//      for; every arm must get exactly the tools its authoring surface needs.
//   3. It knows which AUTHORING NOTATION the document will arrive in. A scrambled
//      arm writes <C22 a1=…>; a terse arm writes {"r":…,"e":…}. Turning those back
//      into the product's dialect is the eval's job and no one else's — and it
//      happens BEFORE the product's own path, never inside it.
//
// A LOOSER VALIDATOR HERE WOULD BE A RIGGED BENCHMARK. It is not looser: it is
// prepareSpec, unchanged, and the rejection text is the product's, word for word.

import { homedir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { SlotKind } from "../../src/shared/types.ts";
import {
  artifactFormatOf,
  buildRenderableSpec,
  vocabularyForArm,
  type RenderableSpec,
} from "../render/materialize.ts";
import { pushSpecToDaemon } from "../render/canvas-push.ts";
import { ArmId } from "../types.ts";
import {
  CANVAS_MCP_SERVER_KEY,
  CANVAS_RENDER_TOOL_NAME,
  EvalMcpEnv,
  readEvalDaemonEndpoint,
} from "./config.ts";

const SERVER_NAME = "parchment";
const SERVER_VERSION = "0.1.0";
const DEFAULT_SESSION_ID = "default";

// ---- The tool's input schema -------------------------------------------------
//
// Kept as close to the stock canvas_render schema as possible. The schema is
// INPUT TOKENS that every canvas arm pays on every turn, so an inflated schema
// here would show up as an input-token difference that has nothing to do with
// the format under test.

const SpecElementSchema = z.object({
  type: z.string(),
  props: z.record(z.string(), z.unknown()).default({}),
  children: z.array(z.string()).optional(),
  visible: z.unknown().optional(),
  on: z.record(z.string(), z.unknown()).optional(),
  repeat: z.object({ statePath: z.string(), key: z.string().optional() }).optional(),
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

const CanvasRenderInputSchema = z.object({
  title: z.string().describe("Slot title shown in the tab strip."),
  kind: z
    .enum([SlotKind.Render, SlotKind.Dashboard, SlotKind.Report])
    .optional()
    .describe("'dashboard' for metrics/charts, 'report' for long-form prose, else 'render' (default)."),
  spec: SpecInputSchema.optional(),
  markup: z
    .string()
    .optional()
    .describe("Markup document. Provide this OR spec, not both."),
  slotId: z.string().optional().describe("Existing slot id to replace, else a new slot."),
});

const CANVAS_RENDER_DESCRIPTION =
  "DEFAULT tool for rich content — charts, tables, diagrams, forms, documents, dashboards — composed from a 52-component catalog. Specs carry `state`, $state/$bindState/$template expressions, repeat lists, and `on` event bindings (interactive forms). Invalid specs return a precise issue list — fix and re-push with the same slotId. Composition and grammar: the canvas-tools and canvas-spec skills.";

// ---- The authoring pipeline ---------------------------------------------------

export type AuthoredDocument = {
  armId: ArmId;
  markup?: string | undefined;
  spec?: unknown;
};

// decode (the eval's ONLY step) → compile → VALIDATE. Every complaint after the
// first line is the product's own; none of them is invented here.
export function renderableSpecOf(document: AuthoredDocument): RenderableSpec {
  const source = authoredSourceOf(document);
  if (source.issues.length > 0) return { spec: null, issues: source.issues };
  if (source.text === null) return { spec: null, issues: [MISSING_DOCUMENT_ISSUE] };

  return buildRenderableSpec(
    artifactFormatOf(document.armId),
    source.text,
    vocabularyForArm(document.armId),
  );
}

const MISSING_DOCUMENT_ISSUE =
  'neither "markup" nor "spec" was provided. Pass exactly one of them.';
const AMBIGUOUS_DOCUMENT_ISSUE =
  'both "markup" and "spec" were provided. Pass exactly one of them.';

type AuthoredSource = { text: string | null; issues: string[] };

function authoredSourceOf(document: AuthoredDocument): AuthoredSource {
  const hasMarkup = typeof document.markup === "string" && document.markup.trim().length > 0;
  const hasSpec = document.spec !== undefined && document.spec !== null;

  if (hasMarkup && hasSpec) return { text: null, issues: [AMBIGUOUS_DOCUMENT_ISSUE] };
  if (hasMarkup) return { text: document.markup ?? null, issues: [] };
  if (hasSpec) return { text: JSON.stringify(document.spec), issues: [] };

  return { text: null, issues: [MISSING_DOCUMENT_ISSUE] };
}

// The product's rejection, word for word (src/daemon/mcp-stdio.ts specRejection).
// Every arm gets its own toolchain's complaints in its own toolchain's voice; the
// harness adds nothing.
export function formatSpecRejection(issues: readonly string[]): string {
  const plural = issues.length === 1 ? "" : "s";
  const bulleted = issues.map((issue) => `- ${issue}`).join("\n");
  return (
    `spec rejected (${issues.length} issue${plural}):\n${bulleted}\n` +
    `Fix these exact issues and re-push with the same slotId.`
  );
}

// ---- The server ----------------------------------------------------------------

type ToolReply = {
  content: [{ type: "text"; text: string }];
  isError?: true;
};

function okReply(slotId: string, sessionId: string, baseUrl: string): ToolReply {
  const canvasUrl = `${baseUrl}/?session=${encodeURIComponent(sessionId)}`;
  return {
    content: [{ type: "text", text: `Rendered to canvas slot ${slotId}. View: ${canvasUrl}` }],
  };
}

function rejectionReply(issues: readonly string[]): ToolReply {
  return { content: [{ type: "text", text: formatSpecRejection(issues) }], isError: true };
}

function errorReply(caught: unknown): ToolReply {
  const message = caught instanceof Error ? caught.message : String(caught);
  return { content: [{ type: "text", text: `canvas error: ${message}` }], isError: true };
}

function resolveArmId(): ArmId {
  const configured = process.env[EvalMcpEnv.ArmId];
  const armIds: readonly string[] = Object.values(ArmId);

  if (configured !== undefined && armIds.includes(configured)) {
    // The env value is one of the ArmId members; find it rather than cast.
    const armId = Object.values(ArmId).find((candidate) => candidate === configured);
    if (armId !== undefined) return armId;
  }

  throw new Error(
    `${EvalMcpEnv.ArmId} must name one of: ${armIds.join(", ")} — the server cannot decode a ` +
      `document without knowing which authoring vocabulary it is written in.`,
  );
}

export function startCanvasServer(): void {
  const armId = resolveArmId();
  const sessionId = process.env[EvalMcpEnv.SessionId] ?? DEFAULT_SESSION_ID;
  // The run's working directory: where the fixtures were copied, and therefore
  // the root the daemon resolves this spec's references against. Exactly what
  // src/daemon/mcp-stdio.ts sends.
  const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    CANVAS_RENDER_TOOL_NAME,
    {
      title: "Compose a Generative UI",
      description: CANVAS_RENDER_DESCRIPTION,
      inputSchema: CanvasRenderInputSchema,
    },
    async ({ title, kind, spec, markup, slotId }) => {
      try {
        const renderable = renderableSpecOf({ armId, markup, spec });
        if (renderable.spec === null) return rejectionReply(renderable.issues);

        const endpoint = readEvalDaemonEndpoint(homedir());
        const pushed = await pushSpecToDaemon({
          baseUrl: endpoint.baseUrl,
          token: endpoint.token,
          sessionId,
          cwd,
          kind: kind ?? SlotKind.Render,
          title,
          spec: renderable.spec,
          slotId,
        });

        // A reference the daemon could not resolve is a rejection, not a crash —
        // and it comes back in the product's own words, so the model repairs it
        // exactly as a real user's model would.
        if (!pushed.ok) return rejectionReply(pushed.issues);

        return okReply(pushed.slotId, sessionId, endpoint.baseUrl);
      } catch (caught) {
        return errorReply(caught);
      }
    },
  );

  void server.connect(new StdioServerTransport());
}

// Importing this module (the tests, the schema-size probe) must not open a stdio
// transport and hang.
if (import.meta.main) startCanvasServer();

export { CANVAS_MCP_SERVER_KEY, CANVAS_RENDER_DESCRIPTION, CanvasRenderInputSchema };
