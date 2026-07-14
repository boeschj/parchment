import { SlotKind, SlotOrigin, type JsonRenderSpec, type Slot } from "../../shared/types.ts";
import type { McpAppSlotProps } from "../../shared/mcp-apps.ts";
import { upsertSlot } from "../slots.ts";
import {
  extractEmbeddedUiResource,
  resourceContentsToAppUi,
  resultTextSummary,
  uiResourceUriFromToolMeta,
  cspFromResourceMeta,
  type BridgeCall,
  type ExtractedAppUi,
} from "./bridge.ts";
import { listAppServerNames, resolveAppServer, saveAppServer } from "./config.ts";
import {
  callAppTool,
  getAppConnection,
  listAppPrompts,
  listAppResources,
  listAppResourceTemplates,
  listAppTools,
  readAppResource,
} from "./connections.ts";
import { recordAppSlotGrant, type AppSlotGrant } from "./grants.ts";
import { appVisibleToolNames } from "./visibility.ts";
import { AppBridgeMethod } from "../../shared/mcp-apps.ts";
import type { ListToolsResult } from "@modelcontextprotocol/sdk/types.js";

export type OpenAppInput = {
  sessionId: string;
  cwd: string;
  server: string;
  // Raw config to register under `server` first; saveAppServer's schema is
  // the validator, so boundaries can pass untyped JSON through.
  register?: unknown;
  tool?: string;
  toolArgs?: Record<string, unknown>;
  resource?: string;
  title?: string;
  slotId?: string;
};

export type OpenAppOutcome = {
  slot: Slot;
  resourceUri: string;
  summary: string;
  // The tools this app's UI may call back — surfaced to the agent so a server
  // that forgot to declare visibility is diagnosable without reading the log.
  appVisibleTools: readonly string[];
};

export async function openAppInSlot(input: OpenAppInput): Promise<OpenAppOutcome> {
  if (!input.tool && !input.resource) {
    throw new Error("openApp requires a tool to call or a ui:// resource to open");
  }

  if (input.register !== undefined) {
    saveAppServer(input.server, input.register);
  }

  const config = resolveAppServer(input.server);
  if (!config) {
    const known = listAppServerNames();
    const hint = known.length > 0 ? `Configured servers: ${known.join(", ")}` : "No servers configured yet";
    throw new Error(
      `unknown app server "${input.server}". ${hint}. Add it to ~/.parchment/apps.json or pass a command/url to register it.`,
    );
  }

  const connection = await getAppConnection(input.server, config);

  // The server's tool declarations are read ONCE, here, and become the slot's
  // allowlist. Note the tool the agent calls to open the app needs no "app"
  // visibility — the agent is calling it, not the iframe.
  const tools = await listAppTools(connection);
  const appVisibleTools = appVisibleToolNames(tools.tools);

  const opened = input.tool
    ? await openViaTool(connection, tools, input.tool, input.toolArgs ?? {})
    : await openViaResource(connection, input.resource as string);

  const props: McpAppSlotProps = {
    server: input.server,
    resourceUri: opened.ui.resourceUri,
    mimeType: opened.ui.mimeType,
    html: opened.ui.html,
    ...(opened.ui.csp !== undefined ? { csp: opened.ui.csp } : {}),
    ...(input.tool !== undefined ? { toolName: input.tool } : {}),
    ...(input.toolArgs !== undefined ? { toolInput: input.toolArgs } : {}),
    ...(opened.toolResult !== undefined ? { toolResult: opened.toolResult } : {}),
  };

  const slot = upsertSlot({
    sessionId: input.sessionId,
    cwd: input.cwd,
    kind: SlotKind.App,
    title: input.title ?? input.tool ?? opened.ui.resourceUri,
    spec: mcpAppSpec(props),
    origin: SlotOrigin.McpTool,
    ...(input.slotId !== undefined ? { slotId: input.slotId } : {}),
  });

  const grant = recordAppSlotGrant({
    sessionId: input.sessionId,
    slotId: slot.id,
    server: input.server,
    appVisibleTools,
  });

  return {
    slot,
    resourceUri: opened.ui.resourceUri,
    summary: opened.summary,
    appVisibleTools: grant.appVisibleTools,
  };
}

