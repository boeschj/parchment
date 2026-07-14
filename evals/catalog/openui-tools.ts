// OPENUI LANG'S CONTENT-AVOIDANCE MECHANISM, AND WHY IT GETS ONE.
//
// The whole thesis of parchment's ladder is that a component which lets the model
// NAME data beats one that makes it CARRY the data. It would be very convenient
// for us if no rival had such a mechanism. OpenUI Lang does.
//
// `Query(tool, args, defaults, refreshSeconds?)` is a first-class statement form
// in their shipped grammar (`RESERVED_CALLS = { Query, Mutation }`,
// packages/lang-core/src/parser/builtins.ts). It is executed by the HOST — the
// app supplies a `toolProvider` and the runtime calls
// `toolProvider.callTool(name, args)` (runtime/queryManager.ts) — and its result
// is plucked straight into a component's props (`Table([Col("Title",
// data.rows.title)])`, their queries-mutations doc). Their own generated prompt
// does not merely permit this, it MANDATES it:
//
//     "Use Query() for READ operations (data that should stay live) — NEVER
//      hardcode tool results as literal arrays or objects"
//
// So OpenUI Lang can name a file and have someone else fetch it, exactly as
// parchment can. Denying it that — by handing it a toolless prompt, which is
// precisely what their own checked-in benchmarks/system-prompt.txt does — would
// have manufactured our win. It gets the tools.
//
// THE TOOLS ARE PARCHMENT'S OWN HYDRATORS, ONE FOR ONE. Each maps to exactly one
// reference expression (src/shared/expressions.ts), so an OpenUI Query resolves
// through the SAME daemon, against the SAME fixture files, to the SAME bytes that
// a parchment <GitDiff> resolves to. Neither format is doing work the other is
// spared. The only thing being compared is what each has to EMIT to ask for it.
//
// What this arm therefore measures — and it is the honest question — is not
// "does parchment have a mechanism nobody else has", because that is false. It is
// "how many tokens does each format spend to use the mechanism".

import { ReferenceExpressionKey } from "../../src/shared/expressions.ts";

// The tool a Query names, and the reference expression it lowers to. The adapter
// (evals/render/openui.ts) reads this table, so a tool advertised in the prompt
// that no reference can resolve is impossible: the type says the mapping exists.
export const OpenUiToolName = {
  ReadCsv: "read_csv",
  GitDiff: "git_diff",
  LogSeries: "log_series",
  ReadFile: "read_file",
} as const;

export type OpenUiToolName = (typeof OpenUiToolName)[keyof typeof OpenUiToolName];

// The Query argument that carries the PATH, and the reference key it becomes.
// Every other Query argument travels through to the reference as a sibling option
// — which is the same "options sit beside the $-key" convention the daemon's own
// grammar uses, so nothing is invented here.
export type OpenUiToolContract = {
  readonly pathArg: string;
  readonly referenceKey: ReferenceExpressionKey;
  // Query args that become reference options. Anything else the model passes is
  // dropped, exactly as the daemon would drop it.
  readonly optionArgs: readonly string[];
};

export const OPENUI_TOOL_CONTRACTS = {
  [OpenUiToolName.ReadCsv]: {
    pathArg: "path",
    referenceKey: ReferenceExpressionKey.Csv,
    optionArgs: ["limit"],
  },
  [OpenUiToolName.GitDiff]: {
    pathArg: "file",
    referenceKey: ReferenceExpressionKey.Diff,
    optionArgs: ["base", "staged"],
  },
  [OpenUiToolName.LogSeries]: {
    pathArg: "file",
    referenceKey: ReferenceExpressionKey.Log,
    optionArgs: ["groupBy", "match", "parser", "pattern", "series", "metric"],
  },
  [OpenUiToolName.ReadFile]: {
    pathArg: "path",
    referenceKey: ReferenceExpressionKey.File,
    optionArgs: ["lines"],
  },
} as const satisfies Record<OpenUiToolName, OpenUiToolContract>;

