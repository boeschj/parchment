# Benchmarks

Measured comparisons between parchment's `canvas_*` MCP tools and the obvious
baseline: the model writing a single self-contained HTML file. Every number
below comes from real headless `claude -p` runs on 2026-07-12 (Claude Code
2.1.207; `sonnet` = claude-sonnet-4-5, `opus` = claude-opus-4-8,
`haiku` = claude-haiku-4-5), archived with full session transcripts under
`bench/results/`. Sonnet and opus are the primary results — they are what
Claude Code users actually run; haiku is kept as a cheap-repetition variance
check in the appendix.

The short version: **for a one-shot static page, the HTML file wins first
paint at every model, and we print those losses below.** Parchment's measured
advantage is everything after the first render: live updates cost zero
tokens, so the cost gap compounds with every update a view receives.

## Headline: what a live dashboard costs to keep updated (sonnet)

One dashboard, 10 data updates after the initial render (1 rep/arm):

| | Initial compose | 10 updates | Model calls for updates | Tokens for updates | Lifetime total |
|---|---|---|---|---|---|
| parchment (`canvas_render` + `canvas_live`) | $0.0862 | **$0** | **0** | **0** | **$0.0862** |
| single HTML file (re-prompt per update) | $0.1023 | $0.3211 | 10 | 386,281 | $0.4233 |

After one compose call, the HTML baseline costs **4.9x more** by the 10th
update — and the gap keeps widening, because each HTML re-prompt carries the
whole prior session: update 1 cost $0.0223 (29,675 tokens), update 10 cost
$0.0417 (49,587 tokens), **+87% per update within 10 updates**.

The parchment zero is observed, not assumed: after the one compose call
registered a file-tail source, the benchmark script appended 10 lines
directly to the tailed file and polled the daemon's HTTP state endpoint. The
slot's chart series grew 5 → 15 points, one per append, each visible within
~1.2 s, with zero model calls in the loop
(`bench/results/2026-07-12T15-17-20-070Z-live-update-sonnet/report.md` has
the per-append observations). The HTML arm's 10 updates all landed correctly
too (10/10 log lines in the final file) — what the baseline loses is not
correctness on this task, it is the recurring, compounding bill.

## One-shot scenarios, sonnet: 6 tasks × both arms × 3 reps

All 36 runs passed validation (100% in every cell). Means below;
median/min/max are in the archived report.

| Scenario | Arm | Passes to correct render | Tokens to first paint | Cost/run |
|---|---|---|---|---|
| CI status dashboard | parchment | 2.00 | 39,054 | $0.1059 |
| CI status dashboard | html | 1.00 | 14,109 | $0.1197 |
| CSV data table | parchment | 1.00 | 18,106 | $0.0517 |
| CSV data table | html | 1.00 | 10,905 | $0.0528 |
| Architecture diagram | parchment | 1.00 | 17,913 | $0.0478 |
| Architecture diagram | html | 1.00 | 11,295 | $0.0614 |
| Incident report | parchment | 2.00 | 38,354 | $0.0938 |
| Incident report | html | 1.00 | 11,972 | $0.0748 |
| Validated signup form | parchment | 2.00 | 38,077 | $0.0930 |
| Validated signup form | html | 1.00 | 10,749 | $0.0493 |
| Live log dashboard (setup) | parchment | 2.00 | 38,521 | $0.0965 |
| Live log dashboard (setup) | html | 1.00 | 13,027 | $0.0978 |

## One-shot scenarios, opus: 3 most differentiating tasks × both arms × 2 reps

All 12 runs passed validation.

| Scenario | Arm | Passes to correct render | Tokens to first paint | Cost/run |
|---|---|---|---|---|
| CI status dashboard | parchment | 2.00 | 26,360 | $0.1821 |
| CI status dashboard | html | 1.00 | 7,456 | $0.1736 |
| Validated signup form | parchment | 2.00 | 25,754 | $0.1293 |
| Validated signup form | html | 1.00 | 4,484 | $0.0633 |
| Live log dashboard (setup) | parchment | 2.00 | 25,145 | $0.1124 |
| Live log dashboard (setup) | html | 1.00 | 6,418 | $0.1324 |

