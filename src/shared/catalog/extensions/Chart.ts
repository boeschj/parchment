import * as z from "zod/v4";

export const ChartKind = {
  Line: "line",
  Bar: "bar",
  Area: "area",
  Pie: "pie",
  Scatter: "scatter",
} as const;

const ChartKindSchema = z.enum([
  ChartKind.Line,
  ChartKind.Bar,
  ChartKind.Area,
  ChartKind.Pie,
  ChartKind.Scatter,
]);

export const ChartPropsSchema = z.object({
  kind: ChartKindSchema.describe("Chart type."),
  data: z.array(z.record(z.string(), z.unknown())).describe("Row-oriented data; each element is a record keyed by column name."),
  x: z.string().describe("Key in each row to use for the X axis (or category for pie)."),
  y: z.union([z.string(), z.array(z.string())]).describe("Key (or keys) in each row to plot on Y. Provide an array for multi-series."),
  title: z.string().optional(),
  height: z.number().int().positive().optional().describe("Chart height in pixels. Default 320."),
});

export const ChartDefinition = {
  props: ChartPropsSchema,
  description: "Recharts-powered chart. Use to visualize metrics, time series, distributions, comparisons. Read-only in v1 (no edit-back) — when the user wants a different view they can ask you in chat and you call canvas_render again with an updated spec.",
} as const;
