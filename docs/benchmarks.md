# Benchmarks

Measured comparisons between parchment's `canvas_*` MCP tools and the obvious
baseline: the model writing a single self-contained HTML file. Every number
below comes from real headless `claude -p` runs on 2026-07-12 (Claude Code
2.1.207, models `haiku` = claude-haiku-4-5, `sonnet` = claude-sonnet-4-5),
archived with full session transcripts under `bench/results/`.

The short version: **for a one-shot static page, the HTML file is a fine
format and often reaches first paint on fewer tokens — we print those losses
below.** Parchment's measured advantage is everything that happens after the
first render: live updates cost zero tokens, and edits are patches instead of
regenerations.

## Headline: what a live dashboard costs to keep updated

One dashboard, 10 data updates after the initial render (haiku, 1 rep/arm):

| | Initial compose | 10 updates | Model calls for updates | Tokens for updates |
|---|---|---|---|---|
| parchment (`canvas_render` + `canvas_live`) | $0.0311 | **$0** | **0** | **0** |
| single HTML file (re-prompt per update) | $0.0542 | $0.1320 | 10 | 588,317 |

The parchment zero is observed, not assumed: after the one compose call
registered a file-tail source, the benchmark script appended 10 lines directly
to the tailed file and polled the daemon's HTTP state endpoint. The slot's
chart series grew 5 → 15 points, one point per append, each visible within
~1.2 s — with zero further model calls in the loop
(`bench/results/2026-07-12T14-44-37-654Z-live-update/report.md` has the
per-append observations).

The HTML arm's per-update cost also **grows with session length**: update 1
cost 42,675 tokens, update 10 cost 75,323 — every re-prompt carries the whole
prior conversation. All 10 HTML updates did land correctly (the chart series
reached 15 points and the log table rolled forward as designed); what the
baseline loses is not correctness on this task, it is the recurring bill.

## One-shot scenarios: 6 tasks × both arms × 3 reps (haiku)

All 36 runs passed validation (100% pass rate in every cell). Means below;
medians/min/max are in the archived reports.

| Scenario | Arm | Passes to correct render | Tokens to first paint | Cost/run |
|---|---|---|---|---|
| CI status dashboard | parchment | 1.33 | 22,156 | $0.0377 |
| CI status dashboard | html | 1.00 | 11,624 | $0.0452 |
| CSV data table | parchment | 1.00 | 14,117 | $0.0167 |
| CSV data table | html | 1.00 | 8,923 | $0.0248 |
| Architecture diagram | parchment | 1.00 | 13,856 | $0.0150 |
| Architecture diagram | html | 1.00 | 8,972 | $0.0253 |
| Incident report | parchment | 1.00 | 14,935 | $0.0242 |
| Incident report | html | 1.00 | 9,667 | $0.0304 |
| Validated signup form | parchment | 2.00 | 32,556 | $0.0353 |
| Validated signup form | html | 1.00 | 8,620 | $0.0226 |
| Live log dashboard (setup) | parchment | 1.67 | 26,232 | $0.0334 |
| Live log dashboard (setup) | html | 1.00 | 11,428 | $0.0429 |

Read the losses plainly:

- **Tokens to first paint: the HTML file wins every scenario.** Writing one
  file is one tool call with no MCP schema overhead; parchment runs carry the
  canvas tool schema and sometimes a validation retry before the first
  accepted render.
- **Passes to correct render: the HTML file wins or ties every scenario.**
  Parchment's extra passes are its daemon *rejecting* structurally invalid
  specs and returning a fix hint — the user never sees the broken attempt,
  and the final render validated in 36/36 runs. But by the raw count, it
  retried and the HTML arm didn't. Note the checks are not equally strict:
  the HTML validator only asserts required tags/text exist in the file, while
  the parchment validator checks the live daemon actually holds the required
  components.
- **Cost/run: parchment is cheaper in 4 of 6 scenarios** (diagram, table,
  report, live-log setup) despite processing more total tokens — a compact
  spec means far fewer output tokens, and output tokens dominate price. The
  HTML arm is cheaper on the other 2 (status dashboard, validated form).

### Sonnet spot-check (status dashboard, 2 reps/arm)

| Arm | Passes to correct render | Tokens to first paint | Cost/run |
|---|---|---|---|
| parchment | 2.00 | 39,402 | $0.1428 |
| html | 1.00 | 14,296 | $0.1217 |

