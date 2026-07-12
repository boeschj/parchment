export const SlotKind = {
  Plan: "plan",
  Diagram: "diagram",
  Diff: "diff",
  Dashboard: "dashboard",
  Table: "table",
  Report: "report",
  Render: "render",
  App: "app",
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
  name: string;
  summary: string;
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
  repeat?: { statePath: string; key?: string };
  watch?: Record<string, unknown>;
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

// An intent the agent offered on a rendered slot (a canvas.intent binding).
// SECURITY: the daemon records this menu when the spec is pushed and it is the
// only source of intent payloads. The browser submits an opaque id; the daemon
// resolves id -> {id, params} from this map, so a page can never fabricate or
// tamper with an intent — it can only pick from the menu the agent offered.
export type IntentDefinition = {
  id: string;
  params?: Record<string, unknown>;
};

export type IntentMenu = Record<string, IntentDefinition>;

export type Slot = {
  id: string;
  kind: SlotKind;
  status: SlotStatus;
  origin: SlotOrigin;
  title: string;
  spec: JsonRenderSpec;
  state: Record<string, unknown>;
  intentMenu?: IntentMenu;
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
  FormSubmit: "form-submit",
  Intent: "intent",
  FileUpload: "file-upload",
  AppIntent: "app-intent",
  AppPrompt: "app-prompt",
  AppNotify: "app-notify",
  AppModelContext: "app-model-context",
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

// Operations Claude sends a rendered slot. Execution needs a DOM (the slot
// renders through React + the component registry), so the daemon relays ops
// to one browser tab and holds the HTTP request until the tab posts the
// result back under the same requestId.
export type SlotOps = {
  exportPng?: { slotId: string };
};

export type SlotOpsResult = {
  ok: boolean;
  error?: string;
  pngBase64?: string;
  width?: number;
  height?: number;
};

// One JSON Pointer write the daemon's live data engine applied to a slot's
// state. The browser folds these into slot.state; json-render's StateProvider
// diffs the new state object and updates only the touched paths, so live data
// never re-renders the whole spec.
export type SlotStateChange = { path: string; value: unknown };

export type WsEvent =
  | { kind: "snapshot"; data: { sessionId: string; slots: Slot[] } }
  | { kind: "slot-added"; data: Slot }
  | { kind: "slot-updated"; data: Slot }
  | { kind: "slot-removed"; data: { slotId: string } }
  | { kind: "slot-state"; data: { slotId: string; changes: SlotStateChange[] } }
  | { kind: "edit-recorded"; data: Edit }
  | { kind: "reset"; data: { sessionId: string } }
  | { kind: "transcript-snapshot"; data: { entries: TranscriptEntry[] } }
  | { kind: "transcript-append"; data: { entries: TranscriptEntry[] } }
  | { kind: "slot-ops"; data: { requestId: string; ops: SlotOps } };

export type CanvasInjectionPayload = {
  count: number;
  entries: OverlayEntry[];
};

// A saved slot under ~/.parchment/library/<name>.json — the full spec (and
// state, when the slot had any) needed to re-render it later via canvas_library
// (action "load") or the browser's library panel.
export type LibraryEntry = {
  name: string;
  savedAt: number;
  title: string;
  kind: SlotKind;
  spec: JsonRenderSpec;
  state?: Record<string, unknown>;
};

// The lightweight shape the library panel lists — everything a preview card
// needs, without shipping the full spec (which can be large) over the wire.
export type LibraryListing = {
  name: string;
  title: string;
  kind: SlotKind;
  savedAt: number;
  elementCount: number;
};
