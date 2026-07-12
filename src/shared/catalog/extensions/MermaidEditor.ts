import * as z from "zod/v4";

export const MermaidTheme = {
  Default: "default",
  Base: "base",
  Dark: "dark",
  Forest: "forest",
  Neutral: "neutral",
} as const;

export const MermaidCommentSchema = z.object({
  nodeId: z
    .string()
    .describe(
      "ID of the mermaid node the comment is anchored to (the bare id, e.g. 'auth-service' not 'flowchart-auth-service-1').",
    ),
  body: z.string().describe("Comment text. Markdown supported."),
});

export const MermaidEditorPropsSchema = z.object({
  title: z.string().optional(),
  source: z
    .string()
    .describe(
      "Mermaid diagram source. Do NOT wrap in ```mermaid fences — emit the raw source. For line breaks inside node labels use <br/> (NOT \\n which mermaid 11 parses as a statement separator and crashes).",
    ),
  editable: z
    .boolean()
    .optional()
    .describe(
      "Default false. When true, the source is editable in a textarea next to the live render, and clicking any node lets the user leave a comment. The canvas_diagram tool sets this true for the standalone editable diagram; leave it unset when embedding a diagram inside a canvas_render report/dashboard so it renders as a clean, full-width, display-only diagram.",
    ),
  showSource: z
    .boolean()
    .optional()
    .describe(
      "Whether to show the mermaid source pane alongside the render. Defaults to match `editable` (source shown only when editable). Set false to render the diagram alone at full width — the right choice for diagrams embedded in a report or dashboard.",
    ),
  comments: z
    .array(MermaidCommentSchema)
    .optional()
    .describe(
      "Pre-existing comments to display anchored to specific nodes. New comments the user adds flow back via the canvas.commentMermaid action.",
    ),
  theme: z
    .enum([
      MermaidTheme.Default,
      MermaidTheme.Base,
      MermaidTheme.Dark,
      MermaidTheme.Forest,
      MermaidTheme.Neutral,
    ])
    .optional()
    .describe(
      "Mermaid render theme. Defaults to 'base' (matches the canvas surface). Also flows into the 'Open in Mermaid Live' handoff.",
    ),
});

export const MermaidEditorDefinition = {
  props: MermaidEditorPropsSchema,
  slots: [],
  events: ["change", "comment"],
  description:
    "USE FOR: architecture diagrams, sequence diagrams, state machines, ER diagrams, gantt charts, flowcharts. Renders an editable mermaid diagram with side-by-side source + live render. The user can click any node to leave a comment, and source edits flow back to your next turn as a <canvas-edit kind=\"mermaid-edit\"> block; node comments arrive as <canvas-edit kind=\"mermaid-comment\">. DO NOT USE FOR: tabular data (use DataTable), code (use DiffViewer).",
  example: {
    title: "OAuth login flow",
    source:
      "sequenceDiagram\n  actor User\n  participant App\n  participant Auth\n  User->>App: click 'Login'\n  App->>Auth: redirect /authorize\n  Auth-->>User: consent screen\n  User->>Auth: approve\n  Auth-->>App: callback with code\n  App->>Auth: POST /token\n  Auth-->>App: JWT",
    editable: true,
  },
};
