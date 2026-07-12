---
name: canvas-tools
description: Compose generative UI on the clawd-canvas browser canvas via canvas_* MCP tools. Use whenever presenting anything richer than a one-liner — explanations, investigations, PR walkthroughs, benchmarks, log analysis, dashboards, comparisons, prototypes, or interactive forms. Turns walls of terminal text into visuals the user understands in under 3 minutes.
---

# Canvas composition — the playbook

The user has a live browser canvas. You push composed UI to it with `canvas_render`
(and the `canvas_diagram` / `canvas_diff` / `canvas_table` / `canvas_plan` shortcuts).
The bar: **a reader who would have needed 10 minutes to parse your prose gets the full
picture in under 3.** You are an information designer, not a text formatter.

Spec grammar, expressions, and the full component inventory live in the
**canvas-spec** skill. This skill is about *judgment*: what to build and how to
make it excellent.

## Score every render before you send it

- **10/10** — Answer visible in 2 seconds (Metric row or Callout verdict at top), a
  visual carrying the core mechanism (diagram, Steps, Chart, DiffViewer), evidence
  below (CodeBlock / DataTable / Terminal), zero prose walls, uses 6+ distinct
  component types, real data from THIS conversation.
- **5/10** — Correct structure but text-first: paragraphs in cards, tables of
  sentences, stats as prose. The user still has to *read* everything.
- **0/10** — One PlanFile/Markdown blob, or Cards containing nothing but Text. That
  is markdown with extra steps. Never ship it.

## Transform rules (prose → component)

Walk your draft answer sentence by sentence and convert:

| You were about to write… | Emit instead |
|---|---|
| A number, count, duration, cost, percentage | `Metric` (in a `Grid` columns 3–4 if several) |
| "First… then… finally…", pipeline, lifecycle, causal chain | `Steps` (status per stage) or `MermaidEditor` if it branches |
| Any code, config, schema, payload | `CodeBlock` (with `highlightLines` on the lines you discuss) |
| "I ran X and it output Y" | `Terminal` (real output only — never invent) |
| "This change touches files A, B, C" | Stack of `FileChange` rows |
| Test/benchmark outcomes | `TestResults`, plus `Chart` for before/after numbers |
| A warning, gotcha, key insight, verdict | `Callout` (tone carries the meaning) |
| Comparing options/branches/approaches | `Grid` columns 2–3 of `Card`s with `Badge` verdicts |
| Trend, distribution, before/after quantities | `Chart` (line=trend, bar=comparison, never pie >4 slices) |
| Row-level detail the user may sort/scan | `DataTable` (values in cells, never sentences) |
| Genuinely irreducible prose (max ~2 short sections per slot) | `Markdown` — one block, not ten `Text`s |

If a paragraph survives all rules, it earns a `Markdown` block. Most don't.

## Named layouts (start from one, adapt)

- **Explainer** (default for "how does X work"): Heading → Callout TL;DR → Metric
  row (the load-bearing numbers) → MermaidEditor or Steps (the mechanism) → Grid of
  Cards (the parts) → CodeBlock (the one snippet that matters) → Callout (sharp edges).
- **PR walkthrough**: Heading → Callout (what & why) → Metric row (files, +/-,
  risk) → FileChange stack → MermaidEditor (architecture delta) → DiffViewer (the
  crux change, `editableSide: "none"` unless review is wanted) → TestResults →
  Chart (before/after benchmark if you measured).
- **Investigation / postmortem**: Callout verdict first → Steps (causal chain,
  `error` status on the break point) → Terminal (the smoking-gun output) →
  CodeBlock (the offending code, highlighted) → DataTable (evidence) → Callout (fix).
- **Benchmark dashboard**: Metric row (headline deltas) → Chart (the distribution
  or series) → DataTable (raw runs) → Callout (methodology + caveats).
- **Log / trace analysis**: Metric row (error rate, p99, window) → Chart
  (line/area over time; seed big series into `state` and reference it) → DataTable
  (worst offenders) → Callout (diagnosis).
- **Live dashboard** ("keep an eye on X", test suites, builds, agent fleets, logs):
  compose ONCE with canvas_render — state-bound Chart (`xScale: "time"`, `x: "t"`)
  + Metric via `$template` + DataTable/`repeat` rows — then ONE canvas_live call
  streams data in forever. See "Live data" below.
- **Options comparison**: Heading → Grid columns 2–3, one Card per option
  (Badge verdict, Metric cost, bullet Markdown) → Callout recommendation.
- **Interactive form / mini-app** (see Interactivity): seed `state` → Inputs with
  `$bindState` → live preview via `$template` → Button `on.press` → `canvas.submit`.

