import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  CallToolResult,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ListPromptsResult,
  ListToolsResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import { AppResourceMimeType, MCP_UI_EXTENSION_ID } from "../../shared/mcp-apps.ts";
import { buildStdioEnv, isStdioAppServer, type AppServerConfig } from "./config.ts";

const HOST_INFO = { name: "parchment", version: "0.2.0" } as const;

type AppConnection = {
  serverName: string;
  client: Client;
};

const connections = new Map<string, AppConnection>();

export async function getAppConnection(
  serverName: string,
  config: AppServerConfig,
): Promise<AppConnection> {
  const existing = connections.get(serverName);
  if (existing) return existing;

  const client = new Client(HOST_INFO, {
    // Advertise SEP-1865 host support so servers register their UI tools.
    capabilities: {
      extensions: {
        [MCP_UI_EXTENSION_ID]: { mimeTypes: [AppResourceMimeType.McpApp] },
      },
    },
  });
  client.onclose = () => connections.delete(serverName);

  const transport = createTransport(config);
  await client.connect(transport);

  const connection: AppConnection = { serverName, client };
  connections.set(serverName, connection);
  return connection;
}

function createTransport(config: AppServerConfig): Transport {
  if (isStdioAppServer(config)) {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: buildStdioEnv(config),
      stderr: "ignore",
    });
  }
  return delegateTransport(new StreamableHTTPClientTransport(new URL(config.url)));
}

// StreamableHTTPClientTransport declares `sessionId: string | undefined`,
// which this repo's exactOptionalPropertyTypes rejects against Transport's
// optional `sessionId?: string`. This thin delegate satisfies the Transport
// contract without a cast: the Client assigns its handlers onto the delegate,
// and the inner transport's events forward to whatever was assigned.
function delegateTransport(inner: StreamableHTTPClientTransport): Transport {
  const adapted: Transport = {
    start: () => inner.start(),
    send: (message, options) => inner.send(message, options),
    close: () => inner.close(),
    setProtocolVersion: (version: string) => inner.setProtocolVersion(version),
  };
  inner.onclose = () => adapted.onclose?.();
  inner.onerror = (error) => adapted.onerror?.(error);
  inner.onmessage = (message) => adapted.onmessage?.(message);
  return adapted;
}

export async function closeAppConnection(serverName: string): Promise<void> {
  const connection = connections.get(serverName);
  if (!connection) return;
  connections.delete(serverName);
  await connection.client.close();
}

export async function closeAllAppConnections(): Promise<void> {
  const names = Array.from(connections.keys());
  await Promise.allSettled(names.map(closeAppConnection));
}

// Thin typed forwarders. A transport error evicts the cached connection so
// the next call reconnects instead of hitting a dead pipe forever.

export async function callAppTool(
  connection: AppConnection,
  toolName: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  return withEviction(connection, () =>
    connection.client.callTool({ name: toolName, arguments: args }),
  ) as Promise<CallToolResult>;
}

export async function readAppResource(
  connection: AppConnection,
  uri: string,
): Promise<ReadResourceResult> {
  return withEviction(connection, () => connection.client.readResource({ uri }));
}

export async function listAppTools(connection: AppConnection): Promise<ListToolsResult> {
  return withEviction(connection, () => connection.client.listTools());
}

export async function listAppResources(
  connection: AppConnection,
  cursor?: string,
): Promise<ListResourcesResult> {
  return withEviction(connection, () =>
    connection.client.listResources(cursor !== undefined ? { cursor } : {}),
  );
}

export async function listAppResourceTemplates(
  connection: AppConnection,
  cursor?: string,
): Promise<ListResourceTemplatesResult> {
  return withEviction(connection, () =>
    connection.client.listResourceTemplates(cursor !== undefined ? { cursor } : {}),
  );
}

export async function listAppPrompts(
  connection: AppConnection,
  cursor?: string,
): Promise<ListPromptsResult> {
  return withEviction(connection, () =>
    connection.client.listPrompts(cursor !== undefined ? { cursor } : {}),
  );
}

async function withEviction<T>(connection: AppConnection, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (caught) {
    connections.delete(connection.serverName);
    throw caught;
  }
}
