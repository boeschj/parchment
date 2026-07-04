export const SlotKind = {
  Plan: "plan",
  Diagram: "diagram",
  Diff: "diff",
  Dashboard: "dashboard",
  Table: "table",
  Report: "report",
  Render: "render",
} as const;

export type SlotKind = (typeof SlotKind)[keyof typeof SlotKind];

export const SlotStatus = {
  Rendering: "rendering",
  Ready: "ready",
  Error: "error",
} as const;

export type SlotStatus = (typeof SlotStatus)[keyof typeof SlotStatus];

export const SlotOrigin = {
  McpTool: "mcp-tool",
  SlashCommand: "slash-command",
  AutoCapture: "auto-capture",
} as const;

export type SlotOrigin = (typeof SlotOrigin)[keyof typeof SlotOrigin];

export const SessionStatus = {
  Working: "working",
  Complete: "complete",
  Blocked: "blocked",
} as const;

export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

export type SessionSummary = {
  sessionId: string;
  cwd: string;
  slotCount: number;
  createdAt: number;
  lastPing: number;
  status: SessionStatus;
};

export type UIElement = {
  type: string;
  props: Record<string, unknown>;
  children?: string[];
  on?: Record<string, ActionBinding | ActionBinding[]>;
  visible?: unknown;
};

export type ActionBinding = {
  action: string;
  params?: Record<string, unknown>;
};

export type JsonRenderSpec = {
  root: string;
  elements: Record<string, UIElement>;
  state?: Record<string, unknown>;
};

export type Slot = {
  id: string;
  kind: SlotKind;
  status: SlotStatus;
  origin: SlotOrigin;
  title: string;
  spec: JsonRenderSpec;
  state: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  errorMessage?: string;
};

export const EditKind = {
  PlanEdit: "plan-edit",
  DiffEdit: "diff-edit",
  MermaidEdit: "mermaid-edit",
  MermaidComment: "mermaid-comment",
  TableEdit: "table-edit",
  GenericEdit: "generic-edit",
} as const;

export type EditKind = (typeof EditKind)[keyof typeof EditKind];

export type EditPayload = Record<string, unknown>;

export type Edit = {
  id: string;
  slotId: string;
  elementId: string | null;
  kind: EditKind;
  payload: EditPayload;
  recordedAt: number;
};

export type OverlayEntry = {
  slotId: string;
  elementId: string | null;
  kind: EditKind;
  payload: EditPayload;
  updatedAt: number;
};

// One parsed line of a Claude Code session JSONL file. The schema is
// undocumented and drifts across versions, so the daemon passes lines
// through untyped and the browser's parser narrows defensively.
export type TranscriptEntry = Record<string, unknown>;

// The shared Excalidraw board. Elements/files use Excalidraw's own JSON
// shapes; the daemon treats them as opaque and persists them verbatim as a
// standard .excalidraw file.
export type BoardScene = {
  elements: unknown[];
  files: Record<string, unknown>;
};

// Operations Claude sends the board. Skeleton elements are Excalidraw's
// LLM-friendly format (convertToExcalidrawElements fills in bindings,
// seeds, text containers); mermaid is the auto-layout cold-start path.
// Conversion needs a DOM, so the daemon relays ops to the browser tab and
// the browser writes the resulting scene back.
export type BoardOps = {
  addSkeletons?: unknown[];
  addMermaid?: string;
  deleteElementIds?: string[];
  exportPng?: boolean;
};

export type BoardOpsResult = {
  ok: boolean;
  error?: string;
  elementCount?: number;
  pngBase64?: string;
};

export type WsEvent =
  | { kind: "snapshot"; data: { sessionId: string; slots: Slot[] } }
  | { kind: "slot-added"; data: Slot }
  | { kind: "slot-updated"; data: Slot }
  | { kind: "slot-removed"; data: { slotId: string } }
  | { kind: "edit-recorded"; data: Edit }
  | { kind: "reset"; data: { sessionId: string } }
  | { kind: "transcript-snapshot"; data: { entries: TranscriptEntry[] } }
  | { kind: "transcript-append"; data: { entries: TranscriptEntry[] } }
  | { kind: "board-updated"; data: { clientId: string | null } }
  | { kind: "board-ops"; data: { requestId: string; ops: BoardOps } };

export type CanvasInjectionPayload = {
  count: number;
  entries: OverlayEntry[];
};