Same shape as haiku: the HTML file is cheaper and faster to first paint for a
one-shot static dashboard; parchment's validator forced one retry in both
reps before landing a spec that passed the daemon's component checks.

## Daemon startup (zero LLM cost)

Time from spawning the daemon process to a healthy HTTP endpoint, 5
iterations each:

| | Mean | Median | Min | Max |
|---|---|---|---|---|
| Cold boot (fresh `~/.parchment`) | 205 ms | 204 ms | 203 ms | 209 ms |
| Warm boot (state already initialized) | 204 ms | 204 ms | 203 ms | 204 ms |

There is effectively no cold-start penalty; first-run initialization is not a
meaningful cost.

## Skills delta (appendix)

Every run above uses `--setting-sources ""`, which strips personal config
*and* plugin skills — so the suite measures bare MCP tool descriptions, and
serves as the no-skills control. To measure what the plugin's skills add, the
status-dashboard/parchment/haiku cell was re-run (2 reps) with the
`canvas-tools` and `canvas-spec` SKILL.md cores (~14.5 KB) appended via
`--append-system-prompt`:

| | Pass rate | Passes to correct render | Tokens to first paint | Cost/run |
|---|---|---|---|---|
| No skills (control, N=3) | 100% | 1.33 | 22,156 | $0.0377 |
| With skill cores (N=2) | 100% | 1.50 | 36,328 | $0.0733 |

On this scenario the skills did not improve any measured metric — they added
prompt overhead to a task that already passed without them. That is the
honest read at this N. The skills' guidance targets composition judgment
(what to build, which components carry information best), which these
structural validators do not score; a quality-graded benchmark would be
needed to measure that, and this harness does not attempt it.

## Methodology

- **Harness**: `bench/` in this repo. Each run is a headless
  `claude -p <fixed prompt>` with `--output-format json` and a locked-down
  tool surface: the parchment arm gets exactly the one `canvas_*` tool under
  test (via `--mcp-config` + `--allowedTools`, all built-ins disabled); the
  HTML arm gets exactly `Write,Edit`.
- **Controlled**: personal CLAUDE.md/memory/settings excluded from every run
  (`--setting-sources ""`); one fresh session per rep with a harness-generated
  session id; the parchment arm talks to a disposable daemon with its own
  HOME and port, never a developer's live one; token counts come from the
  run's own session JSONL, counting cache reads/writes as prompt tokens
  (Anthropic's `input_tokens` alone under-reports by ~1000x on cached turns).
- **Not controlled**: model versions move; prompt-cache pricing behavior
  moves; N is small (2–3 reps per cell, 1 rep for the live-update metric);
  scenario prompts were written once, not tuned per arm; validation strictness
  differs per arm (daemon component checks vs regex file checks); wall-clock
  numbers were collected on a shared laptop and are not reported for that
  reason.
- **passes-to-correct-render** = authoring tool calls until the final
  artifact validated (renderAttempts, with 100% final pass everywhere).
  **tokens-to-first-paint** = cumulative prompt+completion tokens through the
  first accepted authoring call. Full definitions: `bench/README.md`.

## Reproduce

```bash
bun run bench/cli.ts run            # full suite: 6 scenarios × 2 arms × 3 reps, haiku (~$1.10)
bun run bench/live-update.ts        # tokens-per-live-update, both arms (~$0.25)
bun run bench/time-to-first-canvas.ts   # daemon boot timing, $0
bun run bench/skills-delta.ts       # skills-delta appendix (~$0.15)
```

Requires a Claude Code login; runs never touch your real `~/.parchment`.

## Raw data

Every run's per-run JSON record and full session transcript (JSONL) is
archived under `bench/results/<timestamp>/raw/`. The suites behind this page:

- `bench/results/2026-07-12T07-53-15-666Z/` — 36-run haiku suite
- `bench/results/2026-07-12T14-36-59-732Z/` — sonnet spot-check
- `bench/results/2026-07-12T14-44-37-654Z-live-update/` — live-update metric
  (an earlier pilot at `...T14-37-26-832Z-live-update/` was discarded for an
  instrumentation bug in the per-step presence check; its cost/token columns
  were sound and are consistent with the kept run)
- `bench/results/2026-07-12T14-37-04-244Z-time-to-first-canvas/` — boot timing
- `bench/results/2026-07-12T14-49-25-121Z-skills-delta/` — skills delta
