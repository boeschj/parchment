# Changelog

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
