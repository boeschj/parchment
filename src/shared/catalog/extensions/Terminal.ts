import * as z from "zod/v4";

export const TerminalPropsSchema = z.object({
  command: z
    .string()
    .describe("The command exactly as run, without the shell prompt — the component renders the '$'."),
  output: z
    .string()
    .describe(
      "Real captured stdout/stderr, verbatim. Truncate long output yourself with a trailing '…' line. Never fabricate output.",
    ),
  exitCode: z
    .number()
    .int()
    .optional()
    .describe("Process exit code. Shows a green '0' badge or a red nonzero badge in the header."),
  cwd: z
    .string()
    .optional()
    .describe("Working directory the command ran in, e.g. '~/app'. Shown in the header."),
});

export const TerminalDefinition = {
  props: TerminalPropsSchema,
  slots: [],
  events: [],
  description:
    "USE FOR: showing a real command run and its actual output — build results, test invocations, CLI sessions. Always renders on a dark terminal surface in both themes. Only show commands you actually ran and output you actually captured — never invent output. DO NOT USE FOR: code snippets (use CodeBlock) or structured test summaries (use TestResults).",
  example: {
    command: "bun test src/api",
    cwd: "~/parchment",
    exitCode: 0,
    output:
      "✓ cache.test.ts (12 tests) 84ms\n✓ routes.test.ts (9 tests) 112ms\n\n21 pass, 0 fail (196ms)",
  },
};
