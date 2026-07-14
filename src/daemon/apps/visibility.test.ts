import { describe, it, expect } from "bun:test";
import { appVisibleToolNames, isAppVisibleTool } from "./visibility.ts";

describe("isAppVisibleTool", () => {
  it("accepts a tool whose _meta.ui.visibility includes app", () => {
    expect(isAppVisibleTool({ name: "add_task", _meta: { ui: { visibility: ["model", "app"] } } })).toBe(true);
  });

  it("accepts an app-only tool", () => {
    expect(isAppVisibleTool({ name: "refresh", _meta: { ui: { visibility: ["app"] } } })).toBe(true);
  });

  it("rejects a model-only tool", () => {
    expect(isAppVisibleTool({ name: "delete_all", _meta: { ui: { visibility: ["model"] } } })).toBe(false);
  });

  // The deliberate deviation from SEP-1865, which defaults an omitted
  // visibility to ["model", "app"]. parchment reads an omitted declaration as
  // "the server never thought about this" and denies. See visibility.ts.
  it("rejects a tool that declares no visibility at all — default DENY", () => {
    expect(isAppVisibleTool({ name: "list_tasks" })).toBe(false);
    expect(isAppVisibleTool({ name: "list_tasks", _meta: {} })).toBe(false);
    expect(isAppVisibleTool({ name: "list_tasks", _meta: { ui: {} } })).toBe(false);
    expect(isAppVisibleTool({ name: "list_tasks", _meta: { ui: { resourceUri: "ui://a/b" } } })).toBe(false);
  });

  it("rejects an empty visibility array", () => {
    expect(isAppVisibleTool({ name: "nobody", _meta: { ui: { visibility: [] } } })).toBe(false);
  });

  it("rejects malformed metadata rather than guessing", () => {
    expect(isAppVisibleTool({ name: "x", _meta: { ui: { visibility: "app" } } })).toBe(false);
    expect(isAppVisibleTool({ name: "x", _meta: "app" })).toBe(false);
    expect(isAppVisibleTool({ name: "x", _meta: { ui: [] } })).toBe(false);
  });

  // Lenient in what it accepts, strict in what it decides: an audience a future
  // spec version adds must not invalidate the "app" grant sitting next to it.
  it("tolerates unknown audiences alongside app", () => {
    expect(isAppVisibleTool({ name: "x", _meta: { ui: { visibility: ["app", "future"] } } })).toBe(true);
    expect(isAppVisibleTool({ name: "y", _meta: { ui: { visibility: ["future"] } } })).toBe(false);
  });
});

describe("appVisibleToolNames", () => {
  it("keeps only the tools the server declared app-visible", () => {
    const names = appVisibleToolNames([
      { name: "show_task_board", _meta: { ui: { resourceUri: "ui://a/b", visibility: ["model"] } } },
      { name: "add_task", _meta: { ui: { visibility: ["model", "app"] } } },
      { name: "list_tasks" },
    ]);

    expect(names).toEqual(["add_task"]);
  });

  it("returns an empty allowlist for a server that declares nothing", () => {
    const names = appVisibleToolNames([{ name: "a" }, { name: "b" }, { name: "c" }]);

    expect(names).toEqual([]);
  });
});
