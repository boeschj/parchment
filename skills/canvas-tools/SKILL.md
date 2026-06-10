---
name: canvas-tools
description: When and how to use the clawd-canvas MCP tools to surface rich content in the user's browser canvas instead of dumping markdown into the terminal. The canvas is for COMPOSED generative UI (shadcn components + canvas extensions), not for "render this markdown" — use canvas_render with a real layout, not canvas_plan as a markdown viewer.
---

# Canvas tools — generative UI, not markdown viewer

clawd-canvas adds an HTML canvas you push content into via MCP tools. The user opens a browser tab from a clickable URL in their statusline, and you can compose rich, interactive UIs there — far better than ASCII in the terminal.

**Hard rule**: the canvas is for COMPOSED generative UI, not for displaying long markdown. If you're tempted to wrap a 1500-word analysis in `canvas_plan` because "it accepts markdown" — STOP. That's `canvas_render` with a composed layout. `canvas_plan` is a single editable textarea, not a layout primitive.

---

## Decision tree (read this every time)

| User said / your situation | Tool | Why |
|---|---|---|
| **"diagram" / "flow" / "architecture" / "sequence" / "state machine"** | `canvas_diagram` (raw mermaid source) | Editable mermaid with side-by-side source + render + click-to-comment |
| **"render the diff" / proposing a code change** | `canvas_diff` (before/after + file) | Monaco side-by-side, "after" side editable; edits flow back |
| **Tabular data: query results, schedules, line items, anything with columns × rows** | `canvas_table` (columns + rows) | Sortable, CSV export, optional inline edit |
| **"plan to add X" — a SHORT (≤300 words) markdown plan the user will rewrite** | `canvas_plan` (markdown) | Tiptap WYSIWYG; the user iterates on the exact wording |
| **Analysis / report / investigation / architecture writeup / dashboard / "explain X" / anything with >300 words of content or that mixes prose + tables + diagrams + metrics** | **`canvas_render`** (composed spec) | Default. Compose Stack + Heading + Text + Card + MermaidEditor + DataTable + Chart |
| **Slot is no longer relevant** | `canvas_close(slotId)` | Cleans up the user's tab strip |

**The trap**: when content is "mostly markdown text," the path of least resistance is `canvas_plan`. **Do not take that path.** A markdown blob in a textarea is not generative UI — it's a markdown viewer with extra steps. The whole point of the canvas is to compose shadcn components into real layouts.

---

## When to use `canvas_render` (which is most of the time)

Default to `canvas_render` for any content that has structure beyond "one short editable paragraph." Compose the layout from these primitives:

**Layout**: `Stack` (vertical/horizontal), `Grid` (columns), `Separator`, `Tabs`, `Accordion`

**Containers**: `Card` (title + description + body), `Dialog`, `Alert`

**Content**: `Heading` (h1–h4), `Text` (paragraph), `Badge`, `Avatar`, `Image`

**Rich widgets** (canvas extensions): `MermaidEditor` (for any diagram), `DiffViewer` (for code changes), `DataTable` (for tabular), `Chart` (for metrics), `PlanFile` (only as a child element inside a larger composition where one section happens to be an editable plan)

### Layout rules of thumb (ALWAYS follow)

- **Metric/stat tiles** (4–8 small cards, one stat each) → wrap in **`Grid` columns:3 or :4**, NEVER `Stack`. Vertical-stacked full-width cards for a row of stats looks terrible.
- **Top-level page structure** → outer `Stack` (`gap: "lg"`), one Heading element first, then content sections.
- **Section blocks of mixed content** (heading + paragraph + sub-Cards) → wrap each section in a `Card` with `title`/`description`, put the body in `children`.
- **Comparing/grouping things** (subsystems, options, features) → **`Grid` columns:2 or :3** with each item as a `Card`. Not Stack.
- **Status banners** (TL;DR, success, warning, error) → `Alert` with `variant: "default" | "destructive"` and a clear `title` + `description`.
- **Badge clusters** (tags, status chips) → horizontal `Stack` (`direction: "horizontal"`, `gap: "sm"`) of `Badge`s.

