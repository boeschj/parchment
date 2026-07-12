# Changelog

## 0.1.0 — 2026-07-12

Renamed from clawd-canvas to **parchment**. This is a fresh version line for
the new name, not a step down in functionality — everything shipped in
0.3.0 below is still here.

### Renamed
- Product identity throughout: CLI output, MCP server name, package
  manifests, skill descriptions, and docs now say parchment instead of
  clawd-canvas.
- Marketplace and plugin keys changed from `clawd-canvas`/`clawd-canvas@clawd-canvas`
  to `parchment`/`parchment@parchment`. Reinstall via
  `/plugin marketplace add boeschj/parchment` and
  `/plugin install parchment@parchment`.
- Kept as-is: the MCP server key `canvas` and every `canvas_*` tool name, the
  `~/.parchment` state directory, and the `parchment` bin name — none of
  those were ever tied to the old product name.

### Package management
- Adopted pnpm (`pnpm@10.23.0`, pinned) for dependency management. Bun
  remains the runtime for the daemon, CLI, and tests — `pnpm install`,
  `pnpm build`, never `bun install`.

### MCP tool surface — leaner and token-efficient
Pre-release, so this lands as a straight replacement rather than a deprecation
cycle. The advertised tool surface drops from 14 tools to 8 and its serialized
size falls ~62% (~5,500 → ~2,100 tokens), following Anthropic's "few thoughtful
tools, concise descriptions" guidance. No capability is lost — the deep
guidance already lives in the `canvas-tools` / `canvas-spec` skills.
- **Removed** `canvas_diagram`, `canvas_diff`, `canvas_table`, `canvas_document`.
  They were single-component wrappers; compose the same `MermaidEditor`,
  `DiffViewer`, `DataTable`, or a centered document layout directly inside
  `canvas_render`. A new `document` starter template seeds the document skeleton
  into the library.
- **Merged** `canvas_save` / `canvas_load` / `canvas_library` into one
  `canvas_library` tool with `action: "save" | "load" | "list"`.
- **Slimmed** every surviving tool's description to 1–2 sentences (enum values
  in schemas are kept — they constrain the model; narrative prose was cut).
- **Auto-repair**: `canvas_render` / `canvas_patch` now silently coerce
  unambiguous wrong-but-obvious enum values instead of rejecting them — numeric
  `gap` to the nearest spacing token, `level: 1` to `h1`, `variant: "default"`
  to `primary`, Chart `xScale: "linear"` to `category`, and more — so common
  first-attempt mistakes render on the first pass. Genuinely ambiguous values
  still reject with the exact fix. `Steps` item `status` is now optional.

## 0.3.0 — 2026-07-06

The generative-UI turnaround release. The canvas goes from "markdown in cards"
to a composable, interactive, self-correcting surface — and installs in two
commands.

### Generative UI
- **8 coding-agent components**: Metric, Steps, CodeBlock (syntax highlighting
  + line highlights), Callout, Terminal, FileChange, TestResults, Markdown —
  alongside the existing PlanFile, DiffViewer, MermaidEditor, Chart, DataTable.
- **Scene3D**: compose orbitable 3D scenes (boxes, spheres, planes, labels)
  straight from a spec — room scaffolds, architecture massing, physical layouts.
- **Validation feedback loop**: invalid specs are rejected with an exact issue
  list instead of silently rendering broken UI.
- **`canvas_snapshot`**: Claude exports any slot as a PNG and reviews its own
  layout before calling it done.
- **`canvas_patch`**: RFC 6902 surgical edits to a rendered slot — measured
  ~11× cheaper than re-emitting the spec for iterative changes.
- **Interactivity end-to-end**: specs carry initial `state`, two-way
  `$bindState` bindings, `$template` interpolation, repeat lists, and event
  bindings. `canvas.submit` delivers form payloads back into Claude's next
  turn — build working forms over your MCP tools.
- **Saved UIs**: `canvas_save` / `canvas_load` / `canvas_library` persist
  favorite views under `~/.canvas/library/`.
- **Skills rewritten**: `canvas-tools` (composition playbook) and `canvas-spec`
  (grammar + component reference) replace the old developer-doc skills.

### Fixed
- Slot and board ops now broadcast to every connected tab (first result wins);
  a stale pre-reload tab could previously swallow requests forever.
- Discrete edits (form submits, mermaid comments) deliver exactly once instead
  of re-injecting on every prompt and resurrecting after daemon restarts.
- Slot headings no longer render washed out at rest (scroll-fade mask now
  ramps in with scroll).
- DataTable captions match card-title scale; charts hide single-series
  legends, label bars, and format axis ticks.

### UX
- Left rail groups artifacts under a labeled section with kind tints, hover
  flyouts, and overflow handling — no more tower of identical icons.
- Transcript reader: blog-grade typography, framed image attachments, file
  path chips, collapsible tool output, and a quieter light-mode user bubble.

### Install
- Two-command install from GitHub with first-run self-build:
  `/plugin marketplace add boeschj/clawd-canvas` then
  `/plugin install clawd-canvas@clawd-canvas`.
- Statusline ships as a plugin settings default; the canvas URL also prints at
  every session start.

### Tests
- First automated suite (`bun test`) covering edit coalescing and one-shot
  delivery, slot state seeding, ops broadcast/correlation, spec catalog
  registration, and edit-kind routing.
