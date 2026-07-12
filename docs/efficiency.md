# Efficiency

Parchment optimizes for two costs that a coding agent actually pays: the number
of model passes it takes to land a correct render, and the number of tokens spent
after the first render to keep it useful. It does not optimize for spec size — a
terse DSL wins that microbenchmark and it doesn't matter. What matters is that the
model composes a view once and the daemon keeps it alive.

Four mechanisms do the work.

## 1. Compose once

A view is one `canvas_render` call: a flat json-render spec the model emits a
single time. It is not re-emitted when the data or a detail changes. The spec
lives in the daemon; the browser subscribes to it over a WebSocket. This is the
difference between authoring a document and printing one — the model pays for the
composition, not for every frame the user sees.

## 2. Live data streams with zero further tokens

`canvas_live` binds daemon-side data sources (a tailed file, a polled command or
URL, the built-in Claude Code session scanner) to a slot's state paths. After one
`canvas_render` plus one `canvas_live` registration, updates flow to the browser
with **zero** further tool calls. A dashboard that refreshes every second for an
hour costs the same number of model tokens as a dashboard that never updates: the
tokens for the initial compose, and nothing after. Approaches that re-emit the
whole view to change a number pay again on every update.

## 3. Edits are patches, not re-renders

For a small change to a slot already on the canvas — a metric value, an appended
row, a toggled section, a new chart point — `canvas_patch` sends only the changed
fields as an RFC 6902 JSON Patch against the stored spec, not the whole spec
again. The daemon applies and re-validates it, keeping the previous state if the
patch is invalid. A one-field edit costs a one-field payload.

## 4. Validation returns a fix, not just a failure

Every spec is validated before it reaches the browser. A rejection names the exact
element key, the exact path, and the exact fix ("`elements/m/props/value`: binds
to state path `/latest` but `/latest` is not seeded in the spec-level `state`
object. Add `latest` to `state` …"), so the model corrects the mistake in one
retry instead of guessing across several. Common structural slips (a misplaced
`on`/`repeat`/`watch`/`visible`, a leaf missing `children`) are repaired silently,
with no retry at all. The goal is a correct render on the first pass, and failing
that, on the second.

## The honest caveat

If the task is a single static page that renders correctly on the first try and is
never updated, a one-shot approach — the model emitting one self-contained HTML
file — can be cheaper, because it skips the daemon round-trip entirely. Parchment's
advantage is not in that one case. It compounds when the render is iterated on
(patch vs re-emit), when it carries live data (stream vs regenerate), or when the
first attempt is wrong (fix-hinted retry vs blind retries). The more a view lives,
the further ahead compose-once gets.

## Methodology

The claims above are measured, not asserted. The `bench/` harness runs fixed
tasks through a headless `claude -p` on both a parchment arm and a single-file
HTML arm, and extracts three metrics from each run's own session transcript:

- **passes to a correct render** — model turns until the artifact validates,
- **tokens to first paint** — tokens spent before the user sees anything,
- **tokens per update** — cost of keeping a live view current over N updates
  (≈ 0 for parchment after setup).

See `bench/README.md` for how to run it and how the arms are isolated.
