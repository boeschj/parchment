---
name: canvas-spec
description: Reference for authoring parchment json-render specs — spec grammar (root/elements/state), dynamic expressions ($state, $bindState, $template, $cond), events/actions (on.press, canvas.submit, canvas.intent), repeat lists, visibility, and the canvas component inventory with props. Use alongside canvas-tools when composing any canvas_render spec. Full shadcn prop tables, advanced expressions, and Scene3D live in this skill's references/*.md.
---

# Canvas spec reference

A spec is a flat element map. Children are referenced by key — no nesting:

```json
{
  "root": "page",
  "state": {"form": {"title": "", "priority": "medium"}},
  "elements": {
    "page":  {"type": "Stack",  "props": {"gap": "lg"}, "children": ["kpis", "title-in"]},
    "kpis":  {"type": "Grid",   "props": {"columns": 3}, "children": ["m1"]},
    "m1":    {"type": "Metric", "props": {"label": "p99", "value": "412 ms", "delta": "-38%", "trend": "down", "tone": "success"}},
    "title-in": {"type": "Input", "props": {"label": "Title", "value": {"$bindState": "/form/title"}}}
  }
}
```

Element fields: `type`, `props` (required), `children` (string keys), `visible`,
`on` (event → action), `repeat`, `watch`. The last four are TOP-LEVEL fields,
never inside `props`. Every child key must exist in `elements`.

## Dynamic expressions (any prop value)

- `{"$state": "/path"}` — read state.
- `{"$bindState": "/path"}` — two-way bind; put on the natural value prop
  (`value`, `checked`, `pressed`) of form components. Edits write back to state.
- `{"$template": "Hi ${/user/name}, ${count} results"}` — string interpolation.
- `{"$cond": {"$state": "/ok"}, "$then": "success", "$else": "danger"}` — branch.
- Inside `repeat` scope: `{"$item": "field"}`, `{"$index": true}`, `{"$bindItem": "field"}`.
- String shorthand: a bare `"$state./path"` / `"$bindState./form/title"` string
  (dot or pointer path) is accepted anywhere and normalized to the object form.

Condition operators, `$and`/`$or`, `watch`, and the full state-action set
(setState/pushState/removeState/validateForm) are in
**references/expressions-and-events.md**.

## State, lists, events

- Seed initial state with the spec-level `"state"` object. Put LARGE datasets here
  once and reference them. **Seed every path** any `$state`/`$bindState`/`$template`/
  `repeat` references — an unseeded path is rejected.
- `repeat`: `{"type": "Card", "repeat": {"statePath": "/todos", "key": "id"}, ...}`
  renders the element once per array item.
- `visible`: any condition — e.g. `{"$state": "/form/valid"}`.
- Bind events on the element: `"on": {"press": {"action": "...", "params": {...}}}`.
  The two backchannels to Claude's next turn:
  - **`canvas.submit`** `{id, payload}` — delivers a resolved payload (use
    `{"$state": "/form"}`) as `<canvas-edit kind="form-submit">`. Bind to Button press.
  - **`canvas.intent`** `{id, params?}` — a structured action button. `params` must be
    STATIC JSON (no expressions); ids unique per slot. Arrives as
    `<canvas-edit kind="intent">` with the exact recorded payload.

## Component inventory — canvas extensions (rich widgets, prefer these)

| Type | Key props |
|---|---|
| `Metric` | label, value (preformatted string), delta?, trend? up/down/flat, tone? neutral/success/warning/danger, detail? |
| `Steps` | items: [{title, detail?, status: done/active/pending/error}] |
| `CodeBlock` | code, language?, title? (path), highlightLines? [1-based], startLine?, maxHeight? |
| `Callout` | tone: info/success/warning/danger/tip, title?, body (supports `inline code`), compact? |
| `Terminal` | command, output, exitCode?, cwd? |
| `FileChange` | path, kind: created/modified/deleted/renamed, additions?, deletions?, summary?, renamedFrom? |
| `TestResults` | passed, failed, skipped?, durationMs?, failures?: [{name, message?}] |
| `Markdown` | content, maxHeight? |
| `MermaidEditor` | source (RAW mermaid — no fences; `<br/>` not `\n` in labels), title?, editable?, comments? |
| `DiffViewer` | file, before, after, language?, editableSide?: after/both/none |
| `Chart` | kind: line/bar/area/pie/scatter, data (rows, raw numbers), x, y (string or string[]), title?, height?, xScale? category/time (time = epoch-ms x, streaming-friendly) |
| `Sparkline` | data (numbers, or objects read via y — default key 'value'), y?, width?, height?, series? 1-5 — tiny axis-less inline trend |
| `DataTable` | columns: [{key, header, type?, align?, width?}], rows, caption?, editable?, exportable? |
| `Scene3D` | orbitable 3D scaffold — see references/scene3d.md |
| `PlanFile` | markdown, editable?, title? — the user's editable plan; not a layout block |
| `Upload` | label?, hint?, accept? (e.g. ".csv,image/*"), multiple? — dropzone; each file arrives as `<canvas-edit kind="file-upload">` with a daemon-generated savedPath (read the PATH; contents never injected) |

## Component inventory — shadcn primitives

Names only; full prop tables are in **references/components.md**.

- **Layout & containers**: `Stack`, `Grid`, `Card`, `Separator`, `Tabs`, `Accordion`,
  `Collapsible`, `Dialog`, `Drawer`, `Tooltip`, `Popover`, `Carousel`, `Pagination`.
- **Content**: `Heading`, `Text` (variant code = INLINE identifiers only), `Badge`,
  `Alert` (prefer Callout for tonal emphasis), `Image`, `Avatar`, `Table` (prefer
  DataTable), `Progress`, `Skeleton`, `Spinner`.
- **Inputs & actions** (always bind with `$bindState`): `Button`, `Link`, `Input`,
  `Textarea`, `Select`, `Checkbox`, `Radio`, `Switch`, `Slider`, `Toggle`,
  `ToggleGroup`, `ButtonGroup`, `DropdownMenu`.

## Accepted input forms (part of the schema, auto-normalized)

`gap` number / `"16"` / size word → nearest none/sm/md/lg/xl · `direction`
row/column · Heading `level` 1–6 (5/6 clamp to h4) · variant synonyms (Button
default→primary, destructive→danger; Badge danger/error→destructive; Text
default→body, secondary→muted) · Chart `xScale` linear→category,
date/timestamp→time · Chart xKey/yKey/yKeys→x/y · DataTable data→rows,
columns[].label→header · Metric value/delta numbers → display strings.

## Integrity checklist (walk it before every send)

1. Every key in every `children` array exists in `elements`.
2. Every `$state`/`$bindState`/`repeat`/`$template` path is seeded in `"state"`.
3. `on`/`repeat`/`watch`/`visible` at element level, not in `props`.
4. Leaf elements still carry `"children": []`.
5. Chart data values are numbers; Metric values are formatted strings.
6. Mermaid source is raw (no fences), `<br/>` for label line breaks.
7. Scene3D: y is up, rotation in degrees, rest shapes on the floor at `y = height/2`.

## References (pull on demand)

- **references/components.md** — full shadcn prop tables (layout, content, inputs).
- **references/expressions-and-events.md** — conditions, `$and`/`$or`, `watch`, the
  full state-action set, per-component events.
- **references/scene3d.md** — the Scene3D 3D-scene guide + worked example.

Live data sources (`canvas_live`) are documented in the canvas-tools skill:
references/live-data.md.
