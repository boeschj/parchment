---
name: canvas-tools
description: When and how to use the clawd-canvas MCP tools (canvas_plan, canvas_diagram, canvas_diff, canvas_table, canvas_render, canvas_close) to surface rich content in the user's browser canvas instead of dumping it into the terminal. Use whenever you have a plan, code change, diagram, dashboard, dataset, or composed UI that would benefit from being read or edited in a browser.
---

# Canvas tools — the rich-UI side-channel

clawd-canvas adds an HTML canvas you can push content into via MCP tools. The user opens a browser tab from a clickable URL in their status line, sees what you push live, can edit certain widgets in place, and their edits flow back into your next turn automatically.

**The terminal stays the chat.** The canvas is for things that don't read well as ASCII: plans you want the user to refine, diffs you want them to review before applying, diagrams, dashboards, tables, mixed-content reports.

## When to use which tool

| User want / your situation | Tool | Why |
|---|---|---|
| You wrote a multi-step plan | `canvas_plan` | Tiptap WYSIWYG; the user edits and you see the edited markdown on the next turn |
| You're proposing a code change | `canvas_diff` | Monaco diff with editable "after" side; user refines before applying |
| You're sketching architecture / flow / sequence / state | `canvas_diagram` | Mermaid editor with side-by-side source + live render; user can comment on nodes |
| Query results / schedules / line items | `canvas_table` | Sortable, CSV-exportable; optionally inline-editable |
| Bank statements / metrics / AWS data — anything dashboardy | `canvas_render` with `kind: "dashboard"` | Compose shadcn Card + Heading + Chart + Metric freely |
| Long-form report mixing prose + table + chart | `canvas_render` with `kind: "report"` | Composed json-render spec across catalog |
| Any composed UI that doesn't fit a shortcut | `canvas_render` with `kind: "render"` | Full catalog (36 shadcn + 5 extensions); validated against catalog Zod schema |
| Slot is no longer relevant | `canvas_close` | Removes the tab from the user's canvas |

## When NOT to use

- A 1–3 sentence reply. Terminal handles those.
- A short code snippet. Terminal renders fences fine.
- Background reasoning the user doesn't need to see. Keep that in your turn.
- Anything time-sensitive the user reads inline (e.g. "running tests…"). The canvas requires the user to look at the browser tab.

If you're unsure, default to the terminal. The canvas is for things worth opening a tab for.

## Quick reference

### `canvas_plan`
```json
{
  "title": "OAuth rollout plan",
  "props": { "markdown": "# OAuth rollout\n\n1. Add provider config\n2. ...", "editable": true }
}
```
User's WYSIWYG edits return on your next turn as `<canvas-edit kind="plan-edit" slot="..." element="plan">{...}</canvas-edit>`.

### `canvas_diff`
```json
{
  "title": "Refactor: extract helper",
  "props": {
    "file": "src/users/handler.ts",
    "before": "...current source...",
    "after": "...proposed source...",
    "editableSide": "after"
  }
}
```
User's tweaks to the "after" side return as `<canvas-edit kind="diff-edit">{file, side: "after", content}</canvas-edit>`. Apply via the `Edit` tool only after seeing the edit (or with the user's explicit go-ahead).

