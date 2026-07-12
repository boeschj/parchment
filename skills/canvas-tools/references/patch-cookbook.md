# Patch cookbook (`canvas_patch`)

For any SMALL change to a slot already on the canvas, patch — do not re-send the
whole spec. `canvas_patch` applies RFC 6902 JSON Patch operations to the slot's
spec (~10x cheaper than a full re-render) and re-validates before pushing; on
rejection the slot keeps its previous state.

Paths are relative to the spec object:
- `/elements/<key>/props/<prop>` — one prop
- `/elements/<key>` — a whole element (on add/remove, also patch the parent's
  `children` array)
- `/state/<path>` — seeded state (what live-bound and `$state` components read)
- `/root` — the root key

Append to any array with the `-` token (`/…/rows/-`). These five cover almost
every iteration.

## 1. Change a metric value

Slot has `"m1": {"type": "Metric", "props": {"label": "p99", "value": "412 ms"}}`.

```json
canvas_patch: {"slotId": "<id>", "patches": [
  {"op": "replace", "path": "/elements/m1/props/value", "value": "388 ms"}
]}
```

## 2. Add a row to a DataTable

Slot has `"tbl": {"type": "DataTable", "props": {"columns": [...], "rows": [ ... ]}}`.
Append with `-`:

```json
canvas_patch: {"slotId": "<id>", "patches": [
  {"op": "add", "path": "/elements/tbl/props/rows/-",
   "value": {"route": "/checkout", "p99": 512, "errors": 3}}
]}
```

## 3. Toggle visibility

An element's `visible` is a TOP-LEVEL field. To hide it, set it to `false`; to
show it, `true` (or any `$cond`/`$state` condition):

```json
canvas_patch: {"slotId": "<id>", "patches": [
  {"op": "replace", "path": "/elements/details/visible", "value": false}
]}
```

If the element has no `visible` yet, use `"op": "add"` on the same path.

## 4. Append a point to a chart

Static-data chart (`"chart": {"type": "Chart", "props": {"data": [ ... ]}}`):

```json
canvas_patch: {"slotId": "<id>", "patches": [
  {"op": "add", "path": "/elements/chart/props/data/-",
   "value": {"day": "Sun", "revenue": 1410}}
]}
```

For a live/streaming chart bound to `{"$state": "/series"}`, don't patch — the
canvas_live source owns `/series`. Patch state directly only for one-off nudges:
`{"op": "add", "path": "/state/series/-", "value": {"t": 1720800000000, "ms": 47}}`.

## 5. Retitle

Change a heading element's text:

```json
canvas_patch: {"slotId": "<id>", "patches": [
  {"op": "replace", "path": "/elements/title/props/text", "value": "Q3 latency review"}
]}
```

To rename the slot's TAB, pass the tool's `title` argument instead of (or with) a
patch: `canvas_patch: {"slotId": "<id>", "title": "Q3 latency", "patches": [ ... ]}`.
