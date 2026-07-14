// Which of an app server's tools its UI iframe is allowed to call.
//
// MCP Apps / SEP-1865, "Resource Discovery" → "Visibility" (spec version
// 2026-01-26). A server declares the audience of each tool in its metadata:
//
//   { "name": "add_task", "_meta": { "ui": { "visibility": ["model", "app"] } } }
//
//   "model" — the agent may call it.
//   "app"   — the app's UI may call it, "from the same server connection only".
//
// The host obligation the spec states outright:
//   "tools/call behavior: Host MUST reject tools/call requests from apps for
//    tools that don't include "app" in visibility"
//
// DELIBERATE DEVIATION — parchment denies by default. The spec says
// `visibility` "defaults to ["model", "app"] if omitted", i.e. a server that
// declares nothing exposes EVERY tool to its iframe. That default is safe only
// under the spec's assumption that a server's UI is as trusted as the server.
// parchment does not make that assumption: the iframe is untrusted content
// (prompt-injected HTML, a compromised template, a supply-chained dependency),
// so an omitted declaration reads as "the server never thought about this" —
// and the answer to that is no, not all of them. A server that declares nothing
// gets nothing, and the rejection says so. See docs/security.md.

import * as z from "zod/v4";

export const AppToolAudience = {
  Model: "model",
  App: "app",
} as const;

export type AppToolAudience = (typeof AppToolAudience)[keyof typeof AppToolAudience];

// Lenient in what it accepts (a future spec may add audiences), strict in what
// it decides: only the literal "app" grants iframe access.
const ToolVisibilityMetaSchema = z.object({
  ui: z
    .object({
      visibility: z.array(z.string()).optional(),
    })
    .optional(),
});

type DeclaredTool = {
  name: string;
  _meta?: unknown;
};

export function isAppVisibleTool(tool: DeclaredTool): boolean {
  const parsed = ToolVisibilityMetaSchema.safeParse(tool._meta ?? {});
  if (!parsed.success) return false;
  const visibility = parsed.data.ui?.visibility;
  if (visibility === undefined) return false;
  return visibility.includes(AppToolAudience.App);
}

export function appVisibleToolNames(tools: readonly DeclaredTool[]): string[] {
  return tools.filter(isAppVisibleTool).map((tool) => tool.name);
}
