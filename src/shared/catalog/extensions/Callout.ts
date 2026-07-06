import * as z from "zod/v4";

export const CalloutTone = {
  Info: "info",
  Success: "success",
  Warning: "warning",
  Danger: "danger",
  Tip: "tip",
} as const;

const CalloutToneSchema = z.enum([
  CalloutTone.Info,
  CalloutTone.Success,
  CalloutTone.Warning,
  CalloutTone.Danger,
  CalloutTone.Tip,
]);

export const CalloutPropsSchema = z.object({
  tone: CalloutToneSchema.describe(
    "'info' neutral note, 'success' confirmation, 'warning' gotcha, 'danger' breaking/destructive, 'tip' recommendation.",
  ),
  title: z
    .string()
    .optional()
    .describe("Short bold lead-in, e.g. 'Breaking change'. Omit for a single-sentence callout."),
  body: z
    .string()
    .describe(
      "The callout text. Single newlines become line breaks; `backtick spans` render as inline code. Plain text otherwise — no markdown.",
    ),
  compact: z
    .boolean()
    .optional()
    .describe("Default false. True tightens padding for dense layouts."),
});

export const CalloutDefinition = {
  props: CalloutPropsSchema,
  slots: [],
  events: [],
  description:
    "USE FOR: an emphasized insight, warning, gotcha, or recommendation inline with the prose flow of a report — the 'by the way, this matters' moment. Tinted left-accent treatment, visually distinct from the neutral Alert card. DO NOT USE FOR: neutral status messages (use Alert) or long prose (use Markdown).",
  example: {
    tone: CalloutTone.Warning,
    title: "Lock contention risk",
    body: "The backfill takes an ACCESS EXCLUSIVE lock on `invoices`.\nRun it during the maintenance window, not from a migration.",
  },
};
