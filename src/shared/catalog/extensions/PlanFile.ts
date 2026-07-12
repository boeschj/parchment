import * as z from "zod/v4";

export const PlanFilePropsSchema = z.object({
  title: z.string().optional().describe("Heading above the editor; omit if a wrapping Card has a title."),
  markdown: z.string().describe("Plan content in CommonMark markdown; keep under ~4KB."),
  editable: z
    .boolean()
    .optional()
    .describe("Default true. Tiptap WYSIWYG; edited markdown flows back next turn."),
});

export const PlanFileDefinition = {
  props: PlanFilePropsSchema,
  slots: [],
  events: ["change", "submit"],
  description:
    "USE FOR: short-to-medium editable markdown the user will refine in place — plans, design docs, briefs, READMEs, /plan outputs. DO NOT USE FOR: code (use DiffViewer), diagrams (use MermaidEditor), tabular data (use DataTable), or long-form mixed-content reports (use canvas_render with composed shadcn). Edits debounce ~300ms and arrive in your next turn as a <canvas-edit kind=\"plan-edit\"> block.",
  example: {
    title: "Implementation plan",
    markdown:
      "## Goal\nAdd write-through caching to the API.\n\n## Steps\n1. Add Redis client.\n2. Wrap read paths in cache lookup.\n3. Invalidate on writes.\n\n## Open questions\n- TTL for user profile cache?",
    editable: true,
  },
};
