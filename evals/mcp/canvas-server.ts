#!/usr/bin/env bun
// The eval's canvas MCP server: the daemon parchment WILL have, stood up in
// evals/ so the eval does not have to merge two unfinished branches into main
// tonight.
//
// WHAT IS "PREVIEWED" HERE vs WHAT IS STOCK — read this before trusting a number
// this server produced:
//
//   PREVIEWED (the two unmerged features the eval exists to measure):
//     1. `markup` — canvas_render accepts a markup document, not only a JSON
//        spec. Lives on the unmerged markup branch (vendored at evals/vendor).
//     2. Reference tags — <GitDiff>, <LogStream>, DataTable src=, CodeBlock
//        file=/lines= are hydrated from disk at push time. Lives on the unmerged
//        hydration branch (stubbed at evals/hydration).
//   Those two, and NOTHING else, are what this server adds.
//
//   STOCK, REIMPLEMENTED FAITHFULLY (the eval must not flatter us):
//     - Validation is the PRODUCT's own prepareSpec, unchanged. A genuinely
//       invalid spec is REJECTED here exactly as it is in production.
//     - The rejection text is the product's, word for word, including
//       "Fix these exact issues and re-push with the same slotId."
//     - The push is the same POST /api/sessions/<id>/slots the real MCP server
//       makes, against a daemon on a scratch HOME.
//     - The tool is named canvas_render under server key "canvas", so the model
//       sees `mcp__canvas__canvas_render` — the real tool's name.
//
// A LOOSER VALIDATOR HERE WOULD BE A RIGGED BENCHMARK. If a parchment arm
// authors a genuinely broken spec, it must fail, and it must fail with the same
// message a real user would get — no friendlier hint, and no hint an HTML arm
// would not also get from its own toolchain.

import { homedir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { prepareSpec } from "../../src/daemon/spec-validation.ts";
import { SlotKind, SlotOrigin, type JsonRenderSpec } from "../../src/shared/types.ts";
import { hydrateSpec } from "../hydration/resolvers.ts";
import {
  artifactFormatOf,
  decodeAuthoredDocument,
  vocabularyForArm,
} from "../render/materialize.ts";
import { ArmId } from "../types.ts";
import {
  CANVAS_MCP_SERVER_KEY,
  CANVAS_RENDER_TOOL_NAME,
  EvalMcpEnv,
  readEvalDaemonEndpoint,
} from "./config.ts";

const SERVER_NAME = "parchment";
const SERVER_VERSION = "0.1.0";
const TOKEN_HEADER = "x-canvas-token";
const DEFAULT_SESSION_ID = "default";
const PUSH_TIMEOUT_MS = 20_000;

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

export type RenderableSpec = { spec: JsonRenderSpec | null; issues: string[] };

export type AuthoredDocument = {
  armId: ArmId;
  markup?: string | undefined;
  spec?: unknown;
};

// compile/unscramble/expand → hydrate → VALIDATE. Every step's complaints are the
// arm's own toolchain speaking; none of them is invented here.
export function buildRenderableSpec(document: AuthoredDocument): RenderableSpec {
  const source = authoredSourceOf(document);
  if (source.issues.length > 0) return { spec: null, issues: source.issues };
  if (source.text === null) return { spec: null, issues: [MISSING_DOCUMENT_ISSUE] };

  const format = artifactFormatOf(document.armId);
  const vocabulary = vocabularyForArm(document.armId);

  const decoded = decodeAuthoredDocument(format, source.text, vocabulary);
  if (decoded.spec === null) return { spec: null, issues: decoded.issues };

  const hydrated = hydrateSpec(decoded.spec);
  const authoringIssues = [...decoded.issues, ...hydrated.issues];
  if (authoringIssues.length > 0) return { spec: null, issues: authoringIssues };

  // The product's own validator, unchanged. This is the line that keeps the eval
  // honest: a spec production would reject is rejected here too.
  const validated = prepareSpec(hydrated.spec);
  if (validated.issues.length > 0) return { spec: null, issues: validated.issues };

  return { spec: validated.spec, issues: [] };
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

// ---- The push -----------------------------------------------------------------

export type PushSlotInput = {
  baseUrl: string;
  token: string;
  sessionId: string;
  cwd: string;
  kind: SlotKind;
  title: string;
  spec: JsonRenderSpec;
  slotId?: string | undefined;
};

export async function pushSlotToDaemon(input: PushSlotInput): Promise<string> {
  const response = await fetch(
    `${input.baseUrl}/api/sessions/${encodeURIComponent(input.sessionId)}/slots`,
    {
      method: "POST",
      headers: { "content-type": "application/json", [TOKEN_HEADER]: input.token },
      body: JSON.stringify({
        kind: input.kind,
        title: input.title,
        cwd: input.cwd,
        spec: input.spec,
        origin: SlotOrigin.McpTool,
        ...(input.slotId === undefined ? {} : { slotId: input.slotId }),
      }),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`the canvas daemon refused the slot (${response.status}): ${detail}`);
  }

  const payload = (await response.json()) as { slot?: { id?: string } };
  return payload.slot?.id ?? "unknown";
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
        const renderable = buildRenderableSpec({ armId, markup, spec });
        if (renderable.spec === null) return rejectionReply(renderable.issues);

        const endpoint = readEvalDaemonEndpoint(homedir());
        const pushedSlotId = await pushSlotToDaemon({
          baseUrl: endpoint.baseUrl,
          token: endpoint.token,
          sessionId,
          cwd,
          kind: kind ?? SlotKind.Render,
          title,
          spec: renderable.spec,
          slotId,
        });

        return okReply(pushedSlotId, sessionId, endpoint.baseUrl);
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
