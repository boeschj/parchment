import * as z from "zod/v4";

export const MarkdownPropsSchema = z.object({
  content: z
    .string()
    .describe(
      "CommonMark markdown; GFM tables, task lists, and links supported. Rendered read-only with the canvas prose styling.",
    ),
  maxHeight: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Max height in pixels; content scrolls beyond it. Omit to show everything."),
});

export const MarkdownDefinition = {
  props: MarkdownPropsSchema,
  slots: [],
  events: [],
  description:
    "USE FOR: a long-form prose section — paragraphs, lists, links, tables — as ONE element instead of stacking 10 Text elements. DO NOT USE FOR: the entire slot (compose real sections with Cards, Metrics, Charts around it), editable documents (use PlanFile), or standalone code (use CodeBlock).",
  example: {
    content:
      "### Why the cache misses happened\n\nThe TTL was set to **30s** while the upstream sync runs every 5 minutes, so between syncs:\n\n1. The first request repopulates the key.\n2. Every request 30s later misses again.\n\nSee `src/api/cache.ts` for the fix.",
  },
};
