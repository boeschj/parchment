import { describe, expect, it } from "bun:test";
import { WidenedComponentPropSchemas } from "./prop-normal-forms.ts";

// The widened schemas ARE the contract: every declared input form must parse
// directly through the component's schema — no repair pass involved — and
// come out as the normal form the renderer consumes.

function parseProps(component: string, props: Record<string, unknown>): Record<string, unknown> {
  const schema = WidenedComponentPropSchemas[component];
  if (!schema) throw new Error(`no widened schema for ${component}`);
  const parsed = schema.partial().safeParse(props);
  if (!parsed.success) {
    throw new Error(`expected ${component} to accept ${JSON.stringify(props)}`);
  }
  return parsed.data;
}

function rejectionMessage(component: string, props: Record<string, unknown>): string {
  const schema = WidenedComponentPropSchemas[component];
  if (!schema) throw new Error(`no widened schema for ${component}`);
  const parsed = schema.partial().safeParse(props);
  if (parsed.success) {
    throw new Error(`expected ${component} to reject ${JSON.stringify(props)}`);
  }
  return parsed.error.issues[0]?.message ?? "";
}

describe("widened prop schemas — declared forms parse directly through the schema", () => {
  it("Stack gap: number, numeric string, and spacing word normalize to the nearest token", () => {
    expect(parseProps("Stack", { gap: 16 }).gap).toBe("md");
    expect(parseProps("Stack", { gap: "16" }).gap).toBe("md");
    expect(parseProps("Stack", { gap: "small" }).gap).toBe("sm");
    expect(parseProps("Stack", { gap: "xxl" }).gap).toBe("xl");
    expect(parseProps("Stack", { gap: 0 }).gap).toBe("none");
  });

  it("Stack gap: equidistant pixel values resolve toward the larger token", () => {
    expect(parseProps("Stack", { gap: 4 }).gap).toBe("sm");
    expect(parseProps("Stack", { gap: 12 }).gap).toBe("md");
  });

  it("Grid gap: the scale excludes 'none', so tiny gaps land on sm", () => {
    expect(parseProps("Grid", { gap: 2 }).gap).toBe("sm");
    expect(parseProps("Grid", { gap: 0 }).gap).toBe("sm");
  });

  it("Stack direction: row/col normalize to the axis tokens", () => {
    expect(parseProps("Stack", { direction: "row" }).direction).toBe("horizontal");
    expect(parseProps("Stack", { direction: "col" }).direction).toBe("vertical");
  });

  it("Heading level: int, numeric string, and H-form normalize; 5/6 clamp to h4", () => {
    expect(parseProps("Heading", { level: 1 }).level).toBe("h1");
    expect(parseProps("Heading", { level: "2" }).level).toBe("h2");
    expect(parseProps("Heading", { level: "H3" }).level).toBe("h3");
    expect(parseProps("Heading", { level: 5 }).level).toBe("h4");
    expect(parseProps("Heading", { level: 6 }).level).toBe("h4");
  });

  it("Button/Badge/Text variant synonyms normalize to catalog tokens", () => {
    expect(parseProps("Button", { variant: "default" }).variant).toBe("primary");
    expect(parseProps("Button", { variant: "ghost" }).variant).toBe("secondary");
    expect(parseProps("Badge", { variant: "error" }).variant).toBe("destructive");
    expect(parseProps("Text", { variant: "subtitle" }).variant).toBe("lead");
  });

  it("Chart xScale synonyms normalize to category/time", () => {
    expect(parseProps("Chart", { xScale: "linear" }).xScale).toBe("category");
    expect(parseProps("Chart", { xScale: "datetime" }).xScale).toBe("time");
  });

  it("Metric value/delta accept numbers and normalize to display strings", () => {
    expect(parseProps("Metric", { value: 42 }).value).toBe("42");
    expect(parseProps("Metric", { delta: 1.8 }).delta).toBe("1.8");
  });

  it("DataTable columns accept label as an alias for header", () => {
    const parsed = parseProps("DataTable", {
      columns: [{ key: "name", label: "Name" }],
    });
    expect(parsed.columns).toEqual([{ key: "name", header: "Name" }]);
  });

  it("values already in normal form pass through untouched", () => {
    expect(parseProps("Stack", { gap: "lg" }).gap).toBe("lg");
    expect(parseProps("Heading", { level: "h2" }).level).toBe("h2");
    expect(parseProps("Button", { variant: "danger" }).variant).toBe("danger");
  });

  it("unresolvable values still reject with the base enum message", () => {
    expect(rejectionMessage("Button", { variant: "fancy" })).toBe(
      'Invalid option: expected one of "primary"|"secondary"|"danger"',
    );
    expect(rejectionMessage("Stack", { gap: "roomy" })).toContain("Invalid option");
  });
});
