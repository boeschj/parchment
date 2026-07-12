# Live data — compose once, streams forever

Read this before using `canvas_live`.

`canvas_live` binds daemon-side data sources to a slot's state paths. After one
render + one registration, updates flow to the browser with ZERO further tool
calls — never re-render or patch a slot just to refresh its data.

1. **Render** with seeded live paths and bound components:
   `"state": {"series": [], "fleet": {"sessions": [], "totals": {}}}`, Chart
   `data: {"$state": "/series"}, x: "t", xScale: "time"`, Metric
   `value: {"$template": "${/fleet/totals/costUsd}"}`, DataTable rows or a
   `repeat` over `/fleet/sessions`.
2. **Register** sources: `canvas_live {slotId, sources: [{id, statePath, kind, ...}]}`.
3. `append` mode pushes `{t: epochMs, ...}` points onto a bounded array
   (`window`, default 300); `replace` overwrites the path — pick per source.
4. Don't bind a live statePath to anything the user edits; the daemon owns it.
5. Verify with canvas_snapshot after a few seconds — the first data should
   already be in.

## Source kinds

Each source is `{id, statePath, kind, ...}`. `statePath` is a JSON Pointer the
source writes; bind component props to it with `{"$state": "/series"}`.

- `file-tail`: `path` + `parser` `jsonl` (default) | `regex` (needs `pattern`
  with named groups, numerics coerced) | `number` (first number on the line).
  Only NEW lines stream; a file created later is picked up. Default mode `append`.
- `command-poll`: `command` run every `intervalSeconds` (min 1, default 5);
  stdout parsed as JSON → number → string. Default mode `replace`.
- `http-poll`: `url` GET every interval; JSON body parsed. Default `replace`.
- `claude-sessions`: this machine's Claude Code fleet — the built-in fleet+cost
  scanner, zero config for a live fleet dashboard. Options `sinceHours` (24) and
  `limit` (25). Writes at statePath:
  `{sessions: [{sessionId, project, title, lastPrompt, status: active|idle,
  isSubagent, model, turns, tokensIn, tokensOut, cacheRead, cacheWrite,
  costUsd, lastActivityAt, gitBranch}], totals: {sessions, active, turns,
  tokensIn, tokensOut, costUsd}, scannedAt, costNote}`. `costUsd` is an
  ESTIMATE from a static price table — always label it "est.".
- Shared knobs: `pluck` (dot path into each parsed value, e.g.
  `data.stats[0].cpu`), `mode` `append`|`replace`, `window` (append cap,
  default 300, max 5000). Appended points are objects with `t` (epoch ms) added
  when missing; scalars become `{t, value}`.
- Each call replaces the slot's whole source set; `[]` stops streaming;
  sources die with canvas_close.

## Worked example — live latency dashboard in two calls

```json
canvas_render: {"title": "API latency", "kind": "dashboard", "spec": {
  "root": "page",
  "state": {"series": [], "latest": 0},
  "elements": {
    "page":  {"type": "Stack", "props": {"gap": "lg"}, "children": ["kpis", "trend"]},
    "kpis":  {"type": "Grid", "props": {"columns": 3}, "children": ["now"]},
    "now":   {"type": "Metric", "props": {"label": "Current", "value": {"$template": "${/latest} ms"}}, "children": []},
    "trend": {"type": "Chart", "props": {"kind": "line", "x": "t", "y": "ms",
              "xScale": "time", "data": {"$state": "/series"}}, "children": []}
  }
}}

canvas_live: {"slotId": "<from render>", "sources": [
  {"id": "series", "statePath": "/series", "kind": "file-tail",
   "path": "/tmp/api.log", "parser": "regex", "pattern": "lat=(?<ms>\\d+)"},
  {"id": "latest", "statePath": "/latest", "kind": "file-tail",
   "path": "/tmp/api.log", "parser": "regex", "pattern": "lat=(?<ms>\\d+)",
   "pluck": "ms", "mode": "replace"}
]}
```

A fleet dashboard is the same shape with one `claude-sessions` source and a
DataTable/`repeat` bound to `/fleet/sessions`.
