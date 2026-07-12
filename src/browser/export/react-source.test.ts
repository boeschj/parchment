import { describe, it, expect } from "bun:test";
import { specToReactSource } from "./react-source.ts";
import type { JsonRenderSpec } from "../../shared/types.ts";

describe("specToReactSource", () => {
  it("emits a self-contained default-exported component importing only react", () => {
    const spec: JsonRenderSpec = {
      root: "h",
      elements: { h: { type: "Heading", props: { text: "Hello", level: "h1" }, children: [] } },
    };
    const source = specToReactSource(spec);
    expect(source).toContain('from "react"');
    expect(source).toContain("export default function ExportedCanvas");
    expect(source).toContain("Hello");
    // No imports other than react.
    const nonReactImport = /import[^\n]*from\s+"(?!react")/.test(source);
    expect(nonReactImport).toBe(false);
  });

  it("resolves $template and $state against the seed state", () => {
    const spec: JsonRenderSpec = {
      root: "m",
      elements: { m: { type: "Metric", props: { label: "p99", value: { $template: "${/v} ms" } }, children: [] } },
      state: { v: 412 },
    };
    const source = specToReactSource(spec);
    expect(source).toContain("412 ms");
  });

  it("renders every DataTable row (nothing truncated)", () => {
    const spec: JsonRenderSpec = {
      root: "t",
      elements: {
        t: {
          type: "DataTable",
          props: {
            columns: [{ key: "q", header: "Query" }, { key: "ms", header: "p99" }],
            rows: [
              { q: "alpha", ms: 1 },
              { q: "beta", ms: 2 },
              { q: "gamma", ms: 3 },
            ],
          },
          children: [],
        },
      },
    };
    const source = specToReactSource(spec);
    expect(source).toContain("alpha");
    expect(source).toContain("beta");
    expect(source).toContain("gamma");
  });

  it("preserves chart data as a table so nothing is lost", () => {
    const spec: JsonRenderSpec = {
      root: "c",
      elements: {
        c: {
          type: "Chart",
          props: { kind: "bar", x: "day", y: ["revenue"], data: [{ day: "Mon", revenue: 1200 }] },
          children: [],
        },
      },
    };
    const source = specToReactSource(spec);
    expect(source).toContain("Mon");
    expect(source).toContain("1200");
  });

  it("expands repeat over state arrays with $item scope", () => {
    const spec: JsonRenderSpec = {
      root: "list",
      elements: {
        list: { type: "Stack", props: {}, children: ["row"] },
        row: { type: "Text", props: { text: { $item: "name" } }, repeat: { statePath: "/items", key: "id" }, children: [] },
      },
      state: { items: [{ id: 1, name: "Alpha" }, { id: 2, name: "Beta" }] },
    };
    const source = specToReactSource(spec);
    expect(source).toContain("Alpha");
    expect(source).toContain("Beta");
  });

  it("hides elements whose visible condition is false", () => {
    const spec: JsonRenderSpec = {
      root: "wrap",
      elements: {
        wrap: { type: "Stack", props: {}, children: ["secret"] },
        secret: { type: "Text", props: { text: "TOPSECRET" }, visible: { $state: "/show" }, children: [] },
      },
      state: { show: false },
    };
    const source = specToReactSource(spec);
    expect(source).not.toContain("TOPSECRET");
  });

  it("seeds useState and wires controlled inputs only when a form binds state", () => {
    const withoutInputs: JsonRenderSpec = {
      root: "h",
      elements: { h: { type: "Heading", props: { text: "Hi" }, children: [] } },
      state: { some: "value" },
    };
    const plain = specToReactSource(withoutInputs);
    expect(plain).not.toContain("useState");

    const withInput: JsonRenderSpec = {
      root: "in",
      elements: { in: { type: "Input", props: { label: "Title", value: { $bindState: "/form/title" } }, children: [] } },
      state: { form: { title: "seed" } },
    };
    const wired = specToReactSource(withInput);
    expect(wired).toContain("import { useState }");
    expect(wired).toContain("useState<JsonValue>");
    expect(wired).toContain('getAtPointer(state, "/form/title")');
    expect(wired).toContain('"seed"');
  });

  it("derives the component name from the slot title", () => {
    const spec: JsonRenderSpec = {
      root: "h",
      elements: { h: { type: "Heading", props: { text: "x" }, children: [] } },
    };
    const source = specToReactSource(spec, { componentName: "My Cool Dashboard!" });
    expect(source).toContain("function MyCoolDashboard(");
  });

  it("falls back to a labeled box for unmapped component types", () => {
    const spec: JsonRenderSpec = {
      root: "u",
      elements: { u: { type: "Scene3D", props: { objects: [] }, children: [] } },
    };
    const source = specToReactSource(spec);
    expect(source).toContain("Scene3D");
  });
});
