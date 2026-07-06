import * as z from "zod/v4";

const TestFailureSchema = z.object({
  name: z.string().describe("Full test name, e.g. 'cache > invalidates on write'."),
  message: z
    .string()
    .optional()
    .describe("Failure message or assertion diff, kept to a line or two."),
});

export const TestResultsPropsSchema = z.object({
  passed: z.number().int().nonnegative().describe("Number of passing tests."),
  failed: z.number().int().nonnegative().describe("Number of failing tests."),
  skipped: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Number of skipped tests. Omit to hide the skipped count."),
  durationMs: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Total run time in milliseconds; rendered human-readable ('842ms', '12.4s', '1m 32s')."),
  failures: z
    .array(TestFailureSchema)
    .optional()
    .describe("The failing tests, in order. Include only when failed > 0."),
});

export const TestResultsDefinition = {
  props: TestResultsPropsSchema,
  slots: [],
  events: [],
  description:
    "USE FOR: outcomes of real test or benchmark runs — a pass/fail/skip count strip plus per-failure detail rows. Renders its own surface — do not wrap in a Card. Only report runs you actually executed. DO NOT USE FOR: a single pass-rate KPI (use Metric) or full raw runner output (use Terminal).",
  example: {
    passed: 128,
    failed: 2,
    skipped: 3,
    durationMs: 8400,
    failures: [
      { name: "cache > invalidates on write", message: "expected null, got 'stale-value'" },
      { name: "routes > 404 on unknown slot", message: "expected 404, got 200" },
    ],
  },
};
