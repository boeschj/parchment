import * as z from "zod/v4";

export const MermaidCommentSchema = z.object({
  nodeId: z.string().describe("ID of the mermaid node the comment is anchored to (the bare id, e.g. 'auth-service' not 'flowchart-auth-service-1')."),
  body: z.string().describe("Comment text. Markdown supported."),
});

export const MermaidEditorPropsSchema = z.object({
  title: z.string().optional(),
  source: z.string().describe("Mermaid diagram source. Do NOT wrap in ```mermaid ``` fences — emit the raw source."),
  editable: z.boolean().optional().describe("If true (default), source is editable in a CodeMirror pane next to the live render, and user comments on individual nodes flow back."),
  comments: z.array(MermaidCommentSchema).optional().describe("Pre-existing comments to display on specific nodes."),
});

export const MermaidEditorDefinition = {
  props: MermaidEditorPropsSchema,
  description: "Editable mermaid diagram with side-by-side source pane and live render. The user can click any node to leave a comment, and edits to the source flow back via UserPromptSubmit. Use for architecture diagrams, sequence diagrams, state machines, ER diagrams, gantts.",
} as const;
