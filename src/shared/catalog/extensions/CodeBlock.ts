import * as z from "zod/v4";

export const CodeBlockPropsSchema = z.object({
  code: z.string().describe("The code to display, verbatim. Newlines separate lines."),
  language: z
    .string()
    .optional()
    .describe(
      "Language for syntax highlighting: 'typescript', 'python', 'go', 'rust', 'sql', 'shell', 'json', 'yaml', … Short aliases like 'ts' / 'py' work. Omit to infer from the title's file extension.",
    ),
  title: z
    .string()
    .optional()
    .describe("Header label, usually the file path: 'src/api/cache.ts'."),
  highlightLines: z
    .array(z.number().int())
    .optional()
    .describe(
      "Displayed line numbers to emphasize with a gold accent. 1-based, relative to the displayed numbering — if startLine is 40, pass 42 to highlight the third line.",
    ),
  startLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("First displayed line number. Default 1. Set when showing an excerpt from the middle of a file."),
  maxHeight: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Max height in pixels; the code scrolls beyond it. Omit to show everything."),
});

export const CodeBlockDefinition = {
  props: CodeBlockPropsSchema,
  slots: [],
  events: [],
  description:
    "USE FOR: showing any multi-line code snippet — implementations, configs, examples, excerpts — with syntax highlighting, line numbers, and copy-to-clipboard. DO NOT USE: Text variant=code (that's for inline identifiers only), DiffViewer (that's for before/after comparisons), Terminal (that's for command runs).",
  example: {
    title: "src/api/cache.ts",
    language: "typescript",
    startLine: 12,
    highlightLines: [14, 15],
    code: "export async function getCached(key: string): Promise<string | null> {\n  const hit = await redis.get(key);\n  if (hit !== null) return hit;\n  return fetchAndCache(key);\n}",
  },
};