Read the losses plainly, at the models people actually use:

- **Tokens to first paint: the HTML file wins every scenario at every
  model.** One file write has no MCP schema overhead and no validation
  round-trip.
- **Passes to correct render: the HTML file wins or ties everywhere.**
  Parchment's second pass is its daemon *rejecting* an invalid first spec
  with an exact fix hint; the retry landed in 48/48 sonnet+opus runs and the
  user never sees the broken attempt — but by the raw count the HTML arm
  never needed a second pass at all. The checks are also not equally strict:
  the HTML validator asserts required tags/text exist in the file; the
  parchment validator checks the live daemon actually holds the required
  components.
- **Cost/run is a split decision**: at sonnet, parchment is cheaper on 4 of
  6 scenarios (table, diagram, status dashboard, live-log setup) and loses
  on 2 (incident report, validated form). At opus it is cheaper on 1 of 3.
  Compact specs mean fewer output tokens (the expensive kind), but the
  validation retry eats the margin on the scenarios that trigger it.

### Why parchment retries: prop vocabulary, not model capability

We read every rejection in the sonnet and opus transcripts. The first render
was rejected in 12/18 sonnet and 6/6 opus parchment runs — and virtually
every rejection is the model guessing a plausible-but-wrong **prop enum
value**, dominated by `gap` (models want `"16"` or `"medium"`; the schema
wants `"none"|"sm"|"md"|"lg"|"xl"`) and heading `level` (15 occurrences each
across the sonnet suite), plus scattered `variant`, `xScale`, `direction`,
and one chart-data shape error. **This does not shrink at stronger models**
— opus hit it in 6 of 6 runs, more consistently than haiku (6 of 18),
because stronger models write more expressive specs that touch more typed
props. The daemon's fix-hint loop repaired it in one retry every single
time, but the obvious product fix is upstream: accept the common synonyms or
put the enum values in the tool description.

## Daemon startup (zero LLM cost)

Time from spawning the daemon process to a healthy HTTP endpoint, 5
iterations each:

| | Mean | Median | Min | Max |
|---|---|---|---|---|
| Cold boot (fresh `~/.parchment`) | 205 ms | 204 ms | 203 ms | 209 ms |
| Warm boot (state already initialized) | 204 ms | 204 ms | 203 ms | 204 ms |

No cold-start penalty; first-run initialization is not a meaningful cost.

## Skills delta (appendix, haiku)

Every run above uses `--setting-sources ""`, which strips personal config
*and* plugin skills — the suite measures bare MCP tool descriptions and
doubles as the no-skills control. Re-running status-dashboard/parchment/haiku
(2 reps) with the `canvas-tools` + `canvas-spec` SKILL.md cores (~14.5 KB)
appended via `--append-system-prompt`:

| | Pass rate | Passes to correct render | Tokens to first paint | Cost/run |
|---|---|---|---|---|
| No skills (control, N=3) | 100% | 1.33 | 22,156 | $0.0377 |
| With skill cores (N=2) | 100% | 1.50 | 36,328 | $0.0733 |

The skills did not improve any measured metric on this scenario — they added
prompt overhead to a task that already passed without them. That is the
honest read at this N. The skills' guidance targets composition judgment,
which these structural validators do not score.

## Appendix: haiku suite (cheap-repetition variance check)

6 scenarios × both arms × 3 reps, all 36 passed. Haiku's numbers track the
sonnet shape (HTML wins first paint everywhere; parchment cheaper on 4 of 6),
which is why it remains useful as a low-cost regression check for the
harness itself.

| Scenario | Arm | Passes to correct render | Tokens to first paint | Cost/run |
|---|---|---|---|---|
| CI status dashboard | parchment / html | 1.33 / 1.00 | 22,156 / 11,624 | $0.0377 / $0.0452 |
| CSV data table | parchment / html | 1.00 / 1.00 | 14,117 / 8,923 | $0.0167 / $0.0248 |
| Architecture diagram | parchment / html | 1.00 / 1.00 | 13,856 / 8,972 | $0.0150 / $0.0253 |
| Incident report | parchment / html | 1.00 / 1.00 | 14,935 / 9,667 | $0.0242 / $0.0304 |
| Validated signup form | parchment / html | 2.00 / 1.00 | 32,556 / 8,620 | $0.0353 / $0.0226 |
| Live log dashboard (setup) | parchment / html | 1.67 / 1.00 | 26,232 / 11,428 | $0.0334 / $0.0429 |

