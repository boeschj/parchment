import { describe, it, expect } from "bun:test";
import { canvasCatalog } from "./index.ts";

const NEW_EXTENSION_COMPONENT_NAMES = [
  "Metric",
  "Steps",
  "CodeBlock",
  "Callout",
  "Terminal",
  "FileChange",
  "TestResults",
  "Markdown",
] as const;

describe("canvasCatalog", () => {
  it("registers all 8 new extension components", () => {
    for (const name of NEW_EXTENSION_COMPONENT_NAMES) {
      expect(canvasCatalog.componentNames).toContain(name);
    }
  });

  it("registers the canvas.submit action used by the Button on.press binding", () => {
    expect(canvasCatalog.actionNames).toContain("canvas.submit");
  });

  it("registers the other canvas actions consumed by canvas-actions.ts handlers", () => {
    expect(canvasCatalog.actionNames).toContain("canvas.commentMermaid");
    expect(canvasCatalog.actionNames).toContain("canvas.flushPending");
  });
});
