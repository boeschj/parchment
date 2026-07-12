// MCP Apps (SEP-1865) protocol vocabulary shared by the daemon host bridge
// and the browser slot surface. Spec: extension io.modelcontextprotocol/ui,
// version 2026-01-26.

export const MCP_UI_EXTENSION_ID = "io.modelcontextprotocol/ui";

export const AppResourceMimeType = {
  McpApp: "text/html;profile=mcp-app",
  PlainHtml: "text/html",
  // OpenAI Apps SDK widget marker. Rendered as plain HTML — parchment does
  // not implement the window.openai in-iframe API, so skybridge widgets that
  // require it before first paint will degrade.
  OpenAiSkybridge: "text/html+skybridge",
  // mcp-ui externalUrl resources: the resource text is a URL the host frames.
  ExternalUrlList: "text/uri-list",
} as const;

export type AppResourceMimeType =
  (typeof AppResourceMimeType)[keyof typeof AppResourceMimeType];

export const SUPPORTED_APP_MIME_TYPES = Object.values(AppResourceMimeType);

export const UI_RESOURCE_URI_SCHEME = "ui://";

// _meta.ui.csp domain declarations (SEP-1865). The sandbox page builds a
// deny-by-default Content-Security-Policy from these; undeclared domains are
// blocked, as the spec requires of hosts.
export type AppResourceCsp = {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
};

// JSON-RPC methods the browser is allowed to relay from an app iframe to the
// app's MCP server, via the daemon. SECURITY: this whitelist is the entire
// iframe -> app-server surface; anything else (sampling, elicitation,
// arbitrary methods) is rejected at both the browser and the daemon.
export const AppBridgeMethod = {
  CallTool: "tools/call",
  ReadResource: "resources/read",
  ListResources: "resources/list",
  ListResourceTemplates: "resources/templates/list",
  ListPrompts: "prompts/list",
} as const;

export type AppBridgeMethod =
  (typeof AppBridgeMethod)[keyof typeof AppBridgeMethod];

// Props of the McpApp slot element the daemon composes and the browser
// renders. `html` is the fetched ui:// resource content; the browser never
// fetches app HTML itself.
export type McpAppSlotProps = {
  server: string;
  resourceUri: string;
  mimeType: string;
  html: string;
  csp?: AppResourceCsp;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
};