A haiku live-update run (same protocol as the sonnet headline) showed the
same zero: 10 updates for 0 tokens on the parchment arm vs 588,317 tokens
across 10 HTML re-prompts.

## Methodology

- **Harness**: `bench/` in this repo. Each run is a headless
  `claude -p <fixed prompt>` with `--output-format json` and a locked-down
  tool surface: the parchment arm gets the canvas MCP server with the
  scenario's one `canvas_*` tool pre-allowed and all built-ins disabled; the
  HTML arm gets exactly `Write,Edit`.
- **Controlled**: personal CLAUDE.md/memory/settings excluded from every run
  (`--setting-sources ""`, which also means no plugin skills — see the
  skills-delta appendix for that measurement); one fresh session per rep
  with a harness-generated session id; the parchment arm talks to a
  disposable daemon with its own HOME and port, never a developer's live
  one; token counts come from the run's own session JSONL, counting cache
  reads/writes as prompt tokens (Anthropic's `input_tokens` alone
  under-reports by ~1000x on cached turns).
- **Not controlled**: model versions and prompt-cache pricing move; N is
  small (2–3 reps per cell, 1 rep for live-update); scenario prompts were
  written once, not tuned per arm; validation strictness differs per arm;
  the sonnet and opus suites ran concurrently on one machine (this cannot
  affect token or cost metrics; wall-clock is not reported for this reason);
  under `--permission-mode bypassPermissions` the parchment arm can reach
  other canvas tools — in practice opus followed its render with a
  `canvas_snapshot` self-check that fails headlessly (no browser tab), and
  that extra turn's cost is included in the parchment totals.
- **passes-to-correct-render** = authoring tool calls until the final
  artifact validated (100% final pass in every cell of every table).
  **tokens-to-first-paint** = cumulative prompt+completion tokens through
  the first accepted authoring call. Full definitions: `bench/README.md`.

## Reproduce

```bash
bun run bench/cli.ts run --models sonnet        # main suite at sonnet (~$2.85)
bun run bench/cli.ts run --scenario status-dashboard,validated-form,live-log-dashboard --models opus --reps 2   # opus pass (~$1.60)
bun run bench/live-update.ts --model sonnet     # tokens-per-live-update (~$0.51)
bun run bench/time-to-first-canvas.ts           # daemon boot timing, $0
bun run bench/skills-delta.ts                   # skills-delta appendix (~$0.15)
```

Requires a Claude Code login; runs never touch your real `~/.parchment`.

## Raw data

Every run's per-run JSON record and full session transcript (JSONL) is
archived under `bench/results/<timestamp>/raw/`. The suites behind this page:

- `bench/results/2026-07-12T15-07-38-053Z/` — 36-run sonnet suite
- `bench/results/2026-07-12T15-07-39-419Z/` — 12-run opus pass
- `bench/results/2026-07-12T15-17-20-070Z-live-update-sonnet/` — live-update at sonnet
- `bench/results/2026-07-12T07-53-15-666Z/` — 36-run haiku suite (appendix)
- `bench/results/2026-07-12T14-44-37-654Z-live-update/` — live-update at haiku
  (an earlier pilot at `...T14-37-26-832Z-live-update/` was discarded for an
  instrumentation bug in its per-step presence check; its cost/token columns
  were sound and are consistent with the kept run)
- `bench/results/2026-07-12T14-37-04-244Z-time-to-first-canvas/` — boot timing
- `bench/results/2026-07-12T14-49-25-121Z-skills-delta/` — skills delta
- `bench/results/2026-07-12T14-36-59-732Z/` — early 2-rep sonnet spot-check,
  superseded by the full sonnet suite above
