import * as z from "zod/v4";
import {
  AppBridgeMethod,
  AppResourceMimeType,
  SUPPORTED_APP_MIME_TYPES,
  UI_RESOURCE_URI_SCHEME,
  type AppResourceCsp,
} from "../../shared/mcp-apps.ts";

// ---------------------------------------------------------------------------
// Bridge call validation.
//
// SECURITY: this schema IS the whitelist of JSON-RPC methods an app iframe
// may relay to its app server. Discriminating on the method literal means an
// unknown method never reaches a connection — it fails parsing here.
// ---------------------------------------------------------------------------

const CallToolBridgeSchema = z.strictObject({
  method: z.literal(AppBridgeMethod.CallTool),
  params: z.strictObject({
    name: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()).optional(),
    // Progress tokens etc. are host concerns; _meta from an iframe is dropped.
  }),
});

const ReadResourceBridgeSchema = z.strictObject({
  method: z.literal(AppBridgeMethod.ReadResource),
  params: z.strictObject({ uri: z.string().min(1) }),
});

const CursorParamsSchema = z.strictObject({ cursor: z.string().optional() });

const ListResourcesBridgeSchema = z.strictObject({
  method: z.literal(AppBridgeMethod.ListResources),
  params: CursorParamsSchema.default({}),
});

const ListResourceTemplatesBridgeSchema = z.strictObject({
  method: z.literal(AppBridgeMethod.ListResourceTemplates),
  params: CursorParamsSchema.default({}),
});

const ListPromptsBridgeSchema = z.strictObject({
  method: z.literal(AppBridgeMethod.ListPrompts),
  params: CursorParamsSchema.default({}),
});

const BridgeCallSchema = z.discriminatedUnion("method", [
  CallToolBridgeSchema,
  ReadResourceBridgeSchema,
  ListResourcesBridgeSchema,
  ListResourceTemplatesBridgeSchema,
  ListPromptsBridgeSchema,
]);

export type BridgeCall = z.infer<typeof BridgeCallSchema>;

export type BridgeCallValidation =
  | { ok: true; call: BridgeCall }
  | { ok: false; error: string };

export function validateBridgeCall(body: unknown): BridgeCallValidation {
  const parsed = BridgeCallSchema.safeParse(body);
  if (parsed.success) return { ok: true, call: parsed.data };

  const method = extractMethodForError(body);
  if (method !== null && !isWhitelistedMethod(method)) {
    return {
      ok: false,
      error: `method "${method}" is not allowed across the app bridge. Allowed: ${Object.values(AppBridgeMethod).join(", ")}`,
    };
  }
  const issueLines = parsed.error.issues
    .map((issue) => `${issue.path.join("/") || "(root)"}: ${issue.message}`)
    .join("; ");
  return { ok: false, error: `invalid bridge call: ${issueLines}` };
}

function extractMethodForError(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const method = (body as Record<string, unknown>).method;
  return typeof method === "string" ? method : null;
}

function isWhitelistedMethod(method: string): boolean {
  return Object.values(AppBridgeMethod).some((allowed) => allowed === method);
}

// ---------------------------------------------------------------------------
// App-visibility authorization (SEP-1865, "Resource Discovery" → "Visibility").
//
// SECURITY: validateBridgeCall says WHICH METHOD may cross the bridge. This
// says WHICH TOOL — "Host MUST reject tools/call requests from apps for tools
// that don't include "app" in visibility". The allowlist is the app slot's
// grant, computed from the server's own declarations when the app was opened
// (see grants.ts / visibility.ts); the iframe has no say in it.
//
// The other whitelisted methods need no per-name check: they are all scoped to
// the grant's server connection, and the spec scopes the app's reach by
// connection ("callable by the app from the same server connection only"). It
// declares no per-resource visibility, so resources/read of the app's OWN
// server stays allowed — reaching a SECOND server is what is impossible here,
// because the server is resolved from the slot's grant, not from the request.
// ---------------------------------------------------------------------------

type ToolAllowlist = {
  server: string;
  appVisibleTools: readonly string[];
};

export type BridgeAuthorization = { ok: true } | { ok: false; error: string };

export function authorizeBridgeCall(call: BridgeCall, allowlist: ToolAllowlist): BridgeAuthorization {
  const isToolCall = call.method === AppBridgeMethod.CallTool;
  if (!isToolCall) return { ok: true };

  const toolName = call.params.name;
  if (allowlist.appVisibleTools.includes(toolName)) return { ok: true };

  return { ok: false, error: notVisibleError(toolName, allowlist) };
}

function notVisibleError(toolName: string, allowlist: ToolAllowlist): string {
  const declaresNothing = allowlist.appVisibleTools.length === 0;
  if (declaresNothing) {
    return (
      `app server "${allowlist.server}" declares no app-visible tools, so its UI may not call "${toolName}" — or anything else. ` +
      `Per MCP Apps (SEP-1865), a tool is callable from an app's UI only if the server declares it: ` +
      `_meta.ui.visibility must include "app". parchment denies by default when that declaration is absent — ` +
      `an app that declares nothing gets nothing.`
    );
  }
  return (
    `tool "${toolName}" is not app-visible on server "${allowlist.server}": its _meta.ui.visibility does not include "app" (SEP-1865). ` +
    `Tools this server's UI may call: ${allowlist.appVisibleTools.join(", ")}.`
  );
}