// ---- The tools as OpenUI's prompt generator wants them ------------------------
//
// ToolSpec (their type): { name, description, inputSchema, outputSchema }. Their
// generator renders these into "## Available Tools" as
// `- read_csv(path: string) → {rows?: object[], columns?: string[]}` plus a
// "Default values for Query results" block. We supply the schemas; every word of
// the section around them is theirs.

const STRING_PROPERTY = { type: "string" } as const;

export const OPENUI_TOOL_SPECS = [
  {
    name: OpenUiToolName.ReadCsv,
    // The second sentence is here because its ABSENCE cost this arm a repair turn
    // in a smoke run, and the cost was ours, not its format's.
    //
    // parchment's own high-fidelity prompt carries a hydration note — "the daemon
    // reads the file, infers the columns from its header, and fills rows and
    // columns; omit them" — so its model knows not to invent column labels. OpenUI
    // was told only that the tool RETURNS columns. Its first artifact duly used
    // Query() for the rows (it climbed the ladder perfectly) and then hand-wrote
    // prettified headers — "Run ID" for `run_id` — and failed the rubric's check
    // for the file's real column names.
    //
    // That is an information asymmetry in the PROMPT, not a difference between the
    // formats, and publishing the repair turn it caused would have been publishing
    // our own omission as OpenUI's weakness. The same fact, in OpenUI's own idiom.
    description:
      "Read a CSV file from disk. Returns every one of its data rows, and its column names taken " +
      "from the header — pass those columns to the table rather than writing your own labels.",
    inputSchema: {
      type: "object",
      properties: { path: { ...STRING_PROPERTY, description: "Path to the CSV file." } },
      required: ["path"],
    },
    outputSchema: {
      type: "object",
      properties: {
        rows: { type: "array", items: { type: "object" } },
        columns: { type: "array", items: STRING_PROPERTY },
      },
    },
  },
  {
    name: OpenUiToolName.GitDiff,
    description:
      "Run a git diff of one file against a revision. Returns the file's full text on both sides of the change.",
    inputSchema: {
      type: "object",
      properties: {
        file: { ...STRING_PROPERTY, description: "Path of the file to compare." },
        base: { ...STRING_PROPERTY, description: "Revision to compare against, e.g. 'HEAD~1'." },
      },
      required: ["file"],
    },
    outputSchema: {
      type: "object",
      properties: { file: STRING_PROPERTY, before: STRING_PROPERTY, after: STRING_PROPERTY },
    },
  },
  {
    name: OpenUiToolName.LogSeries,
    description:
      "Read a log file, keep the lines matching a regular expression, bucket them over time, and count them. Returns the plotted points and the keys of the x and y axes.",
    inputSchema: {
      type: "object",
      properties: {
        file: { ...STRING_PROPERTY, description: "Path of the log file." },
        groupBy: { ...STRING_PROPERTY, description: "Time bucket, e.g. '10m', '1h'." },
        match: { ...STRING_PROPERTY, description: "Keep only lines matching this regex, e.g. 'ERROR'." },
        metric: { ...STRING_PROPERTY, description: "Value per bucket: 'count' (default), 'rate', or 'p95:field'." },
      },
      required: ["file", "groupBy"],
    },
    outputSchema: {
      type: "object",
      properties: {
        data: { type: "array", items: { type: "object" } },
        x: STRING_PROPERTY,
        y: STRING_PROPERTY,
      },
    },
  },
  {
    name: OpenUiToolName.ReadFile,
    description: "Read a source file from disk. Returns its text, optionally just the requested line range.",
    inputSchema: {
      type: "object",
      properties: {
        path: { ...STRING_PROPERTY, description: "Path to the file." },
        lines: { ...STRING_PROPERTY, description: "Line range to keep, e.g. '40-80'. Omit for the whole file." },
      },
      required: ["path"],
    },
    outputSchema: { type: "object", properties: { code: STRING_PROPERTY } },
  },
] as const;
