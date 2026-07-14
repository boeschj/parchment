import { useMemo, useRef, useState } from "react";
import { AppRenderer, type SandboxConfig } from "@mcp-ui/client";
import type { z } from "zod/v4";
import {
  CallToolResultSchema,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  ReadResourceResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { McpAppPropsSchema } from "../../shared/catalog/extensions/McpApp.ts";
import { AppBridgeMethod } from "../../shared/mcp-apps.ts";
import { EditKind } from "../../shared/types.ts";
import { postAppBridgeCall, postEdit } from "../api.ts";
import { useSlotContext } from "../SlotContext.tsx";
import { useTheme } from "../theme.ts";

type McpAppProps = z.infer<typeof McpAppPropsSchema>;
type RenderProps = { props: McpAppProps };

const HOST_INFO = { name: "parchment", version: "0.2.0" } as const;
const MODEL_CONTEXT_ELEMENT_ID = "model-context";
const MESSAGE_ELEMENT_ID = "message";
const INTENT_ELEMENT_ID = "app-intent";
const LOG_ELEMENT_ID = "log";

const UPDATE_MODEL_CONTEXT_METHOD = "ui/update-model-context";
const APP_INTENT_METHOD = "ui/intent";

const ALARMING_LOG_LEVELS = new Set(["error", "critical", "alert", "emergency"]);

// The sandbox proxy loads from the daemon's OTHER loopback name, so the app
// runs cross-origin from the canvas page (SEP-1865 origin split, localhost
// vs 127.0.0.1). Cached because iframe identity must be stable across renders.
let cachedSandboxUrl: URL | null = null;

function sandboxProxyUrl(): URL {
  if (cachedSandboxUrl) return cachedSandboxUrl;
  const otherLoopbackHost = window.location.hostname === "localhost" ? "127.0.0.1" : "localhost";
  cachedSandboxUrl = new URL(`http://${otherLoopbackHost}:${window.location.port}/sandbox.html`);
  return cachedSandboxUrl;
}

export function McpAppView({ props }: RenderProps) {
  const { sessionId, slotId } = useSlotContext();
  const theme = useTheme();
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  // Identity-stable protocol inputs. json-render rebuilds element props on
  // every render, and AppRenderer/AppFrame effects key on prop identity — an
  // unstable toolResult/toolInput would re-deliver stale tool notifications
  // into the running app on every canvas re-render (clobbering its state).
  // Stability must therefore be by VALUE, not by reference.
  const stableRawToolResult = useJsonStableValue(props.toolResult);
  const stableToolInput = useJsonStableValue(props.toolInput);
  const toolResult = useMemo(() => {
    const parsed = CallToolResultSchema.safeParse(stableRawToolResult);
    return parsed.success ? parsed.data : undefined;
  }, [stableRawToolResult]);
  const hostContext = useMemo(() => ({ theme }), [theme]);
  const toolName = props.toolName ?? props.resourceUri;
  const sandboxCsp = toSandboxCsp(props.csp);

  const recordAppEdit = async (
    kind: EditKind,
    elementId: string,
    payload: Record<string, unknown>,
  ): Promise<void> => {
    await postEdit(sessionId, { slotId, elementId, kind, payload });
  };

  return (
    <div
      className="h-full min-h-[480px] flex flex-col bg-card overflow-hidden"
      style={{ borderRadius: "var(--radius)" }}
    >
      {bridgeError ? (
        <p className="m-0 px-4 py-2 text-xs text-destructive bg-destructive/10">{bridgeError}</p>
      ) : null}
      <div className="flex-1 min-h-0">
        <AppRenderer
          toolName={toolName}
          html={props.html}
          sandbox={{
            url: sandboxProxyUrl(),
            ...(sandboxCsp !== undefined ? { csp: sandboxCsp } : {}),
          }}
          hostInfo={HOST_INFO}
          hostContext={hostContext}
          {...(stableToolInput !== undefined ? { toolInput: stableToolInput } : {})}
          {...(toolResult !== undefined ? { toolResult } : {})}
          onCallTool={async (params) =>
            CallToolResultSchema.parse(
              await postAppBridgeCall(sessionId, slotId, {
                method: AppBridgeMethod.CallTool,
                // SECURITY: only name + arguments cross the bridge; anything
                // else the iframe attached (_meta, progress tokens) is dropped.
                params: { name: params.name, ...(params.arguments !== undefined ? { arguments: params.arguments } : {}) },
              }),
            )
          }
          onReadResource={async (params) =>
            ReadResourceResultSchema.parse(
              await postAppBridgeCall(sessionId, slotId, {
                method: AppBridgeMethod.ReadResource,
                params: { uri: params.uri },
              }),
            )
          }
          onListResources={async (params) =>
            ListResourcesResultSchema.parse(
              await postAppBridgeCall(sessionId, slotId, {
                method: AppBridgeMethod.ListResources,
                params: cursorOnly(params),
              }),
            )
          }
          onListResourceTemplates={async (params) =>
            ListResourceTemplatesResultSchema.parse(
              await postAppBridgeCall(sessionId, slotId, {
                method: AppBridgeMethod.ListResourceTemplates,
                params: cursorOnly(params),
              }),
            )
          }
          onListPrompts={async (params) =>
            ListPromptsResultSchema.parse(
              await postAppBridgeCall(sessionId, slotId, {
                method: AppBridgeMethod.ListPrompts,
                params: cursorOnly(params),
              }),
            )
          }
          onMessage={async (params) => {
            await recordAppEdit(EditKind.AppPrompt, MESSAGE_ELEMENT_ID, { ...params });
            return {};
          }}
          onOpenLink={async (params) => {
            openExternalLink(params.url);
            return {};
          }}
          onLoggingMessage={(params) => {
            void forwardAlarmingLog(recordAppEdit, params);
          }}
          onFallbackRequest={async (request) => {
            return handleFallbackRequest(recordAppEdit, request.method, request.params);
          }}
          onError={(error) => setBridgeError(error.message)}
        />
      </div>
    </div>
  );
}

function cursorOnly(params: { cursor?: string | undefined } | undefined): Record<string, unknown> {
  if (params?.cursor === undefined) return {};
  return { cursor: params.cursor };
}

type SandboxCsp = NonNullable<SandboxConfig["csp"]>;

// Rebuild the csp with absent-not-undefined fields so it satisfies the SDK
// type under exactOptionalPropertyTypes.
function toSandboxCsp(csp: McpAppProps["csp"]): SandboxCsp | undefined {
  if (!csp) return undefined;
  return {
    ...(csp.connectDomains !== undefined ? { connectDomains: csp.connectDomains } : {}),
    ...(csp.resourceDomains !== undefined ? { resourceDomains: csp.resourceDomains } : {}),
    ...(csp.frameDomains !== undefined ? { frameDomains: csp.frameDomains } : {}),
    ...(csp.baseUriDomains !== undefined ? { baseUriDomains: csp.baseUriDomains } : {}),
  };
}

// SECURITY: only http(s) links may leave the sandbox; anything else
// (javascript:, file:, custom schemes) is refused.
function openExternalLink(url: string): void {
  const isWebUrl = /^https?:\/\//i.test(url);
  if (!isWebUrl) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

type RecordAppEdit = (
  kind: EditKind,
  elementId: string,
  payload: Record<string, unknown>,
) => Promise<void>;

// ui/update-model-context (SEP-1865) and the draft ui/intent both land in
// parchment's writeback channel: the payload is injected into the coding
// agent's next turn as a <canvas-edit> block, marked user-content.
async function handleFallbackRequest(
  recordAppEdit: RecordAppEdit,
  method: string,
  params: unknown,
): Promise<Record<string, unknown>> {
  if (method === UPDATE_MODEL_CONTEXT_METHOD) {
    await recordAppEdit(EditKind.AppModelContext, MODEL_CONTEXT_ELEMENT_ID, payloadOf(params));
    return {};
  }
  if (method === APP_INTENT_METHOD) {
    await recordAppEdit(EditKind.AppIntent, INTENT_ELEMENT_ID, payloadOf(params));
    return {};
  }
  throw new Error(`parchment does not support ${method}`);
}

async function forwardAlarmingLog(
  recordAppEdit: RecordAppEdit,
  params: { level: string; data?: unknown },
): Promise<void> {
  console.debug("[McpApp] log", params);
  if (!ALARMING_LOG_LEVELS.has(params.level)) return;
  await recordAppEdit(EditKind.AppNotify, LOG_ELEMENT_ID, {
    level: params.level,
    data: params.data ?? null,
  });
}

// Returns the previous reference while the value is deep-equal (by JSON),
// giving downstream identity-keyed effects a stable input.
function useJsonStableValue<T>(value: T): T {
  const cacheRef = useRef<{ json: string | undefined; value: T } | null>(null);
  const json = value === undefined ? undefined : JSON.stringify(value);
  if (cacheRef.current === null || cacheRef.current.json !== json) {
    cacheRef.current = { json, value };
  }
  return cacheRef.current.value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payloadOf(params: unknown): Record<string, unknown> {
  if (isPlainRecord(params)) return { ...params };
  return { value: params ?? null };
}
