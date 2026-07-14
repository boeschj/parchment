# Content references — render by pointer, not by paste

Read this before pasting a file, a diff, or a CSV into a spec.

A reference is a prop value naming a LOCAL resource. You write the pointer; the
daemon reads the bytes at push time, puts them in the slot's state, and rewrites
the prop to a `{"$state"}` binding. **Never paste file or diff content into a
spec** — a diff slot costs ~15 authored tokens instead of the whole patch.

## The five forms

Options are always siblings of the `$`-key.

| Form | Resolves to | Typical target |
|---|---|---|
| `{"$file": "src/a.ts", "lines": "40-80"}` | file text (line range applied) | `CodeBlock.code`, `Markdown.content` |
| `{"$diff": "src/a.ts", "base": "HEAD~1", "staged": false}` | unified patch string | `CodeBlock.code` |
| `{"$csv": "data/results.csv", "limit": 500}` | array of row objects (+ `columns` on a DataTable) | `DataTable.rows`, `Chart.data` |
| `{"$img": "shots/after.png"}` | a daemon-served URL | `Image.src` |
| `{"$log": "app.log", "groupBy": "10m", "match": "ERROR"}` | **aggregated** chart rows (+ `x` and `y`) | `Chart.data` |

Bare-string shorthand for a whole resource, no options: `"$file:src/a.ts"`,
`"$diff:src/a.ts"`, `"$csv:data/x.csv"`, `"$img:shots/after.png"`. (`$log` has
none — it always carries at least a `groupBy`.)

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

A `$csv` in `rows` carries the file's header too, so **`columns` is optional on a
DataTable** — omit it and the daemon derives one column per header cell, in file
order, typing and right-aligning the ones whose cells are numbers. You have not
read the file; it has.

```json
{"type": "DataTable", "props": {"rows": {"$csv": "bench/results.csv"}}}
```

Author `columns` only to OVERRIDE that: to show a subset, reorder, rename a
header, or set a width. What you write always wins — the daemon fills `columns`
only when it is absent.

```json
{"type": "DataTable", "props": {
  "rows": {"$csv": "bench/results.csv"},
  "columns": [{"key": "name", "header": "Case"},
              {"key": "ms", "header": "p99 (ms)", "type": "number", "align": "right"}]}}
```

Nothing else derives: a `Chart` fed by the same `$csv` still needs its own `x`
and `y` (which series to plot is your editorial call, not the file's).

## A log, charted — the daemon does the aggregation

`$log` is the one reference that returns an ANSWER rather than content. You state
the question; the daemon reads every line, buckets it in time, aggregates, and
fills the Chart's `data`, `x` and `y`. **Never read a log and paste the numbers
you counted** — that is the same mistake as pasting a diff.

```json
{"type": "Chart", "props": {"kind": "line",
  "data": {"$log": "logs/app.log", "match": "ERROR", "groupBy": "10m"}}}
```

That is the whole spec for "error rate over time in ten-minute buckets". No `x`,
no `y`, no data points: they are facts about the file, and the daemon supplies
them (`x` is `"bucket"`; `y` is the metric, or the series it found).

| Option | Meaning |
|---|---|
| `groupBy` **(required)** | The time bucket, as a duration: `"30s"`, `"5m"`, `"10m"`, `"1h"`, `"1d"`, `"2w"`. (`hour`/`day`/`week` still work.) |
| `match` | A regex a line must match to be counted. A plain substring (`"ERROR"`) is a valid regex. |
| `parser` | `jsonl` \| `regex` \| `number` — **the same file-tail parser grammar `canvas_live` uses**. `regex` needs `pattern`; a `pattern` alone implies `regex`. |
| `pattern` | A regex with **named groups** — its captures are the line's fields: `"duration_ms=(?<duration_ms>\\d+)"`. |
| `series` | A captured field. One line on the chart per distinct value it holds (ERROR vs WARN as two series). Max 12, biggest first. |
| `metric` | `count` (default) · `rate` (matching lines per minute) · `sum:<field>` `avg:<field>` `min:<field>` `max:<field>` `p50:<field>` `p95:<field>` `p99:<field>` over a captured number. |
| `watch` | Re-aggregate the whole file on every change (see below). |

ERROR and WARN as two series, from one named-capture pattern:

```json
{"type": "Chart", "props": {"kind": "bar", "data": {
  "$log": "logs/app.log", "groupBy": "10m",
  "pattern": "\\s(?<level>ERROR|WARN)\\s", "series": "level"}}}
```

p95 latency per five minutes, over a captured number:

```json
{"type": "Chart", "props": {"kind": "area", "data": {
  "$log": "logs/app.log", "groupBy": "5m",
  "pattern": "duration_ms=(?<duration_ms>\\d+)", "metric": "p95:duration_ms"}}}
```

**Timestamps.** A line is timed by an ISO-8601 timestamp anywhere in it (the
common case, no configuration), or by a `t` / `ts` / `time` / `timestamp` field
the parser captured — epoch ms, or any date string. Untimed lines are skipped and
counted back to you in a note.

**Buckets are UTC and epoch-aligned**, and every bucket between the file's first
and last line is plotted — including the ones nothing matched, which is why a
quiet ten minutes is a real `0` rather than a hole in the line.

**What `$log` cannot do** (paste, or pick a different tool): a share/percentage
of total (`errors ÷ all lines`), a ratio between two different matches, a
distinct-count (`uniq users`), grouping the X axis by a FIELD rather than by
time, a top-N table, or anything spanning two files. It is a bucketed
aggregation, not a query language — if the question needs more, it needs SQL.

## Snapshot vs live

- A plain reference is a **snapshot**: the bytes as of the push. It never
  changes on its own. Re-push the same `slotId` to refresh it.
- **`"watch": true`** on `$file`, `$diff` or `$log` makes it **live**: the daemon
  re-resolves on every change to that file and patches slot state over the
  socket — with zero further tool calls. A watched `$log` re-aggregates the whole
  file (a bucket's count depends on every line in it), so points already on the
  chart MOVE, new buckets extend the axis, and a level that appears for the first
  time grows a series of its own. This is the one to reach for when you are still
  editing the file, or the log is still being written:

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
   (truncation is reported back to you), 8 MB per `$log` read, 2000 buckets per
   `$log` chart (the error tells you to widen `groupBy`), 2 MB of hydrated
   content per slot.
3. Binary files reject — use `$img` for images.
4. `$diff` needs a git repo; outside one it fails with git's own stderr.
5. Don't hand-write `/hydrated/*` state or bind to it yourself — the daemon owns
   that namespace.
6. Hydration failures reject the push with the exact element, prop, and fix.
   Correct what it names and re-push with the same `slotId`.