### `canvas_diagram`
```json
{
  "title": "Login flow",
  "props": {
    "source": "sequenceDiagram\n  actor User\n  User->>API: POST /login\n  API->>DB: SELECT user\n  DB-->>API: row\n  API-->>User: JWT",
    "editable": true
  }
}
```
- Do NOT wrap in ` ```mermaid ` fences — emit raw mermaid source.
- User comments on nodes come back as `<canvas-edit kind="mermaid-comment">{nodeId, body}</canvas-edit>`.
- Source edits as `<canvas-edit kind="mermaid-edit">{source}</canvas-edit>`.

### `canvas_table`
```json
{
  "title": "Slow queries (last 24h)",
  "props": {
    "columns": [
      {"key": "query", "header": "Query"},
      {"key": "p99", "header": "p99 (ms)", "type": "number", "align": "right"},
      {"key": "calls", "header": "Calls", "type": "number", "align": "right"}
    ],
    "rows": [
      {"query": "SELECT * FROM orders ...", "p99": 1240, "calls": 8421},
      {"query": "SELECT u.* FROM users u JOIN ...", "p99": 980, "calls": 5102}
    ],
    "caption": "From pg_stat_statements",
    "editable": false
  }
}
```

### `canvas_render` (full catalog)
Use to compose shadcn + extension components freely. The `spec` must be a json-render spec validated against the canvas catalog (41 components). See the @json-render/core and @json-render/shadcn skills for the catalog schema details.

Dashboard example:
```json
{
  "title": "Stripe usage",
  "kind": "dashboard",
  "spec": {
    "root": "page",
    "elements": {
      "page": {"type": "Stack", "props": {"gap": "lg"}, "children": ["title", "grid"]},
      "title": {"type": "Heading", "props": {"text": "Stripe usage — last 30 days", "level": "h2"}},
      "grid":  {"type": "Grid", "props": {"columns": 3, "gap": "md"}, "children": ["card1", "card2", "chart"]},
      "card1": {"type": "Card", "props": {"title": "Revenue", "description": "$48,210 (▲ 12%)"}},
      "card2": {"type": "Card", "props": {"title": "MRR", "description": "$5,800 (▲ 4%)"}},
      "chart": {"type": "Chart", "props": {
        "kind": "line",
        "data": [{"d": "2026-04-27", "rev": 1200}, {"d": "2026-04-28", "rev": 1310}, {"d": "2026-04-29", "rev": 980}],
        "x": "d",
        "y": "rev"
      }}
    }
  }
}
```

## The round-trip: reading `<canvas-edit>` blocks

On your next turn, the user's message may be prepended by a block like:

```
<canvas-state>
The user interacted with the canvas. Treat the following as authoritative
current state for each item, overriding anything in your transcript:

<canvas-edit kind="plan-edit" slot="slot_abc" element="plan">
{"markdown":"# OAuth rollout\n\n1. Add provider config (use Auth.js)\n2. ..."}
</canvas-edit>

<canvas-edit kind="diff-edit" slot="slot_def" element="after">
{"file":"src/users/handler.ts","side":"after","content":"...the user's refined code..."}
</canvas-edit>

<canvas-edit kind="mermaid-comment" slot="slot_ghi" element="node:auth-service">
{"nodeId":"auth-service","body":"this should also call the audit log"}
</canvas-edit>
</canvas-state>
```

Read these as the user's intent. The plan/diff/diagram content in the block is the authoritative current state — your prior transcript memory of these artifacts is stale.

If a `<canvas-edit kind="diff-edit">` arrives, you generally want to apply the user's `content` to the actual file via the `Edit` or `Write` tool (with the user's permission if needed).

If a `<canvas-edit kind="plan-edit">` arrives, treat the markdown as the current plan and act on it.

## Slot lifecycle

- Each `canvas_*` call creates or replaces a slot. Pass `slotId` to update an existing slot in place; omit to allocate a new one.
- Slots persist until the user closes them or until you call `canvas_close(slotId)` after the slot is no longer relevant.
- The user can also clear all slots via the canvas's "Clear canvas" button.
- Auto-captured plans (from your `ExitPlanMode` calls) appear as `origin: auto-capture` slots — same shape as the ones you push explicitly.

## Anti-patterns

- ❌ Don't mirror every assistant message to the canvas. The terminal is the chat; only push the rich stuff.
- ❌ Don't push the same content twice in a row. If you're updating a previous artifact, pass the prior `slotId` to replace it in place.
- ❌ Don't wrap mermaid source in ` ```mermaid ` fences — the `MermaidEditor` component expects raw source.
- ❌ Don't ignore `<canvas-edit>` blocks in the user's message — they ARE the user's edits, not a system notification.
