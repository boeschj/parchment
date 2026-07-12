import * as z from "zod/v4";

const AppResourceCspSchema = z.object({
  connectDomains: z.array(z.string()).optional(),
  resourceDomains: z.array(z.string()).optional(),
  frameDomains: z.array(z.string()).optional(),
  baseUriDomains: z.array(z.string()).optional(),
});

export const McpAppPropsSchema = z.object({
  server: z.string().describe("App server name from ~/.parchment/apps.json — bridge calls route here."),
  resourceUri: z.string().describe("The ui:// resource this view renders."),
  mimeType: z.string().describe("Resource MIME type (text/html;profile=mcp-app and variants)."),
  html: z.string().describe("The fetched resource HTML. Rendered inside the double-iframe sandbox."),
  csp: AppResourceCspSchema.optional().describe("Domain allowlists declared by the resource's _meta.ui.csp."),
  toolName: z.string().optional().describe("Tool whose call produced this view."),
  toolInput: z.record(z.string(), z.unknown()).optional().describe("Arguments the tool was called with."),
  toolResult: z.unknown().optional().describe("The CallToolResult delivered to the app after it initializes."),
});

// SECURITY: deliberately NOT part of CanvasExtensionDefinitions. Only the
// daemon's canvas_app path may mint McpApp elements (from a fetched ui://
// resource); a canvas_render spec that names this component is rejected by
// the catalog validator, so composed specs can never smuggle arbitrary HTML
// into an app iframe. The browser registry registers it directly.
export const McpAppDefinition = {
  props: McpAppPropsSchema,
  slots: [],
  events: [],
  description:
    "An MCP app UI (SEP-1865) rendered in a sandboxed iframe. Daemon-composed via canvas_app only.",
  example: {
    server: "hello-app",
    resourceUri: "ui://hello-app/board",
    mimeType: "text/html;profile=mcp-app",
    html: "<!doctype html><html><body>app</body></html>",
  },
};
