---
name: canvas-spec
description: Reference for authoring parchment json-render specs — spec grammar (root/elements/state), dynamic expressions ($state, $bindState, $template, $cond), events/actions (on.press, canvas.submit), repeat lists, visibility, and the full 49-component inventory with props. Use alongside canvas-tools when composing any canvas_render spec.
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
  Conditions: `{"$state": "/p"}` truthy · `eq`/`neq`/`gt`/`gte`/`lt`/`lte` ·
  `not: true` · arrays = AND · `{"$and": []}` / `{"$or": []}`.
- Inside `repeat` scope: `{"$item": "field"}`, `{"$index": true}`, `{"$bindItem": "field"}`.

## State, lists, watchers

- Seed initial state with the spec-level `"state"` object. Put LARGE datasets here
  once; reference them instead of restating.
- `repeat`: `{"type": "Card", "repeat": {"statePath": "/todos", "key": "id"}, ...}`
  renders the element once per array item.
- `visible`: any condition — e.g. `{"$state": "/form/valid"}`.
- `watch`: `{"/form/country": {"action": "setState", "params": {...}}}` — fires on
  change, not on mount.

## Events and actions

Bind on the element: `"on": {"press": {"action": "...", "params": {...}}}`.
Multiple: array of bindings, run in order. Params accept expressions.

- `setState` `{statePath, value}` · `pushState` `{statePath, value, clearStatePath?}`
  (`"$id"` in value = auto id) · `removeState` `{statePath, index}` ·
  `validateForm` `{statePath?}` writes `{valid, errors}`.
- **`canvas.submit`** `{id, payload}` — THE backchannel. Delivers resolved payload
  (use `{"$state": "/form"}`) to Claude's next turn as
  `<canvas-edit kind="form-submit">`. Bind to Button `on.press`.
- `canvas.commentMermaid` — used internally by MermaidEditor node comments.

Events by component: Button/Toggle emit `press`; Input/Textarea/Select/Checkbox/
Radio/Switch/Slider emit `change` (+ `submit` on Input).

Form validation: form components accept `checks` (e.g.
`[{"type": "required", "message": "Required"}]`, types: required, email, url,
numeric, minLength, maxLength, min, max, pattern, matches, lessThan, greaterThan,
requiredIf) and `validateOn`: `change` | `blur` | `submit`.

## Component inventory

### Canvas extensions (rich widgets — prefer these; details in canvas-tools)

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
| `Chart` | kind: line/bar/area/pie/scatter, data (rows, raw numbers), x, y (string or string[]), title?, height? |
| `DataTable` | columns: [{key, header, type?, align?, width?}], rows, caption?, editable?, exportable? |
| `Scene3D` | objects: [{kind: box/sphere/cylinder/plane/text, position [x,y,z], size?, rotation? (degrees), color?, label?, opacity?}], camera?, ground?, background? auto/transparent, height?, autoRotate?, title? — orbitable 3D scaffold (see below) |
| `PlanFile` | markdown, editable?, title? — the user's editable plan; not a layout block |

### Layout & containers (shadcn)

`Stack` (direction? horizontal/vertical, gap? none/sm/md/lg/xl, align?, justify?) ·
`Grid` (columns 1–6, gap?) · `Card` (title?, description?, maxWidth?, centered? —
accepts children) · `Separator` (orientation?) · `Tabs` (tabs: [{value,label}],
defaultValue — children map by value) · `Accordion` (items, type single/multiple) ·
`Collapsible` (title) · `Dialog` / `Drawer` (title, description, openPath — state
path controls visibility) · `Tooltip` (content, text) · `Popover` (trigger, content) ·
`Carousel` (items) · `Pagination` (totalPages, page)

### Content (shadcn)

`Heading` (text, level h1–h4) · `Text` (text, variant? body/caption/muted/lead/code —
code is INLINE identifiers only) · `Badge` (text, variant? default/secondary/
destructive/outline) · `Alert` (title, message?, type? info/success/warning/error —
neutral banner; prefer Callout for tonal emphasis) · `Image` (src, alt, width?,
height?) · `Avatar` (src?, name, size?) · `Table` (columns: string[], rows:
string[][] — prefer DataTable) · `Progress` (value, max?, label?) · `Skeleton` ·
`Spinner` (size?, label?)

### Inputs & actions (shadcn — always bind with $bindState)

`Button` (label, variant? primary/secondary/danger, disabled? — emits `press`) ·
`Link` (label, href) · `Input` (label?, type?, placeholder?, value, checks?) ·
`Textarea` (label?, rows?, value) · `Select` (label?, options: string[], value) ·
`Checkbox` (label, checked) · `Radio` (label?, options, value) · `Switch` (label,
checked) · `Slider` (label?, min, max, step?, value) · `Toggle` (label, pressed) ·
`ToggleGroup` (items, type, value) · `ButtonGroup` (buttons, selected) ·
`DropdownMenu` (label, items)

## 3D scenes (Scene3D)

`Scene3D` sketches an orbitable 3D layout the user can rotate, zoom, and pan —
room and floor-plan scaffolds, architecture massing, physical arrangements, or
data sculptures. Compose primitives in one coordinate space (meters, **y is up**,
ground grid at y=0) and label the parts that matter. Keep the vocabulary small:
`box` (walls/tables/furniture), `plane` (floors/rugs — lay flat with rotation
`[-90, 0, 0]`), `cylinder` (columns/legs/posts), `sphere` (nodes/bulbs), `text`
(a floating caption at its own position). Rest a shape of height `h` on the floor
by centering it at `y = h/2`. Rotation is in **degrees**. Colors are hex; the
scene background and grid adapt to light/dark on their own. Reach for `Chart`
instead for 2D data and `MermaidEditor` for node-edge diagrams — Scene3D is a
spatial sketch, not a chart or a CAD model.

```json
{
  "root": "room",
  "elements": {
    "room": {
      "type": "Scene3D",
      "props": {
        "title": "Booth layout", "height": 460, "autoRotate": true,
        "camera": {"position": [7, 6, 9], "lookAt": [0, 0.9, 0]},
        "objects": [
          {"kind": "plane", "position": [0, 0, 0], "size": [6, 6, 1], "rotation": [-90, 0, 0], "color": "#d9d2c5"},
          {"kind": "box", "position": [0, 1.4, -3], "size": [6, 2.8, 0.12], "color": "#c9c1b0", "label": "Banner wall"},
          {"kind": "box", "position": [0, 0.5, 0], "size": [2, 1, 1], "color": "#7a4a24", "label": "Demo desk"},
          {"kind": "cylinder", "position": [-2, 0.9, -2], "size": [0.18, 1.8, 0.18], "color": "#3b3a36"},
          {"kind": "sphere", "position": [-2, 1.95, -2], "size": [0.4, 0, 0], "color": "#ffd9a0", "label": "Light"}
        ]
      },
      "children": []
    }
  }
}
```

## Integrity checklist (walk it before every send)

1. Every key in every `children` array exists in `elements`.
2. Every `$state`/`$bindState`/`repeat` path exists in `"state"` (seed it!).
3. `on`/`repeat`/`watch`/`visible` at element level, not in `props`.
4. Leaf elements still carry `"children": []`.
5. Chart data values are numbers; Metric values are formatted strings.
6. Mermaid source is raw (no fences), `<br/>` for label line breaks.
7. Scene3D: y is up, rotation in degrees, rest shapes on the floor at `y = height/2`.
