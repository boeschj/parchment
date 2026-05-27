import * as z from "zod/v4";

export const DiffEditableSide = {
  After: "after",
  Both: "both",
  None: "none",
} as const;

export const DiffViewerPropsSchema = z.object({
  file: z.string().describe("Path of the file being diffed. Used as the diff title and for language auto-detection from extension."),
  before: z.string().describe("Original content (left side)."),
  after: z.string().describe("Modified content (right side)."),
  language: z.string().optional().describe("Monaco language id (typescript, python, etc.). If omitted, inferred from `file` extension."),
  editableSide: z.enum([DiffEditableSide.After, DiffEditableSide.Both, DiffEditableSide.None]).optional().describe("Which side is editable. Default 'after' — user can refine your proposed change before it lands."),
});

export const DiffViewerDefinition = {
  props: DiffViewerPropsSchema,
  description: "Side-by-side code diff in a Monaco editor with syntax highlighting. Use whenever you're proposing a code change the user should be able to review and tweak before applying. The 'after' side is editable by default and the edit flows back to your next turn.",
} as const;
