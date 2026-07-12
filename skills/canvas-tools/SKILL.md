---
name: canvas-tools
description: Compose generative UI on the parchment browser canvas via canvas_* MCP tools. Use whenever presenting anything richer than a one-liner — explanations, investigations, PR walkthroughs, benchmarks, log analysis, dashboards, comparisons, prototypes, or interactive forms. Turns walls of terminal text into visuals the user understands in under 3 minutes.
---

# Canvas composition — the playbook

The user has a live browser canvas. You push composed UI to it with `canvas_render`
(and the shortcut tools in the table below). The bar: **a reader who would have
needed 10 minutes to parse your prose gets the full picture in under 3.** You are an
information designer, not a text formatter.

Spec grammar, expressions, and the full component inventory live in the
**canvas-spec** skill. This skill is about *judgment*: what to build and how to make
it excellent. Deep material lives in reference files (listed at the bottom) — pull
one only when the task calls for it.

## Which canvas tool

| Situation | Tool |
|---|---|
| Rich content — anything past a paragraph of terminal text (DEFAULT) | `canvas_render` |
| A dashboard that should keep updating after your turn ends | `canvas_render` + `canvas_live` |
| A SMALL change to a slot already on the canvas | `canvas_patch` (never a full re-render) |
| Host a third-party MCP app's UI in a slot | `canvas_app` |
| A short plan the user will rewrite in their own words | `canvas_plan` |
| Long-form prose that reads like an article (report, postmortem, essay) | `canvas_render` (document layout — see references/documents.md) |
| An editable diagram / code diff / data table | `canvas_render` with a `MermaidEditor` / `DiffViewer` / `DataTable` component |
| Look at what actually rendered | `canvas_snapshot` |
| Keep, reload, or list a view the user liked | `canvas_library` (action `save` / `load` / `list`) |

Refinements ALWAYS reuse the same `slotId` — never stack near-duplicate slots.

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

If a paragraph survives all rules, it earns a `Markdown` block. Most don't. Reach for
a starting shape in **references/layouts.md**.

## Six rules that prevent 90% of rejects

canvas_render validates every spec and REJECTS invalid ones with a precise issue list
(element key + exact path + the fix) — correct exactly what it names and re-push with
the same `slotId`. It also silently auto-repairs a few mistakes. Write specs right the
first time:

1. Every key in a `children` array must be defined in `elements`.
2. Seed every `$state` / `$bindState` / `$template` / `repeat` path in the spec-level
   `state` — the check names any unseeded path (seed the top-level container; the
   daemon fills deeper live paths).
3. `on` / `repeat` / `watch` / `visible` are ELEMENT-level fields, never inside
   `props` (auto-repaired, but write them right).
4. Chart data values are raw numbers (`57`, not `"57%"`); `Metric.value` is a
   preformatted string (`"1.24 s"`, `"$48.2k"`).
5. `canvas.intent` params are STATIC JSON with ids unique per slot; `$state` payloads
   belong to `canvas.submit`.
6. Mermaid source is raw — no ```` ```mermaid ```` fences, `<br/>` not `\n` in labels.
   (Leaf elements should carry `"children": []`; omission is auto-repaired.)

## The feedback loop (non-negotiable)

1. If canvas_render rejects a spec, fix exactly the listed issues and re-push with the
   SAME `slotId`. Never downgrade to canvas_plan because a spec bounced.
2. After any substantial render, call **`canvas_snapshot`** with the slot id and LOOK
   at the PNG. Check: is the answer visible without scrolling? Are tiles in a row, not
   a tower? Is any card a wall of text? Fix and re-push (same `slotId`). You are not
   done when the tool returns ok — you are done when it looks right.

## Token discipline

- Large datasets (log series, benchmark runs): put the array in `state` ONCE and
  reference it — `Chart`/`DataTable` data props, or `repeat` for lists. Never restate
  rows in multiple components.
- Numbers in `Metric.value` are preformatted strings ("1.24 s", "$48.2k"); chart
  `data` values are raw numbers (57, not "57%").
- Label with THIS conversation's vocabulary: real paths, real route names, real branch
  names — never placeholders.
- Editing a live slot? Use `canvas_patch`, not a full re-render (references/patch-cookbook.md).

## Hard negatives (each of these has burned a real render)

- ❌ A slot whose components are only Card/Text/Heading — that's a document, score 0.
- ❌ Sentences as table cells. Tables hold values; prose goes in Markdown/Callout.
- ❌ Card+Text posing as a KPI — use Metric.
- ❌ `Text` variant `code` for a snippet — that's for inline identifiers; snippets use CodeBlock.
- ❌ Ten sibling `Text` elements — one `Markdown`.
- ❌ Inventing Terminal output, test counts, or benchmark numbers. If you didn't run it, don't render it.
- ❌ Mermaid: `\n` inside a node label (use `<br/>`), or fencing the source in ```` ```mermaid ````.
- ❌ Charts of arrays you never sorted/aggregated — do the math before the spec.
- ❌ Mirroring every reply to the canvas. Terminal stays the chat; the canvas gets the
  moments where visual structure beats prose. When in doubt for long technical
  answers: render.

## Deeper references (pull on demand)

- **references/layouts.md** — named layouts (Explainer, PR walkthrough, investigation,
  benchmark, log, live dashboard, comparison, form) + layout discipline. Start here
  when unsure how to arrange a slot.
- **references/interactivity.md** — the canvas talking back: forms, `$bindState`,
  `canvas.submit` / `canvas.intent`, file uploads, edit kinds, form validation. Read
  before building anything the user interacts with.
- **references/live-data.md** — the `canvas_live` cookbook (source kinds, append vs
  replace, fleet scanner, worked example). Read before using canvas_live.
- **references/mcp-apps.md** — hosting third-party MCP app UIs. Read before using canvas_app.
- **references/patch-cookbook.md** — five worked `canvas_patch` edits. Read before your first patch.
- **references/documents.md** — the `canvas_render` document layout (article-grade
  typography, the `document` library starter) and the slot Export menu (standalone
  HTML, PDF, copy-as-React). Read for long-form or when the user wants to keep/share a view.
