# Expressions, state actions, and events (full)

The canvas-spec core lists the expression forms and the two backchannel actions.
This file is the complete reference for conditions, state mutation, watchers, and
per-component events — pull it when a binding or interaction needs more than the
core one-liners.

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
  once and reference them instead of restating.
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
- **`canvas.intent`** `{id, params?}` — structured action button. Params must be
  STATIC JSON (no expressions; the daemon records them at render time and rejects
  the spec otherwise). Arrives as `<canvas-edit kind="intent">` with the exact
  recorded payload. Ids unique per slot.
- `canvas.commentMermaid` — used internally by MermaidEditor node comments.

Events by component: Button/Toggle emit `press`; Input/Textarea/Select/Checkbox/
Radio/Switch/Slider emit `change` (+ `submit` on Input).

Form validation (`checks` types + `validateOn`) is documented in the canvas-tools
skill: references/interactivity.md.
