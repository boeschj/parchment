import { describe, it, expect } from "bun:test";
import { extractIntentMenu, resolveIntent } from "./intents.ts";
import { SlotKind, SlotOrigin, SlotStatus, type JsonRenderSpec, type Slot } from "../shared/types.ts";

function specWith(elements: JsonRenderSpec["elements"]): JsonRenderSpec {
  return { root: "main", elements };
}

describe("extractIntentMenu", () => {
  it("records every canvas.intent binding with its static params", () => {
    const spec = specWith({
      main: { type: "Stack", props: {}, children: ["retry", "deploy"] },
      retry: {
        type: "Button",
        props: { label: "Retry failed" },
        on: { press: { action: "canvas.intent", params: { id: "retry-failed", params: { suite: "unit" } } } },
      },
      deploy: {
        type: "Button",
        props: { label: "Deploy" },
        on: { press: { action: "canvas.intent", params: { id: "deploy" } } },
      },
    });

    const { menu, issues } = extractIntentMenu(spec);

    expect(issues).toEqual([]);
    expect(menu["retry-failed"]).toEqual({ id: "retry-failed", params: { suite: "unit" } });
    expect(menu["deploy"]).toEqual({ id: "deploy" });
  });

  it("ignores bindings for other actions", () => {
    const spec = specWith({
      main: {
        type: "Button",
        props: {},
        on: { press: { action: "canvas.submit", params: { id: "form" } } },
      },
    });

    const { menu, issues } = extractIntentMenu(spec);

    expect(issues).toEqual([]);
    expect(Object.keys(menu)).toEqual([]);
  });

  it("collects intents from array-valued event bindings", () => {
    const spec = specWith({
      main: {
        type: "Button",
        props: {},
        on: {
          press: [
            { action: "canvas.flushPending" },
            { action: "canvas.intent", params: { id: "approve" } },
          ],
        },
      },
    });

    const { menu, issues } = extractIntentMenu(spec);

    expect(issues).toEqual([]);
    expect(menu["approve"]).toEqual({ id: "approve" });
  });

  it("rejects a binding without a string id", () => {
    const spec = specWith({
      main: { type: "Button", props: {}, on: { press: { action: "canvas.intent", params: {} } } },
    });

    const { issues } = extractIntentMenu(spec);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("params.id");
  });

  it("rejects duplicate intent ids across the slot", () => {
    const spec = specWith({
      a: { type: "Button", props: {}, on: { press: { action: "canvas.intent", params: { id: "go" } } } },
      b: { type: "Button", props: {}, on: { press: { action: "canvas.intent", params: { id: "go" } } } },
    });

    const { issues } = extractIntentMenu(spec);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("duplicate intent id");
  });

  it("rejects expression-valued params so the page can never author the payload", () => {
    const spec = specWith({
      main: {
        type: "Button",
        props: {},
        on: {
          press: {
            action: "canvas.intent",
            params: { id: "submit", params: { form: { $state: "/form" } } },
          },
        },
      },
    });

    const { issues, menu } = extractIntentMenu(spec);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("static JSON");
    expect(menu["submit"]).toBeUndefined();
  });
});

describe("resolveIntent", () => {
  const baseSlot: Slot = {
    id: "slot-1",
    kind: SlotKind.Render,
    status: SlotStatus.Ready,
    origin: SlotOrigin.McpTool,
    title: "t",
    spec: { root: "main", elements: {} },
    state: {},
    createdAt: 0,
    updatedAt: 0,
  };

  it("resolves an id the agent offered", () => {
    const slot: Slot = { ...baseSlot, intentMenu: { go: { id: "go", params: { a: 1 } } } };

    expect(resolveIntent(slot, "go")).toEqual({ id: "go", params: { a: 1 } });
  });

  it("returns null for ids that were never offered", () => {
    const slot: Slot = { ...baseSlot, intentMenu: { go: { id: "go" } } };

    expect(resolveIntent(slot, "fabricated")).toBeNull();
  });

  it("returns null when the slot has no intent menu", () => {
    expect(resolveIntent(baseSlot, "go")).toBeNull();
  });
});
