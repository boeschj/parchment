import * as z from "zod/v4";

export const PlanFilePropsSchema = z.object({
  title: z.string().optional(),
  markdown: z.string().describe("Plan content in markdown. Headings, lists, fenced code, tables are all supported."),
  editable: z.boolean().optional().describe("If true (default), the user can edit in a Tiptap WYSIWYG editor and edits flow back via UserPromptSubmit."),
});

export const PlanFileDefinition = {
  props: PlanFilePropsSchema,
  description: "Tiptap-WYSIWYG markdown plan file. Use for `/plan` outputs, design docs, multi-step plans, anything where the user should be able to refine the markdown in-place.",
} as const;
