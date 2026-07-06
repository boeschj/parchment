import * as z from "zod/v4";

export const FileChangeKind = {
  Created: "created",
  Modified: "modified",
  Deleted: "deleted",
  Renamed: "renamed",
} as const;

const FileChangeKindSchema = z.enum([
  FileChangeKind.Created,
  FileChangeKind.Modified,
  FileChangeKind.Deleted,
  FileChangeKind.Renamed,
]);

export const FileChangePropsSchema = z.object({
  path: z.string().describe("File path after the change, e.g. 'src/api/cache.ts'."),
  kind: FileChangeKindSchema.describe(
    "'created' (A chip), 'modified' (M chip), 'deleted' (D chip, path struck through), 'renamed' (R chip).",
  ),
  additions: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Lines added; renders as a green +N count."),
  deletions: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Lines removed; renders as a red −N count."),
  summary: z
    .string()
    .optional()
    .describe("One line on what changed in this file and why."),
  renamedFrom: z
    .string()
    .optional()
    .describe("Previous path when kind is 'renamed'; renders as 'old → new'."),
});

export const FileChangeDefinition = {
  props: FileChangePropsSchema,
  slots: [],
  events: [],
  description:
    "USE FOR: per-file summaries in PR walkthroughs, change reports, refactor overviews — one element per file, stacked in a Stack with gap 'sm' (usually inside a Card). DO NOT USE FOR: showing the actual code changes (use DiffViewer) or cross-file statistics (use DataTable).",
  example: {
    path: "src/api/cache.ts",
    kind: FileChangeKind.Modified,
    additions: 42,
    deletions: 9,
    summary: "Wrapped read paths in a Redis lookup with a 5m TTL.",
  },
};
