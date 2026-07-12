import { describe, expect, test } from "bun:test";
import type { Slot } from "../../src/shared/types.ts";
import { SlotKind, SlotOrigin, SlotStatus } from "../../src/shared/types.ts";
import { validateHtml } from "./html-validator.ts";
import { validateParchmentSlots } from "./parchment-validator.ts";

describe("validateHtml", () => {
  test("passes when every requirement meets its minimum match count", () => {
    const html = "<table><tr><td>Ada</td></tr><tr><td>Grace</td></tr></table>";

    const result = validateHtml(html, [
      { description: "has a table", pattern: /<table/, minimumMatches: 1 },
      { description: "has 2 rows", pattern: /<tr>/, minimumMatches: 2 },
    ]);

    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  test("reports one reason per unmet requirement", () => {
    const html = "<table><tr><td>Ada</td></tr></table>";

    const result = validateHtml(html, [
      { description: "has a table", pattern: /<table/, minimumMatches: 1 },
      { description: "has 2 rows", pattern: /<tr>/, minimumMatches: 2 },
      { description: "has a chart", pattern: /<svg|<canvas/, minimumMatches: 1 },
    ]);

    expect(result.passed).toBe(false);
    expect(result.reasons).toHaveLength(2);
  });
});

describe("validateParchmentSlots", () => {
  const dashboardSlot: Slot = {
    id: "slot-1",
    kind: SlotKind.Dashboard,
    status: SlotStatus.Ready,
    origin: SlotOrigin.McpTool,
    title: "Status dashboard",
    spec: {
      root: "root",
      elements: {
        root: { type: "Grid", props: {}, children: ["metric-1", "chart-1"] },
        "metric-1": { type: "Metric", props: {} },
        "chart-1": { type: "Chart", props: {} },
      },
    },
    state: {},
    createdAt: 0,
    updatedAt: 0,
  };

  test("passes when required component counts are all met", () => {
    const result = validateParchmentSlots([dashboardSlot], {
      minimumCountByComponentType: { Metric: 1, Chart: 1 },
    });

    expect(result.passed).toBe(true);
  });

  test("fails and names the missing component when a count falls short", () => {
    const result = validateParchmentSlots([dashboardSlot], {
      minimumCountByComponentType: { Metric: 1, Chart: 2 },
    });

    expect(result.passed).toBe(false);
    expect(result.reasons[0]).toContain("Chart");
  });
});
