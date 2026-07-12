import { describe, it, expect } from "bun:test";
import { toPresentationSpec } from "./spec-presentation.ts";
import type { JsonRenderSpec } from "../../shared/types.ts";

describe("toPresentationSpec", () => {
  it("forces MermaidEditor to render-only (no source pane, not editable)", () => {
    const spec: JsonRenderSpec = {
      root: "d",
      elements: {
        d: { type: "MermaidEditor", props: { source: "graph TD; A-->B", editable: true, showSource: true }, children: [] },
      },
    };
    const result = toPresentationSpec(spec);
    expect(result.elements.d!.props).toMatchObject({ editable: false, showSource: false, source: "graph TD; A-->B" });
  });

  it("drops the DataTable CSV button and inline edit", () => {
    const spec: JsonRenderSpec = {
      root: "t",
      elements: {
        t: { type: "DataTable", props: { columns: [], rows: [], exportable: true, editable: true }, children: [] },
      },
    };
    const result = toPresentationSpec(spec);
    expect(result.elements.t!.props).toMatchObject({ exportable: false, editable: false });
  });

  it("leaves unrelated components untouched", () => {
    const spec: JsonRenderSpec = {
      root: "c",
      elements: {
        c: { type: "Chart", props: { kind: "line", x: "t", y: "v", data: [] }, children: [] },
      },
    };
    const result = toPresentationSpec(spec);
    expect(result.elements.c!.props).toEqual({ kind: "line", x: "t", y: "v", data: [] });
  });

  it("does not mutate the input spec", () => {
    const spec: JsonRenderSpec = {
      root: "d",
      elements: { d: { type: "MermaidEditor", props: { source: "x", editable: true }, children: [] } },
    };
    toPresentationSpec(spec);
    expect(spec.elements.d!.props.editable).toBe(true);
  });
});
