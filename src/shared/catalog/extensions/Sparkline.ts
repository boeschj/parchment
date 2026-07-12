import * as z from "zod/v4";

export const SPARKLINE_DEFAULT_WIDTH = 120;
export const SPARKLINE_DEFAULT_HEIGHT = 32;
export const SPARKLINE_DEFAULT_VALUE_KEY = "value";

export const SparklinePropsSchema = z.object({
  data: z
    .array(z.union([z.number(), z.record(z.string(), z.unknown())]))
    .describe(
      "Points, oldest first. Plain numbers, or objects read via `y` (default 'value' — canvas_live append points fit as-is).",
    ),
  y: z
    .string()
    .optional()
    .describe("Key read from object points. Default 'value'."),
  width: z.number().int().positive().optional().describe("Pixel width. Default 120."),
  height: z.number().int().positive().optional().describe("Pixel height. Default 32."),
  series: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("Chart palette index 1-5 for the stroke color. Default 1."),
});

export const SparklineDefinition = {
  props: SparklinePropsSchema,
  slots: [],
  events: [],
  description:
    "USE FOR: a tiny axis-less trend line inline with other content — beside a Metric, inside a repeated Card row, in a fleet/status grid. Bind `data` to a canvas_live window with {\"$state\": \"/series\"}. DO NOT USE FOR: a primary visualization (use Chart — it has axes, tooltips, legends).",
  example: {
    data: [3, 4, 3.5, 5, 6, 5.5, 7],
    width: 120,
    height: 32,
  },
};
