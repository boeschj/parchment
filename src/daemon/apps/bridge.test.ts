import { describe, it, expect } from "bun:test";
import {
  validateBridgeCall,
  authorizeBridgeCall,
  extractEmbeddedUiResource,
  uiResourceUriFromToolMeta,
  resourceContentsToAppUi,
  cspFromResourceMeta,
  resultTextSummary,
  isSupportedAppMime,
  type BridgeCall,
} from "./bridge.ts";
import { AppResourceMimeType } from "../../shared/mcp-apps.ts";

describe("validateBridgeCall", () => {
  it("accepts a tools/call with name and arguments", () => {
    const outcome = validateBridgeCall({
      method: "tools/call",
      params: { name: "add_task", arguments: { title: "x" } },
    });

    expect(outcome.ok).toBe(true);
  });

  it("accepts a resources/read with a uri", () => {
    const outcome = validateBridgeCall({
      method: "resources/read",
      params: { uri: "ui://hello-app/board" },
    });

    expect(outcome.ok).toBe(true);
  });

  it("accepts list methods with and without cursor", () => {
    expect(validateBridgeCall({ method: "resources/list", params: {} }).ok).toBe(true);
    expect(validateBridgeCall({ method: "prompts/list", params: { cursor: "c" } }).ok).toBe(true);
    expect(validateBridgeCall({ method: "resources/templates/list", params: {} }).ok).toBe(true);
  });

  it("rejects methods outside the whitelist by name", () => {
    const outcome = validateBridgeCall({
      method: "sampling/createMessage",
      params: { messages: [] },
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("not allowed across the app bridge");
  });

  it("rejects ui/* host methods — those never cross to the app server", () => {
    const outcome = validateBridgeCall({ method: "ui/update-model-context", params: {} });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("not allowed");
  });

  it("rejects a tools/call without a tool name", () => {
    const outcome = validateBridgeCall({ method: "tools/call", params: {} });

    expect(outcome.ok).toBe(false);
  });

  it("rejects extra keys smuggled next to whitelisted params", () => {
    const outcome = validateBridgeCall({
      method: "tools/call",
      params: { name: "t", arguments: {}, _meta: { progressToken: 1 } },
    });

    expect(outcome.ok).toBe(false);
  });

  it("rejects non-object bodies", () => {
    expect(validateBridgeCall("tools/call").ok).toBe(false);
    expect(validateBridgeCall(null).ok).toBe(false);
    expect(validateBridgeCall(42).ok).toBe(false);
  });
});

// SEP-1865: "Host MUST reject tools/call requests from apps for tools that
// don't include "app" in visibility". The allowlist is the app slot's grant.
describe("authorizeBridgeCall", () => {
  const helloApp = { server: "hello-app", appVisibleTools: ["add_task"] };

  function toolCall(name: string): BridgeCall {
    return { method: "tools/call", params: { name } };
  }

  it("allows a tool the server declared app-visible", () => {
    expect(authorizeBridgeCall(toolCall("add_task"), helloApp).ok).toBe(true);
  });

  it("rejects a tool the server never declared app-visible", () => {
    const outcome = authorizeBridgeCall(toolCall("list_tasks"), helloApp);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toContain('"list_tasks" is not app-visible');
    expect(outcome.error).toContain("hello-app");
    expect(outcome.error).toContain("add_task");
  });

  it("rejects EVERY tool when the server declares no visibility, and explains why", () => {
    const silentServer = { server: "legacy-app", appVisibleTools: [] };

    const outcome = authorizeBridgeCall(toolCall("anything"), silentServer);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toContain("declares no app-visible tools");
    expect(outcome.error).toContain("_meta.ui.visibility");
    expect(outcome.error).toContain("an app that declares nothing gets nothing");
  });

  // The grant is per-slot and carries its own server's allowlist, so a tool
  // that exists on a DIFFERENT app's server is simply not in this one.
  it("does not let one app's iframe reach a second app's tools", () => {
    const weatherApp = { server: "weather-app", appVisibleTools: ["refresh_forecast"] };

    const fromHelloApp = authorizeBridgeCall(toolCall("refresh_forecast"), helloApp);
    const fromWeatherApp = authorizeBridgeCall(toolCall("add_task"), weatherApp);

    expect(fromHelloApp.ok).toBe(false);
    expect(fromWeatherApp.ok).toBe(false);
    if (fromHelloApp.ok) return;
    expect(fromHelloApp.error).toContain("hello-app");
  });

  // Visibility scopes tools/call. The other whitelisted methods are scoped by
  // CONNECTION — the grant picks the server — which is what the spec requires.
  it("does not tool-check the non-tools/call methods", () => {
    expect(authorizeBridgeCall({ method: "resources/read", params: { uri: "ui://x/y" } }, helloApp).ok).toBe(true);
    expect(authorizeBridgeCall({ method: "resources/list", params: {} }, helloApp).ok).toBe(true);
    expect(authorizeBridgeCall({ method: "prompts/list", params: {} }, helloApp).ok).toBe(true);
  });
});

const APP_HTML = "<html><body>app</body></html>";

describe("extractEmbeddedUiResource", () => {
  it("finds the first embedded ui:// resource with a supported mime", () => {
    const extracted = extractEmbeddedUiResource([
      { type: "text", text: "hello" },
      {
        type: "resource",
        resource: { uri: "ui://demo/widget", mimeType: AppResourceMimeType.McpApp, text: APP_HTML },
      },
    ]);

    expect(extracted).toEqual({
      resourceUri: "ui://demo/widget",
      mimeType: AppResourceMimeType.McpApp,
      html: APP_HTML,
    });
  });

  it("ignores non-ui resources and unsupported mimes", () => {
    expect(
      extractEmbeddedUiResource([
        { type: "resource", resource: { uri: "file:///x", mimeType: "text/html", text: "x" } },
        { type: "resource", resource: { uri: "ui://demo/x", mimeType: "application/json", text: "{}" } },
      ]),
    ).toBeNull();
  });

  it("returns null for a text-only result", () => {
    expect(extractEmbeddedUiResource([{ type: "text", text: "no ui" }])).toBeNull();
  });
});

describe("uiResourceUriFromToolMeta", () => {
  it("reads the flat ui/resourceUri key", () => {
    expect(uiResourceUriFromToolMeta({ "ui/resourceUri": "ui://a/b" })).toBe("ui://a/b");
  });

  it("reads the nested ui.resourceUri key", () => {
    expect(uiResourceUriFromToolMeta({ ui: { resourceUri: "ui://a/b" } })).toBe("ui://a/b");
  });

  it("rejects non-ui schemes", () => {
    expect(uiResourceUriFromToolMeta({ "ui/resourceUri": "https://evil.example" })).toBeNull();
  });

  it("returns null for missing metadata", () => {
    expect(uiResourceUriFromToolMeta(undefined)).toBeNull();
    expect(uiResourceUriFromToolMeta({})).toBeNull();
  });
});

describe("resourceContentsToAppUi", () => {
  it("decodes base64 blob contents", () => {
    const ui = resourceContentsToAppUi({
      uri: "ui://demo/widget",
      mimeType: AppResourceMimeType.McpApp,
      blob: Buffer.from(APP_HTML, "utf8").toString("base64"),
    });

    expect(ui?.html).toBe(APP_HTML);
  });

  it("accepts the OpenAI skybridge mime variant", () => {
    const ui = resourceContentsToAppUi({
      uri: "ui://openai/widget",
      mimeType: AppResourceMimeType.OpenAiSkybridge,
      text: APP_HTML,
    });

    expect(ui?.mimeType).toBe(AppResourceMimeType.OpenAiSkybridge);
  });

  it("wraps text/uri-list resources in framing html with a frame-domain csp", () => {
    const ui = resourceContentsToAppUi({
      uri: "ui://demo/external",
      mimeType: AppResourceMimeType.ExternalUrlList,
      text: "# comment\nhttps://example.com/widget\n",
    });

    expect(ui?.html).toContain('src="https://example.com/widget"');
    expect(ui?.csp?.frameDomains).toEqual(["https://example.com"]);
  });

  it("rejects uri-list entries that are not http(s)", () => {
    const ui = resourceContentsToAppUi({
      uri: "ui://demo/external",
      mimeType: AppResourceMimeType.ExternalUrlList,
      text: "javascript:alert(1)",
    });

    expect(ui).toBeNull();
  });

  it("carries the resource csp metadata through", () => {
    const ui = resourceContentsToAppUi({
      uri: "ui://demo/widget",
      mimeType: AppResourceMimeType.McpApp,
      text: APP_HTML,
      _meta: { ui: { csp: { connectDomains: ["https://api.example.com"] } } },
    });

    expect(ui?.csp).toEqual({ connectDomains: ["https://api.example.com"] });
  });
});

describe("cspFromResourceMeta", () => {
  it("keeps only string entries of known domain lists", () => {
    const csp = cspFromResourceMeta({
      ui: {
        csp: {
          connectDomains: ["https://a.example", 42],
          resourceDomains: ["https://b.example"],
          unknownField: ["x"],
        },
      },
    });

    expect(csp).toEqual({
      connectDomains: ["https://a.example"],
      resourceDomains: ["https://b.example"],
    });
  });

  it("returns undefined when no csp is declared", () => {
    expect(cspFromResourceMeta({})).toBeUndefined();
    expect(cspFromResourceMeta(undefined)).toBeUndefined();
  });
});

describe("resultTextSummary", () => {
  it("joins every text block", () => {
    const summary = resultTextSummary([
      { type: "text", text: "line one" },
      { type: "resource", resource: {} },
      { type: "text", text: "line two" },
    ]);

    expect(summary).toBe("line one\nline two");
  });

  it("returns an empty string for non-array content", () => {
    expect(resultTextSummary(undefined)).toBe("");
  });
});

describe("isSupportedAppMime", () => {
  it("accepts the four supported flavors and nothing else", () => {
    expect(isSupportedAppMime("text/html;profile=mcp-app")).toBe(true);
    expect(isSupportedAppMime("text/html")).toBe(true);
    expect(isSupportedAppMime("text/html+skybridge")).toBe(true);
    expect(isSupportedAppMime("text/uri-list")).toBe(true);
    expect(isSupportedAppMime("application/json")).toBe(false);
  });
});