Layout discipline: outer `Stack` gap `lg`; ONE `Heading` level h1; metric tiles in
`Grid` columns 3–4 (never stacked full-width); comparisons in `Grid` 2–3; charts and
tables full-width. Never nest a Metric inside a Card (it is already a tile). Never
put a Table/DataTable inside a Card (it draws its own surface).

## Interactivity — the canvas talks back

Everything the user does flows into your next turn as `<canvas-edit>` blocks inside
`<canvas-state>`. Treat them as the authoritative current state; your in-transcript
memory of a slot is stale the moment the user touches it.

- **Seed state** with the spec: `"state": {"form": {"title": "", "priority": "medium"}}`.
- **Bind form components** with `{"$bindState": "/form/title"}` on `value`/`checked`.
- **Make buttons real**: `"on": {"press": {"action": "canvas.submit", "params":
  {"id": "create-ticket", "payload": {"$state": "/form"}}}}` — this arrives as
  `<canvas-edit kind="form-submit" element="create-ticket">` with the resolved data.
  Then YOU act on it (call the MCP tool, write the file, run the command) and
  confirm by updating the slot.
- **This is how you stitch MCP servers into one UI**: render a Notion doc in a
  `Markdown` block next to a Linear-ticket form; the user edits fields and presses
  Create; the submit lands in your turn; you call the Linear MCP tool with the
  payload; you re-render the slot with the created ticket. The canvas is the
  front-end, MCP tools are the backend, you are the server.
- Edit kinds you'll see: `plan-edit`, `diff-edit` (apply with Edit/Write —
  with permission), `mermaid-edit`, `mermaid-comment`, `table-edit`, `form-submit`.

## Live data — compose once, streams forever

`canvas_live` binds daemon-side data sources to a slot's state paths. After one
render + one registration, updates flow to the browser with ZERO further tool
calls — never re-render or patch a slot just to refresh its data.

1. **Render** with seeded live paths and bound components:
   `"state": {"series": [], "fleet": {"sessions": [], "totals": {}}}`, Chart
   `data: {"$state": "/series"}, x: "t", xScale: "time"`, Metric
   `value: {"$template": "${/fleet/totals/costUsd}"}`, DataTable rows or a
   `repeat` over `/fleet/sessions`.
2. **Register** sources: `canvas_live {slotId, sources: [{id, statePath, kind, ...}]}`.
   Kinds: `file-tail` (path + parser jsonl|regex|number), `command-poll`
   (command + intervalSeconds), `http-poll` (url), `claude-sessions` (the
   built-in fleet+cost scanner — zero config for a live fleet dashboard).
3. `append` mode pushes `{t: epochMs, ...}` points onto a bounded array
   (`window`, default 300); `replace` overwrites the path — pick per source.
4. Don't bind a live statePath to anything the user edits; the daemon owns it.
5. Verify with canvas_snapshot after a few seconds — the first data should
   already be in. Full schema + a worked example: canvas-spec skill.

## The feedback loop (non-negotiable)

1. `canvas_render` now **rejects invalid specs with an issue list**. Fix exactly
   the listed issues and re-push with the SAME `slotId`. Never downgrade to
   canvas_plan because a spec bounced.
2. After any substantial render, call **`canvas_snapshot`** with the slot id and
   LOOK at the PNG. Check: is the answer visible without scrolling? Are tiles in a
   row, not a tower? Is any card a wall of text? Fix and re-push (same `slotId`).
   You are not done when the tool returns ok — you are done when it looks right.
3. Refinements always reuse `slotId` — never stack near-duplicate slots.

## Token discipline

- Large datasets (log series, benchmark runs): put the array in `state` ONCE and
  reference it — `Chart`/`DataTable` data props, or `repeat` for lists. Never
  restate rows in multiple components.
- Numbers in `Metric.value` are preformatted strings ("1.24 s", "$48.2k"); chart
  `data` values are raw numbers (57, not "57%").
- Label with THIS conversation's vocabulary: real paths, real route names, real
  branch names — never placeholders.

## Hard negatives (each of these has burned a real render)

- ❌ A slot whose components are only Card/Text/Heading — that's a document, score 0.
- ❌ Sentences as table cells. Tables hold values; prose goes in Markdown/Callout.
- ❌ Card+Text posing as a KPI — use Metric.
- ❌ `Text` variant `code` for a snippet — that's for inline identifiers; snippets use CodeBlock.
- ❌ Ten sibling `Text` elements — one `Markdown`.
- ❌ Inventing Terminal output, test counts, or benchmark numbers. If you didn't run it, don't render it.
- ❌ Mermaid: `\n` inside a node label (use `<br/>`), or fencing the source in ```` ```mermaid ````.
- ❌ Charts of arrays you never sorted/aggregated — do the math before the spec.
- ❌ Mirroring every reply to the canvas. Terminal stays the chat; the canvas gets
  the moments where visual structure beats prose. When in doubt for long technical
  answers: render.
