import * as z from "zod/v4";

export const DiffEditableSide = {
  After: "after",
  Both: "both",
  None: "none",
} as const;

const DiffEditableSideSchema = z.enum([
  DiffEditableSide.After,
  DiffEditableSide.Both,
  DiffEditableSide.None,
]);

export const DiffViewerPropsSchema = z.object({
  file: z
    .string()
    .describe(
      "Path of the file being diffed. Used as the diff title and for language auto-detection from extension (.ts → typescript, .py → python, etc.).",
    ),
  before: z
    .string()
    .describe(
      "Original content (left side). Keep file size reasonable (~50KB max) — Monaco handles large files but UX degrades.",
    ),
  after: z
    .string()
    .describe(
      "Modified content (right side). User-editable by default; their tweaks flow back to your next turn.",
    ),
  language: z
    .string()
    .optional()
    .describe(
      "Override Monaco's auto-detected language. Use one of the standard Monaco language ids (typescript, javascript, python, go, rust, ...).",
    ),
  editableSide: DiffEditableSideSchema.optional().describe(
    "Which side is user-editable. Default 'after' — user refines your proposed change before it lands. Use 'none' to render a read-only diff. Use 'both' for collaborative edit-merge.",
  ),
});

export const DiffViewerDefinition = {
  props: DiffViewerPropsSchema,
  slots: [],
  events: ["change"],
  description:
    "USE FOR: proposing a code change the user should review and tweak before applying. Renders a side-by-side Monaco diff with the 'after' side editable by default. The user's refinements arrive in your next turn as a <canvas-edit kind=\"diff-edit\"> block — typically you'll then apply the user's content to the actual file via Edit/Write. DO NOT USE FOR: showing existing code without proposing a change (use a shadcn Code block); for prose changes (use PlanFile).",
  example: {
    file: "src/users/handler.ts",
    before:
      "export function getUser(id: string) {\n  return db.users.find({ id });\n}",
    after:
      "export async function getUser(id: string): Promise<User | null> {\n  const user = await db.users.findOne({ id });\n  return user ?? null;\n}",
    editableSide: DiffEditableSide.After,
  },
};
