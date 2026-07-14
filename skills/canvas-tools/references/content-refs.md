# Content references — render by pointer, not by paste

Read this before pasting a file, a diff, or a CSV into a spec.

A reference is a prop value naming a LOCAL resource. You write the pointer; the
daemon reads the bytes at push time, puts them in the slot's state, and rewrites
the prop to a `{"$state"}` binding. **Never paste file or diff content into a
spec** — a diff slot costs ~15 authored tokens instead of the whole patch.

## The four forms

Options are always siblings of the `$`-key.

| Form | Resolves to | Typical target |
|---|---|---|
| `{"$file": "src/a.ts", "lines": "40-80"}` | file text (line range applied) | `CodeBlock.code`, `Markdown.content` |
| `{"$diff": "src/a.ts", "base": "HEAD~1", "staged": false}` | unified patch string | `CodeBlock.code` |
| `{"$csv": "data/results.csv", "limit": 500}` | array of row objects | `DataTable.rows`, `Chart.data` |
| `{"$img": "shots/after.png"}` | a daemon-served URL | `Image.src` |

Bare-string shorthand for a whole resource, no options: `"$file:src/a.ts"`,
`"$diff:src/a.ts"`, `"$csv:data/x.csv"`, `"$img:shots/after.png"`.

`lines` accepts `"40-80"`, `"40"`, `"40-"`, `"-80"` (1-based, inclusive).
CSV: first row is the header, numeric cells become numbers, rows cap at 10k.

## A git diff slot — three lines

`$diff` as a props KEY on a `DiffViewer` expands into its `before` / `after` /
`file`. This is the whole slot:

```json
canvas_render: {"title": "server.ts change", "spec": {
  "root": "d",
  "elements": {"d": {"type": "DiffViewer", "props": {"$diff": "src/daemon/server.ts"}}}
}}
```

Default is working tree vs `HEAD`. Add `"base": "HEAD~3"` to diff against an
older commit, or `"staged": true` for index-vs-HEAD.

## A file excerpt in a CodeBlock

```json
{"type": "CodeBlock", "props": {
  "code": {"$file": "src/daemon/server.ts", "lines": "40-80"},
  "title": "src/daemon/server.ts", "language": "typescript", "startLine": 40}}
```

## A CSV table

```json
{"type": "DataTable", "props": {
  "rows": {"$csv": "bench/results.csv"},
  "columns": [{"key": "name", "header": "Case"},
              {"key": "ms", "header": "ms", "type": "number", "align": "right"}]}}
```

You still author `columns` — that's your editorial choice about what to show.

## Snapshot vs live

- A plain reference is a **snapshot**: the bytes as of the push. It never
  changes on its own. Re-push the same `slotId` to refresh it.
- **`"watch": true`** on `$file` or `$diff` makes it **live**: the daemon
  re-resolves on every change to that file and patches slot state over the
  socket — with zero further tool calls. This is the one to reach for when you
  are still editing the file:

```json
{"type": "DiffViewer", "props": {"$diff": "src/daemon/server.ts", "watch": true}}
```

Provenance for every reference lands in state under `/hydratedMeta/<id>`
(`mode`, `hash`, `hydratedAt`), so a stale snapshot is visible, not silent.

## Rules and limits

1. **Paths must live inside the session's working directory.** Relative paths
   resolve against it; an absolute path outside it (or a symlink escaping it)
   is REJECTED. This is a hard confinement rule, not a preference.
2. Caps: 512 KB per `$file` (the error names the `lines` fix), 10k CSV rows
   (truncation is reported back to you), 2 MB of hydrated content per slot.
3. Binary files reject — use `$img` for images.
4. `$diff` needs a git repo; outside one it fails with git's own stderr.
5. Don't hand-write `/hydrated/*` state or bind to it yourself — the daemon owns
   that namespace.
6. Hydration failures reject the push with the exact element, prop, and fix.
   Correct what it names and re-push with the same `slotId`.
