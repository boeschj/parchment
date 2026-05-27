---
name: canvas-extensions
description: The 5 canvas-extension components (PlanFile, DiffViewer, MermaidEditor, Chart, DataTable) added on top of @json-render/shadcn. Use when composing a `canvas_render` spec that needs an editable plan, code diff, editable diagram, chart, or sortable table — none of which exist in the shadcn catalog.
---

# Canvas extension components

These extend the json-render shadcn catalog with five rich, editable widgets specific to clawd-canvas. They appear alongside the 36 shadcn components inside `canvas_render` specs and as the `props` of the `canvas_plan` / `canvas_diff` / `canvas_diagram` / `canvas_table` shortcuts.

## PlanFile

Tiptap WYSIWYG markdown editor. Round-trip through markdown is via `tiptap-markdown`.

**Props:**
- `markdown` *(string, required)* — plan content
- `editable` *(boolean, optional, default true)* — set false to render read-only
- `title` *(string, optional)*

**Edit return shape** (in `<canvas-edit kind="plan-edit">`):
```json
{ "markdown": "...the user's updated markdown..." }
```

## DiffViewer

Monaco side-by-side diff. The "after" side is editable by default.

**Props:**
- `file` *(string, required)* — path / display name; used to auto-detect language
- `before` *(string, required)*
- `after` *(string, required)*
- `language` *(string, optional)* — Monaco language id; overrides extension-based detection
- `editableSide` *("after" | "both" | "none", default "after")*

**Edit return shape** (in `<canvas-edit kind="diff-edit">`):
```json
{ "file": "src/foo.ts", "side": "after", "content": "...the user's tweaked code..." }
```

## MermaidEditor

CodeMirror source pane + live mermaid render. Click nodes to leave comments.

**Props:**
- `source` *(string, required)* — raw mermaid source (no ` ```mermaid ` fences)
- `editable` *(boolean, optional, default true)*
- `title` *(string, optional)*
- `comments` *(array of {nodeId, body}, optional)* — preexisting node comments

**Edit return shapes:**
- `<canvas-edit kind="mermaid-edit">{ "source": "..." }</canvas-edit>` — source changed
- `<canvas-edit kind="mermaid-comment">{ "nodeId": "...", "body": "..." }</canvas-edit>` — node comment added

## Chart

Recharts wrapper. Read-only.

**Props:**
- `kind` *("line" | "bar" | "area" | "pie" | "scatter", required)*
- `data` *(array of records, required)* — row-oriented; each row is `{[columnKey]: value}`
- `x` *(string, required)* — key in each row for the X axis (or pie category)
- `y` *(string or string[], required)* — key(s) for the Y series; array for multi-series
- `title` *(string, optional)*
- `height` *(number, optional, default 320)*

## DataTable

Sortable table with CSV export, optional inline cell edit.

**Props:**
- `columns` *(array of {key, header, type?, align?, width?}, required)*
  - `key` — record key
  - `header` — display label
  - `type` — `"string" | "number" | "date" | "boolean"` (affects sort comparator)
  - `align`, `width` — display hints
- `rows` *(array of records, required)*
- `caption` *(string, optional)*
- `editable` *(boolean, optional, default false)*
- `exportable` *(boolean, optional, default true)*

**Edit return shape** (in `<canvas-edit kind="table-edit">`):
```json
{ "rowIndex": 3, "columnKey": "p99", "value": "980" }
```

## Composing extensions into a `canvas_render` spec

These five live alongside the 36 shadcn components in the same catalog, so you can nest freely. Example: a report card with an editable plan, a chart, and a sortable table:

```json
{
  "title": "Investigation: slow checkout",
  "kind": "report",
  "spec": {
    "root": "report",
    "elements": {
      "report":  {"type": "Stack", "props": {"gap": "lg"}, "children": ["heading", "plan", "row"]},
      "heading": {"type": "Heading", "props": {"text": "Slow checkout investigation", "level": "h2"}},
      "plan":    {"type": "PlanFile", "props": {"markdown": "# Findings\n\n- The bottleneck is ...\n\n# Next steps\n\n- ..."}},
      "row":     {"type": "Grid", "props": {"columns": 2, "gap": "md"}, "children": ["latency", "queries"]},
      "latency": {"type": "Chart", "props": {
        "kind": "line",
        "data": [{"t": "10:00", "p99": 1100}, {"t": "10:05", "p99": 1420}, {"t": "10:10", "p99": 920}],
        "x": "t",
        "y": "p99",
        "title": "p99 latency"
      }},
      "queries": {"type": "DataTable", "props": {
        "caption": "Slowest queries",
        "columns": [
          {"key": "q", "header": "Query"},
          {"key": "p99", "header": "p99", "type": "number", "align": "right"}
        ],
        "rows": [{"q": "SELECT * FROM orders ...", "p99": 1240}]
      }}
    }
  }
}
```

The user can edit the plan, sort the table, export it to CSV, and their plan edits flow back as a `<canvas-edit kind="plan-edit">` block on your next turn.
