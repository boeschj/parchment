import * as z from "zod/v4";

export const MetricTrend = {
  Up: "up",
  Down: "down",
  Flat: "flat",
} as const;

const MetricTrendSchema = z.enum([
  MetricTrend.Up,
  MetricTrend.Down,
  MetricTrend.Flat,
]);

export const MetricTone = {
  Neutral: "neutral",
  Success: "success",
  Warning: "warning",
  Danger: "danger",
} as const;

const MetricToneSchema = z.enum([
  MetricTone.Neutral,
  MetricTone.Success,
  MetricTone.Warning,
  MetricTone.Danger,
]);

export const MetricPropsSchema = z.object({
  label: z
    .string()
    .describe(
      "Short label above the value, e.g. 'p99 latency', 'Monthly revenue'. Rendered as a small uppercase caption.",
    ),
  value: z
    .string()
    .describe(
      "The headline number, preformatted with units: '1.24s', '$48.2k', '99.98%'. Keep it short — it renders large and dominates the tile.",
    ),
  delta: z
    .string()
    .optional()
    .describe(
      "Change vs the previous period, preformatted: '+12%', '-340ms'. Rendered as a small pill next to the value.",
    ),
  trend: MetricTrendSchema.optional().describe(
    "Direction arrow in the delta pill: 'up' ↑, 'down' ↓, 'flat' →. Also picks the default delta color (up=success, down=danger) when tone is omitted.",
  ),
  tone: MetricToneSchema.optional().describe(
    "Explicit delta color, overriding the trend default. Use when direction and sentiment disagree — e.g. latency going up is 'danger' even though trend is 'up'.",
  ),
  detail: z
    .string()
    .optional()
    .describe("One quiet line of context below the value, e.g. 'vs. 1.42s last week'."),
});

export const MetricDefinition = {
  props: MetricPropsSchema,
  slots: [],
  events: [],
  description:
    "USE FOR: any headline number — KPI, stat, benchmark result, count, percentage. Renders as a tile where the value dominates; place 2-4 in a Grid for a stat row. Renders its own surface — do not wrap in a Card. DO NOT USE Card+Text to fake a stat tile; Metric is the stat tile.",
  example: {
    label: "p99 latency",
    value: "1.24s",
    delta: "-180ms",
    trend: MetricTrend.Down,
    tone: MetricTone.Success,
    detail: "vs. 1.42s before the cache change",
  },
};