// ---------------------------------------------------------------------------
// UI resource extraction (SEP-1865 + mcp-ui + OpenAI Apps SDK MIME variants).
// ---------------------------------------------------------------------------

export type ExtractedAppUi = {
  resourceUri: string;
  mimeType: string;
  html: string;
  csp?: AppResourceCsp;
};

type ResourceContents = {
  uri?: unknown;
  mimeType?: unknown;
  text?: unknown;
  blob?: unknown;
  _meta?: unknown;
};

export function isSupportedAppMime(mimeType: string): boolean {
  return SUPPORTED_APP_MIME_TYPES.some((supported) => supported === mimeType);
}

// A tool result may carry the UI inline as an embedded resource content
// block (the mcp-ui pattern). Returns the first ui:// block with a
// supported MIME type.
export function extractEmbeddedUiResource(resultContent: unknown): ExtractedAppUi | null {
  if (!Array.isArray(resultContent)) return null;
  for (const block of resultContent) {
    if (!isPlainObject(block)) continue;
    if (block.type !== "resource") continue;
    const resource = block.resource;
    if (!isPlainObject(resource)) continue;
    const extracted = resourceContentsToAppUi(resource);
    if (extracted) return extracted;
  }
  return null;
}

// SEP-1865 links a tool to its UI via tool metadata: _meta["ui/resourceUri"]
// (current) or _meta.ui.resourceUri (earlier drafts).
export function uiResourceUriFromToolMeta(toolMeta: unknown): string | null {
  if (!isPlainObject(toolMeta)) return null;
  const flatUri = toolMeta["ui/resourceUri"];
  if (typeof flatUri === "string" && flatUri.startsWith(UI_RESOURCE_URI_SCHEME)) return flatUri;
  const ui = toolMeta.ui;
  if (!isPlainObject(ui)) return null;
  const nestedUri = ui.resourceUri;
  if (typeof nestedUri === "string" && nestedUri.startsWith(UI_RESOURCE_URI_SCHEME)) {
    return nestedUri;
  }
  return null;
}

export function resourceContentsToAppUi(contents: ResourceContents): ExtractedAppUi | null {
  const uri = typeof contents.uri === "string" ? contents.uri : null;
  const mimeType = typeof contents.mimeType === "string" ? contents.mimeType : null;
  if (uri === null || mimeType === null) return null;
  if (!uri.startsWith(UI_RESOURCE_URI_SCHEME)) return null;
  if (!isSupportedAppMime(mimeType)) return null;

  const rawText = decodeResourceText(contents);
  if (rawText === null) return null;

  const csp = cspFromResourceMeta(contents._meta);
  const isExternalUrl = mimeType === AppResourceMimeType.ExternalUrlList;
  if (isExternalUrl) {
    const externalUrl = firstUriFromList(rawText);
    if (externalUrl === null) return null;
    return {
      resourceUri: uri,
      mimeType,
      html: wrapExternalUrlHtml(externalUrl),
      csp: withFrameDomain(csp, externalUrl),
    };
  }

  return {
    resourceUri: uri,
    mimeType,
    html: rawText,
    ...(csp !== undefined ? { csp } : {}),
  };
}

function decodeResourceText(contents: ResourceContents): string | null {
  if (typeof contents.text === "string") return contents.text;
  if (typeof contents.blob === "string") {
    return Buffer.from(contents.blob, "base64").toString("utf8");
  }
  return null;
}

export function cspFromResourceMeta(meta: unknown): AppResourceCsp | undefined {
  if (!isPlainObject(meta)) return undefined;
  const ui = meta.ui;
  if (!isPlainObject(ui)) return undefined;
  const csp = ui.csp;
  if (!isPlainObject(csp)) return undefined;
  return {
    ...domainListField("connectDomains", csp),
    ...domainListField("resourceDomains", csp),
    ...domainListField("frameDomains", csp),
    ...domainListField("baseUriDomains", csp),
  };
}

function domainListField(
  field: keyof AppResourceCsp,
  csp: Record<string, unknown>,
): Partial<AppResourceCsp> {
  const value = csp[field];
  if (!Array.isArray(value)) return {};
  const domains = value.filter((entry): entry is string => typeof entry === "string");
  return { [field]: domains };
}

// text/uri-list: first non-comment line is the URL to frame.
function firstUriFromList(text: string): string | null {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    if (!/^https?:\/\//.test(trimmed)) return null;
    return trimmed;
  }
  return null;
}

function wrapExternalUrlHtml(url: string): string {
  const escaped = url.replace(/"/g, "&quot;");
  return [
    "<!doctype html>",
    "<html><head><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style></head>",
    `<body><iframe src="${escaped}" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer"></iframe></body></html>`,
  ].join("");
}

function withFrameDomain(csp: AppResourceCsp | undefined, url: string): AppResourceCsp {
  const origin = new URL(url).origin;
  const existing = csp?.frameDomains ?? [];
  return { ...csp, frameDomains: [...existing, origin] };
}

// The text the coding agent gets back from canvas_app: every text content
// block of the tool result, so the agent knows what the app rendered/said.
export function resultTextSummary(resultContent: unknown): string {
  if (!Array.isArray(resultContent)) return "";
  const textParts = resultContent
    .filter(isPlainObject)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string);
  return textParts.join("\n");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
