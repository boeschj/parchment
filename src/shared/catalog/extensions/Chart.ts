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

export const ChartXScale = {
  Category: "category",
  Time: "time",
} as const;

const ChartXScaleSchema = z.enum([ChartXScale.Category, ChartXScale.Time]);

export const ChartPropsSchema = z.object({
  kind: ChartKindSchema.describe(
    "Chart type. 'line' / 'area' for time series; 'bar' for categorical comparisons; 'pie' for parts-of-whole; 'scatter' for two-dimensional points.",
  ),
  data: z
    .array(z.record(z.string(), z.unknown()))
    .describe(
      "Row-oriented data; each element is an object whose keys include `x` and each entry in `y`. Example: data=[{month: 'Jan', revenue: 1200, cost: 800}, ...], x='month', y=['revenue', 'cost']. For pie charts, x is the category name and the first y key is the value.",
    ),
  x: z
    .string()
    .describe(
      "Key in each row used for the X axis label (or pie slice name). Must exist in every data row.",
    ),
  y: z
    .union([z.string(), z.array(z.string())])
    .describe(
      "Key (string) or keys (array) in each row to plot on Y. Provide an array for multi-series. For pie, only the first y key is read.",
    ),
  title: z.string().optional(),
  height: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Chart height in pixels. Default 320. Set 480 for a full-section chart, 240 for compact.",
    ),
  xScale: ChartXScaleSchema.optional().describe(
    "'time' treats x values as epoch-milliseconds: continuous numeric axis pinned to the data window, HH:MM:SS ticks, per-point dots and reanimation off so streaming extends smoothly. Use for line/area fed by canvas_live (points carry `t`). Default 'category'.",
  ),
});

export const ChartDefinition = {
  props: ChartPropsSchema,
  slots: [],
  events: [],
  description:
    "USE FOR: visualizing metrics, time series, distributions, comparisons. Read-only Recharts component. DO NOT USE FOR: tabular data where the user needs row-level detail (use DataTable instead — a chart compresses, a table preserves). To show both, pair Chart + DataTable inside a Stack.",
  example: {
    kind: ChartKind.Line,
    title: "Daily revenue",
    x: "day",
    y: ["revenue", "cost"],
    height: 320,
    data: [
      { day: "2026-05-25", revenue: 1240, cost: 820 },
      { day: "2026-05-26", revenue: 1380, cost: 845 },
      { day: "2026-05-27", revenue: 1190, cost: 802 },
      { day: "2026-05-28", revenue: 1505, cost: 860 },
      { day: "2026-05-29", revenue: 1410, cost: 838 },
    ],
  },
};