// Forward one already-authorized bridge call from an app iframe to its app
// server. SECURITY: callers must only pass calls that came through
// validateBridgeCall (which method) AND authorizeBridgeCall against this same
// grant (which tool). The server is the grant's, never the request's.
export async function executeBridgeCall(grant: AppSlotGrant, call: BridgeCall): Promise<unknown> {
  const config = resolveAppServer(grant.server);
  if (!config) {
    throw new Error(`unknown app server "${grant.server}"`);
  }
  const connection = await getAppConnection(grant.server, config);

  switch (call.method) {
    case AppBridgeMethod.CallTool:
      return callAppTool(connection, call.params.name, call.params.arguments ?? {});
    case AppBridgeMethod.ReadResource:
      return readAppResource(connection, call.params.uri);
    case AppBridgeMethod.ListResources:
      return listAppResources(connection, call.params.cursor);
    case AppBridgeMethod.ListResourceTemplates:
      return listAppResourceTemplates(connection, call.params.cursor);
    case AppBridgeMethod.ListPrompts:
      return listAppPrompts(connection, call.params.cursor);
  }
}

type OpenedAppUi = {
  ui: ExtractedAppUi;
  summary: string;
  toolResult?: unknown;
};

async function openViaTool(
  connection: Awaited<ReturnType<typeof getAppConnection>>,
  tools: ListToolsResult,
  toolName: string,
  toolArgs: Record<string, unknown>,
): Promise<OpenedAppUi> {
  const tool = tools.tools.find((candidate) => candidate.name === toolName);
  if (!tool) {
    const available = tools.tools.map((candidate) => candidate.name).join(", ");
    throw new Error(`app server has no tool "${toolName}". Available: ${available || "(none)"}`);
  }

  const result = await callAppTool(connection, toolName, toolArgs);
  const summary = resultTextSummary(result.content) || `Called ${toolName}.`;

  const embedded = extractEmbeddedUiResource(result.content);
  if (embedded) {
    return { ui: embedded, summary, toolResult: result };
  }

  const metaUri = uiResourceUriFromToolMeta(tool._meta) ?? uiResourceUriFromToolMeta(result._meta);
  if (!metaUri) {
    throw new Error(
      `tool "${toolName}" returned no UI: no embedded ui:// resource in the result and no ui/resourceUri in tool metadata. Result text:\n${summary}`,
    );
  }
  const ui = await readUiResource(connection, metaUri);
  return { ui, summary, toolResult: result };
}

async function openViaResource(
  connection: Awaited<ReturnType<typeof getAppConnection>>,
  resourceUri: string,
): Promise<OpenedAppUi> {
  const ui = await readUiResource(connection, resourceUri);
  return { ui, summary: `Opened app resource ${resourceUri}.` };
}

async function readUiResource(
  connection: Awaited<ReturnType<typeof getAppConnection>>,
  uri: string,
): Promise<ExtractedAppUi> {
  const result = await readAppResource(connection, uri);
  const firstContents = result.contents[0];
  if (!firstContents) {
    throw new Error(`resource ${uri} has no contents`);
  }
  const ui = resourceContentsToAppUi(firstContents);
  if (!ui) {
    throw new Error(
      `resource ${uri} is not a renderable app UI (mimeType: ${String(firstContents.mimeType)})`,
    );
  }
  const resultCsp = cspFromResourceMeta(result._meta);
  if (ui.csp === undefined && resultCsp !== undefined) {
    return { ...ui, csp: resultCsp };
  }
  return ui;
}

const APP_ELEMENT_KEY = "app";

function mcpAppSpec(props: McpAppSlotProps): JsonRenderSpec {
  return {
    root: APP_ELEMENT_KEY,
    elements: {
      [APP_ELEMENT_KEY]: { type: "McpApp", props, children: [] },
    },
  };
}
