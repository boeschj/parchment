import * as z from "zod/v4";

export const StepStatus = {
  Done: "done",
  Active: "active",
  Pending: "pending",
  Error: "error",
} as const;

const StepStatusSchema = z.enum([
  StepStatus.Done,
  StepStatus.Active,
  StepStatus.Pending,
  StepStatus.Error,
]);

const StepItemSchema = z.object({
  title: z
    .string()
    .describe("What this step is — a short action or milestone, e.g. 'Backfill invoice index'."),
  detail: z
    .string()
    .optional()
    .describe(
      "One line of supporting context: what happened, what's blocking, a file or command involved.",
    ),
  status: StepStatusSchema.describe(
    "'done' ✓ completed, 'active' currently in progress, 'pending' not started, 'error' ✗ failed.",
  ),
});

export const StepsPropsSchema = z.object({
  items: z
    .array(StepItemSchema)
    .describe(
      "Steps in order. Use exactly one 'active' step for in-progress sequences; all 'done' for completed ones.",
    ),
});

export const StepsDefinition = {
  props: StepsPropsSchema,
  slots: [],
  events: [],
  description:
    "USE FOR: pipelines, migration stages, deploy sequences, causal chains, task progress — anything with ordered stages and per-stage status. Renders a vertical timeline with status indicators. Has no surface of its own — place inside a Card. DO NOT USE FOR: unordered lists (use Markdown) or per-file change summaries (use FileChange).",
  example: {
    items: [
      {
        title: "Schema migration applied",
        detail: "0042_add_invoice_index.sql — 1.2s",
        status: StepStatus.Done,
      },
      {
        title: "Backfilling invoice_search column",
        detail: "3.1M of 4.8M rows",
        status: StepStatus.Active,
      },
      { title: "Swap read path to new index", status: StepStatus.Pending },
      { title: "Drop legacy column", status: StepStatus.Pending },
    ],
  },
};