Bad pattern (looks like 1995 HTML):
```
Stack(vertical) → Card → Card → Card → Card  ← 4 full-width stacked metric cards
```

Good pattern:
```
Stack(vertical) →
  Heading
  Grid(columns: 4) → Card · Card · Card · Card    ← metric tiles, fit in one row
  Chart
  DataTable
```

### Example: architecture report (NOT a canvas_plan dump)

User: *"explain the architecture of this repo"*

✅ Correct — `canvas_render` with `kind: "report"`:
```json
{
  "title": "clawd-canvas architecture",
  "kind": "report",
  "spec": {
    "root": "report",
    "elements": {
      "report":     {"type": "Stack",   "props": {"gap": "lg"}, "children": ["title", "tldr", "diagram", "subsystems", "risks"]},
      "title":      {"type": "Heading", "props": {"text": "clawd-canvas — architecture", "level": "h1"}},
      "tldr":       {"type": "Alert",   "props": {"title": "TL;DR", "description": "Claude pushes UI specs via MCP tools; daemon stores them; browser renders via @json-render/react; edits flow back via UserPromptSubmit hook."}},
      "diagram":    {"type": "MermaidEditor", "props": {"source": "flowchart LR\n  CC[Claude Code]-->|MCP|MCP[mcp-stdio.ts]\n  MCP-->|HTTP|D[Bun daemon]\n  D-->|WS|B[Browser SPA]\n  B-->|POST /edits|D\n  D-->|injection|CC", "title": "Process flow", "editable": true}},
      "subsystems": {"type": "Grid",    "props": {"columns": 2, "gap": "md"}, "children": ["sub-mcp", "sub-daemon", "sub-browser", "sub-cli"]},
      "sub-mcp":    {"type": "Card",    "props": {"title": "MCP server",  "description": "src/daemon/mcp-stdio.ts — 6 canvas_* tools over stdio."}},
      "sub-daemon": {"type": "Card",    "props": {"title": "Daemon",      "description": "src/daemon/server.ts — Bun.serve with HTTP + WebSocket."}},
      "sub-browser":{"type": "Card",    "props": {"title": "Browser SPA", "description": "src/browser/ — React 19 + Vite + @json-render/react."}},
      "sub-cli":    {"type": "Card",    "props": {"title": "CLI + hooks", "description": "src/cli/, hooks/, scripts/statusline.sh — install + lifecycle."}},
      "risks":      {"type": "Alert",   "props": {"variant": "warning", "title": "Risks", "description": "Hook coupling is brittle. Slot ids non-deterministic without slotId. Mermaid source must be raw."}}
    }
  }
}
```

❌ Wrong — `canvas_plan` with the whole writeup as markdown. The user gets a markdown editor full of text instead of an interactive layout where they can click the diagram nodes, see the structured cards, and visually scan the four subsystems.

### Example: dashboard

User: *"show me revenue + active users for the last 30 days"*

✅ `canvas_render` with `kind: "dashboard"`:
```json
{
  "title": "Last 30 days",
  "kind": "dashboard",
  "spec": {
    "root": "dash",
    "elements": {
      "dash":  {"type": "Stack", "props": {"gap": "lg"}, "children": ["row1", "chart"]},
      "row1":  {"type": "Grid",  "props": {"columns": 2, "gap": "md"}, "children": ["c1", "c2"]},
      "c1":    {"type": "Card",  "props": {"title": "Revenue", "description": "$48,210 (▲ 12%)"}},
      "c2":    {"type": "Card",  "props": {"title": "Active users", "description": "1,234 (▲ 4%)"}},
      "chart": {"type": "Chart", "props": {"kind": "line", "data": [{"d": "2026-04-28", "v": 1200}, {"d": "2026-04-29", "v": 1310}], "x": "d", "y": "v", "title": "Daily revenue"}}
    }
  }
}
```

---

## When `canvas_plan` IS the right tool

ONLY when: the user explicitly asked for a plan they will refine, AND it's short (≤300 words), AND the user's edits to the wording are the load-bearing part of the interaction.

