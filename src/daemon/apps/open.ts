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
import { AppBridgeMethod } from "../../shared/mcp-apps.ts";

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

  const opened = input.tool
    ? await openViaTool(connection, input.tool, input.toolArgs ?? {})
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

  return { slot, resourceUri: opened.ui.resourceUri, summary: opened.summary };
}

// Forward one already-validated bridge call from an app iframe to its app
// server. SECURITY: callers must only pass calls that came through
// validateBridgeCall — the method set here mirrors that whitelist exactly.
export async function executeBridgeCall(serverName: string, call: BridgeCall): Promise<unknown> {
  const config = resolveAppServer(serverName);
  if (!config) {
    throw new Error(`unknown app server "${serverName}"`);
  }
  const connection = await getAppConnection(serverName, config);

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
  toolName: string,
  toolArgs: Record<string, unknown>,
): Promise<OpenedAppUi> {
  const tools = await listAppTools(connection);
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