Examples:
- *"draft a 3-step plan for adding caching to my API"* → ✅ canvas_plan
- *"give me a quick plan for the Q3 launch"* → ✅ canvas_plan
- *"explain the architecture"* → ❌ NOT canvas_plan (use canvas_render)
- *"summarize this investigation"* → ❌ NOT canvas_plan (use canvas_render)
- *"render this markdown"* → ❌ NOT canvas_plan (use canvas_render)

---

## Reading edit blocks on your next turn

When the user has edited something in the canvas, their next message will be prepended with:

```
<canvas-state>
... <canvas-edit kind="plan-edit" slot="..." element="plan">{"markdown": "..."}</canvas-edit>
... <canvas-edit kind="diff-edit" slot="..." element="after">{"file": "...", "content": "..."}</canvas-edit>
... <canvas-edit kind="mermaid-edit" slot="...">{"source": "..."}</canvas-edit>
... <canvas-edit kind="mermaid-comment" slot="..." element="node:...">{"nodeId": "...", "body": "..."}</canvas-edit>
... <canvas-edit kind="table-edit" slot="..." element="row:N:col">{"rowIndex": N, "columnKey": "...", "value": "..."}</canvas-edit>
</canvas-state>
```

These are AUTHORITATIVE current state. Read them as the user's intent. For `diff-edit`, apply the user's `content` to the actual file via `Edit` or `Write` (with permission). For `plan-edit` / `mermaid-edit` / `table-edit`, the content in the block IS the current truth — your in-transcript memory of the artifact is stale.

---

## Mermaid quoting (easy to get wrong)

When embedding mermaid in a `canvas_diagram` source or a `MermaidEditor` element inside `canvas_render`, **the source is a single string** (not a multi-line YAML/code-fence). Two things break diagrams:

1. **Line breaks inside node labels.** Use `<br/>` (mermaid 11 supports this) — NOT `\n`. A JSON `"\n"` becomes a literal newline character which mermaid parses as a statement separator and crashes.
   ```
   ✅ MCP["src/daemon/mcp-stdio.ts<br/>6 canvas_* tools"]
   ❌ MCP["src/daemon/mcp-stdio.ts\n6 canvas_* tools"]    ← parse error on line 2
   ```
2. **No fences.** Do NOT wrap the source in ` ```mermaid ` — emit raw mermaid syntax. `MermaidEditor` parses the prop directly.

Statement separators between nodes/edges should be actual newlines in the JSON string (encoded as `\n` in the JSON, which IS what you want at the statement level). Just not inside `["..."]` labels.

---

## Design like a professional (the bar for every render)

You decide when the canvas earns a render — anything richer than a one-liner usually does. But when the user explicitly asks for a UI ("visualize this", "make me a dashboard", "show me the logs"), the bar is a professional designer's output, not a data dump:

- **Hierarchy first**: one Heading, a TL;DR Alert or stat row answering the question at a glance, then supporting detail. The user should get the answer in 2 seconds and the evidence below it.
- **Pick the chart for the question**: trends over time → line/area; comparisons → bar; never a pie for more than 4 slices. Tables carry detail; charts carry the point.
- **Density discipline**: 4-up Grid for stats, 2-up for comparisons, full-width only for tables and charts.
- **Label with the user's vocabulary** — route names, file paths, env names from THIS conversation, not generic placeholders.
- **Iterate in place**: pass the prior `slotId` so refinements replace the slot instead of stacking near-duplicates in the rail.

---

## Anti-patterns (don't do these)

- ❌ `canvas_plan` for analyses, reports, architecture writeups, or "render this markdown" — use `canvas_render`
- ❌ `\n` inside mermaid node labels — use `<br/>` instead
- ❌ Wrapping mermaid source in ` ```mermaid ` fences — the `MermaidEditor` component expects raw source
- ❌ Mirroring every assistant message to the canvas — the terminal is the chat; only push the rich stuff
- ❌ Sparse Cards (just title + description) when the content has real structure — use Card with `children` to nest Text/Badge/Heading/etc. for richer layouts
- ❌ Pushing the same content twice — pass the prior `slotId` to replace in place
- ❌ Ignoring `<canvas-edit>` blocks in the user's message — those ARE the edits, not metadata
