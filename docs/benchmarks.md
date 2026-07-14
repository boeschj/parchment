# Benchmarks

> **⚠️ These results are INVALIDATED pending re-measurement (2026-07-13).**
> Internal review found the acceptance rubric only counted component types —
> it never verified props, data bindings, rendered DOM, or interactions.
> Specs with silently-stripped unknown props (e.g. a Chart with no `kind` or
> `data`) were counted as passing. The first-pass-rate and win/loss tables
> below therefore overstate parchment and must not be cited. A rebuilt
> harness with browser-real, identical-rubric acceptance for every arm is in
> progress; numbers will be republished — whatever they say. The daemon
> startup timings and the tool-surface measurements are unaffected (they do
> not depend on the invalid rubric).


Measured comparisons between parchment's `canvas_*` MCP tools and the obvious
baseline: the model writing a single self-contained HTML file. The one-shot
scenario numbers below come from real headless `claude -p` runs on
2026-07-12 (Claude Code 2.1.207; `sonnet` = claude-sonnet-4-5, `opus` =
claude-opus-4-8, `haiku` = claude-haiku-4-5), archived with full session
transcripts under `bench/results/`. Sonnet and opus are the primary
results — they are what Claude Code users actually run; haiku is kept as a
cheap-repetition variance check in the appendix.

**This page reflects two rounds of spec-repair fixes** landed after the
original full suite: shrinking the canvas tool surface (14 → 8 tools),
auto-repairing enum synonyms (gap numbers/words, heading levels, variants,
xScale), and a second pass of dialect repair (prop aliases like Chart's
xKey/yKeys → x/y and DataTable's data → rows, `"$state.path"` shorthand
strings, number → string coercion for props like Metric's delta, Form →
Card). **The HTML arm is unchanged throughout this page** — none of these
fixes touch it — so every HTML number below is reused from the original
full suite; only the parchment numbers are new. See "Finding and fixing our
failure modes" below for the full before/after.

The short version: **the fixes closed the first-paint gap.** Before them,
the HTML file won tokens-to-first-paint at every model on every scenario,
because roughly a third of parchment's first render attempts were rejected
and cost a retry. After them, every one of 24 fresh runs (sonnet + opus)
landed in one attempt, and parchment now wins tokens-to-first-paint on 5 of
6 sonnet scenarios and 2 of 3 opus scenarios. The one holdout, at both
models, is the validated signup form — printed plainly below, not hidden.

## Headline: what a live dashboard costs to keep updated (sonnet)

*Measured before the round-2 dialect-repair fixes below; not re-run for this
page. The zero-token live-update claim is architectural (the daemon streams
file-tail/poll updates into slot state with no LLM call in the loop) and is
unaffected by the spec-repair fixes, but the initial-compose dollar figure
below predates them and would likely drop under the same fixes as the
one-shot scenarios.*

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

## One-shot scenarios, sonnet: 6 tasks × parchment (new) vs html (unchanged) × 3 reps

All 18 new parchment runs passed validation (100% in every cell); the reused
HTML numbers are the same 18/18-passing runs as before. Means below;
median/min/max are in the archived reports
(`bench/results/2026-07-12T22-28-37-337Z/` for parchment,
`bench/results/2026-07-12T15-07-38-053Z/` for the reused HTML arm).

| Scenario | Arm | Passes to correct render | Tokens to first paint | Cost/run | vs HTML |
|---|---|---|---|---|---|
| CI status dashboard | parchment | 1.00 | 11,583 | $0.0766 | **win** both metrics |
| CI status dashboard | html | 1.00 | 14,109 | $0.1197 | |
| CSV data table | parchment | 1.00 | 10,699 | $0.0508 | **win** both metrics (thin, ~2%) |
| CSV data table | html | 1.00 | 10,905 | $0.0528 | |
| Architecture diagram | parchment | 1.00 | 10,428 | $0.0454 | **win** both metrics |
| Architecture diagram | html | 1.00 | 11,295 | $0.0614 | |
| Incident report | parchment | 1.00 | 11,063 | $0.0568 | **win** both metrics |
| Incident report | html | 1.00 | 11,972 | $0.0748 | |
| Validated signup form | parchment | 1.00 | 11,481 | $0.0674 | **loss** both metrics |
| Validated signup form | html | 1.00 | 10,749 | $0.0493 | |
| Live log dashboard (setup) | parchment | 1.00 | 11,346 | $0.0641 | **win** both metrics |
| Live log dashboard (setup) | html | 1.00 | 13,027 | $0.0978 | |

## One-shot scenarios, opus: 3 most differentiating tasks × parchment (new) vs html (unchanged) × 2 reps

All 6 new parchment runs passed validation; the reused HTML numbers are the
same 6/6-passing runs as before
(`bench/results/2026-07-12T22-32-01-708Z/` for parchment,
`bench/results/2026-07-12T15-07-39-419Z/` for the reused HTML arm).

| Scenario | Arm | Passes to correct render | Tokens to first paint | Cost/run | vs HTML |
|---|---|---|---|---|---|
| CI status dashboard | parchment | 1.00 | 5,828 | $0.0926 | **win** both metrics |
| CI status dashboard | html | 1.00 | 7,456 | $0.1736 | |
| Validated signup form | parchment | 1.00 | 5,564 | $0.0815 | **loss** both metrics |
| Validated signup form | html | 1.00 | 4,484 | $0.0633 | |
| Live log dashboard (setup) | parchment | 1.00 | 5,485 | $0.0767 | **win** both metrics |
| Live log dashboard (setup) | html | 1.00 | 6,418 | $0.1324 | |

Read the current state plainly, at the models people actually use:

- **Passes to correct render is now 1.00 everywhere, at every model.** Zero
  of the 24 fresh runs (18 sonnet + 6 opus) needed a retry — down from
  12/18 sonnet and 6/6 opus runs rejected on the old tool surface. See
  "Finding and fixing our failure modes" below for what closed this.
- **Tokens to first paint: parchment now wins 5 of 6 sonnet scenarios and 2
  of 3 opus scenarios.** Averaged across all 6 sonnet scenarios, parchment's
  mean tokens-to-first-paint fell from 31,671 (2.6x worse than HTML's
  12,010) to 11,100 (8% *better* than HTML's 12,010) — without HTML
  changing at all. Opus shows the same shape: parchment's mean fell from
  25,753 (4.2x worse than HTML's 6,119) to 5,626 (8% better).
- **Cost/run: parchment now wins 5 of 6 sonnet scenarios and 2 of 3 opus
  scenarios** — the same single holdout both times (validated signup form).
  Averaged across scenarios, parchment's mean cost/run went from roughly
  breakeven-to-worse (sonnet: $0.0815 vs HTML's $0.0760; opus: $0.1413 vs
  HTML's $0.1231) to a clear win (sonnet: $0.0602 vs $0.0760, a 21%
  saving; opus: $0.0836 vs $0.1231, a 32% saving).
- **The one remaining loss, at both models: the validated signup form.**
  Three native HTML5 attributes (`required`, `type="email"`,
  `minlength="8"`) are simply cheaper than a JSON component tree describing
  three controlled `Input`s, a `Button`, and a `canvas.submit` wire-up — this
  is a structural cost of the JSON-spec approach for trivial forms, not a
  bug. It is the only scenario where the fixes did not flip the outcome.
- **The checks remain unequally strict**: the HTML validator asserts
  required tags/text exist in the file; the parchment validator checks the
  live daemon actually holds the required components. This asymmetry
  predates and is unrelated to the round 1/round 2 fixes.

## Finding and fixing our failure modes

Three snapshots of the same 6 sonnet / 3 opus scenarios, same prompts, same
validators — only the canvas tool surface and its spec-repair logic changed
between them. Cells read **passes to correct render / tokens to first paint
/ cost per run** (means).

*Old surface*: the original 14-tool MCP surface (~5.5k tokens of schema),
no repair logic — `bench/results/2026-07-12T15-07-38-053Z/` (sonnet),
`bench/results/2026-07-12T15-07-39-419Z/` (opus).
*+Surface slim & enum repair (round 1)*: tool surface shrunk 14→8
(~2.4k tokens), plus auto-repair of enum synonyms (gap numbers/words,
heading levels, variants, xScale) —
`bench/results/2026-07-12T19-52-34-791Z/` (sonnet),
`bench/results/2026-07-12T19-52-36-323Z/` (opus). **These runs predate the
`--disallowedTools` harness fix**: under `bypassPermissions`,
`--allowedTools` is a pre-approval, not a restriction, so the parchment arm
could still call `canvas_snapshot` after rendering — which fails headlessly
(no browser tab) and burns an extra turn. Some of round 1's improvement over
old-surface is real (enum repair); some of its remaining cost is this
harness artifact, not a spec problem. Round 1 is a partial pass (retries
were still present on 4 of 6 sonnet scenarios and all 3 opus scenarios) —
included here for the progression, not as a clean data point on its own.
*+Dialect repair (round 2, current)*: adds prop-alias repair (Chart's
xKey/yKeys → x/y, DataTable's data → rows, column `label` → `header`),
`"$state.path"` shorthand → expression objects, number → string coercion,
Form → Card, plus the `--disallowedTools` harness fix that stops the
canvas_snapshot turn burn — the results tables above.

### Sonnet

| Scenario | Old surface | +Surface slim & enum repair (round 1) | +Dialect repair (round 2, current) |
|---|---|---|---|
| CI status dashboard | 2 / 39,054 / $0.1059 | 2 / 24,958 / $0.1005 | 1 / 11,583 / $0.0766 |
| CSV data table | 1 / 18,106 / $0.0517 | 2 / 27,789 / $0.0641 | 1 / 10,699 / $0.0508 |
| Architecture diagram | 1 / 17,913 / $0.0478 | 1 / 13,426 / $0.0469 | 1 / 10,428 / $0.0454 |
| Incident report | 2 / 38,354 / $0.0938 | 1 / 14,129 / $0.0595 | 1 / 11,063 / $0.0568 |
| Validated signup form | 2 / 38,077 / $0.0930 | 1 / 14,587 / $0.0736 | 1 / 11,481 / $0.0674 |
| Live log dashboard (setup) | 2 / 38,521 / $0.0965 | 2 / 28,662 / $0.0770 | 1 / 11,346 / $0.0641 |

### Opus

| Scenario | Old surface | +Surface slim & enum repair (round 1) | +Dialect repair (round 2, current) |
|---|---|---|---|
| CI status dashboard | 2 / 26,360 / $0.1821 | 2 / 18,784 / $0.1639 | 1 / 5,828 / $0.0926 |
| Validated signup form | 2 / 25,754 / $0.1293 | 2 / 18,162 / $0.1274 | 1 / 5,564 / $0.0815 |
| Live log dashboard (setup) | 2 / 25,145 / $0.1124 | 2 / 17,643 / $0.1105 | 1 / 5,485 / $0.0767 |

Every cell in every phase passed validation (100%) — passes-to-correct-render
was never about correctness, only how many attempts and tokens it took to
land there. What moved is attempts-to-first-paint (2 → sometimes 1 → always
1) and the token/cost tax each retry carried.

### Why parchment used to retry — and what fixed it

We read every rejection in the original sonnet and opus transcripts. The
first render was rejected in 12/18 sonnet and 6/6 opus parchment runs on the
old surface — and virtually every rejection was the model guessing a
plausible-but-wrong **prop enum value or dialect**, dominated by `gap`
(models want `"16"` or `"medium"`; the schema wants
`"none"|"sm"|"md"|"lg"|"xl"`) and heading `level` (15 occurrences each
across the sonnet suite), plus scattered `variant`, `xScale`, `direction`,
Chart's `xKey`/`yKeys` vs `x`/`y`, DataTable's `data` vs `rows`, and
`"$state.path"`-shorthand strings where an expression object was expected.
This did not shrink at stronger models — opus hit it in 6 of 6 runs, more
consistently than haiku (6 of 18), because stronger models write more
expressive specs that touch more typed props. The daemon's fix-hint loop
repaired it in one retry every time, so no user-visible run ever shipped
broken — but the retry still cost real tokens and dollars. The product fix
was upstream, not downstream: teach the daemon to auto-repair the common
synonyms and shorthands before rejecting, rather than relying on the model
to read a fix hint and try again. Post-fix, 0 of 24 fresh runs (sonnet +
opus) were rejected on the first attempt.

## Wall-clock to first render (sonnet)

Mean seconds per run from the same suites as above (parchment post-fix run
2026-07-12T22-28-37-337Z vs the unchanged html arm from
2026-07-12T15-07-38-053Z). Turn latency is dominated by output-token
generation, so authoring a compact spec instead of a styled document is
faster in proportion to the output saved. Output tokens shown alongside.

| Scenario | parchment s | html s | Speedup | parchment out-tokens | html out-tokens |
|---|---:|---:|---:|---:|---:|
| Architecture diagram | 3.8 | 9.8 | 2.6x | 246 | 997 |
| CSV data table | 5.9 | 7.1 | 1.2x | 511 | 586 |
| Incident report | 7.3 | 14.8 | 2.0x | 767 | 1,619 |
| Live log dashboard | 11.9 | 21.9 | 1.8x | 1,153 | 2,732 |
| CI status dashboard | 12.3 | 27.7 | 2.2x | 1,341 | 3,755 |
| Validated signup form | 13.8 | 6.2 | **0.5x (loss)** | 1,325 | 412 |
| **Mean** | **9.2** | **14.6** | **1.6x** | 891 | 1,684 |

The signup form is slower for the same structural reason it costs more
tokens: three native HTML5 attributes out-compress an equivalent JSON input
tree. Every other scenario renders 1.2–2.6x faster.

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

6 scenarios × both arms × 3 reps, all 36 passed. **Not re-run for this
page** — these numbers predate both rounds of spec-repair fixes and
reflect the old 14-tool surface, so they track the *old* sonnet shape (HTML
wins first paint everywhere; parchment cheaper on 4 of 6) rather than the
fixed one above. Haiku remains useful as a low-cost regression check for the
harness itself; re-running it post-fix is the natural next cheap pass.

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
  under-reports by ~1000x on cached turns). As of the round-2 dialect-repair
  pass, the parchment arm also passes `--disallowedTools` for every
  off-scenario canvas tool: under `--permission-mode bypassPermissions`,
  `--allowedTools` is only a pre-approval, not a restriction, so without
  this the model could still call `canvas_snapshot` after rendering, which
  fails headlessly (no browser tab) and burns an extra turn. The original
  full suite and the round-1 partial pass (see "Finding and fixing our
  failure modes") predate this fix and carry that extra turn's cost in
  their parchment totals; every number in this page's headline tables was
  measured after the fix landed.
- **Not controlled**: model versions and prompt-cache pricing move; N is
  small (2–3 reps per cell, 1 rep for live-update); scenario prompts were
  written once, not tuned per arm; validation strictness differs per arm;
  sonnet and opus suites have run both concurrently and sequentially across
  different passes on one machine (this cannot affect token or cost metrics,
  which is why wall-clock is not reported anywhere on this page).
- **passes-to-correct-render** = authoring tool calls until the final
  artifact validated (100% final pass in every cell of every table).
  **tokens-to-first-paint** = cumulative prompt+completion tokens through
  the first accepted authoring call. Full definitions: `bench/README.md`.

## Reproduce

```bash
bun run bench/cli.ts run --scenario all --arms parchment --models sonnet --reps 3   # parchment arm, sonnet (~$1.08 measured)
bun run bench/cli.ts run --scenario status-dashboard,validated-form,live-log-dashboard --arms parchment --models opus --reps 2   # parchment arm, opus (~$0.50 measured)
bun run bench/cli.ts run --models sonnet        # both arms, sonnet, if you need fresh HTML numbers too (~$2.85)
bun run bench/live-update.ts --model sonnet     # tokens-per-live-update (~$0.51)
bun run bench/time-to-first-canvas.ts           # daemon boot timing, $0
bun run bench/skills-delta.ts                   # skills-delta appendix (~$0.15)
```

Requires a Claude Code login; runs never touch your real `~/.parchment`.

## Raw data

Every run's per-run JSON record and full session transcript (JSONL) is
archived under `bench/results/<timestamp>/raw/`. The suites behind this page:

- `bench/results/2026-07-12T22-28-37-337Z/` — **current**: 18-run sonnet
  parchment-arm pass, post round-1 + round-2 spec-repair fixes (this page's
  sonnet parchment numbers)
- `bench/results/2026-07-12T22-32-01-708Z/` — **current**: 6-run opus
  parchment-arm pass, post round-1 + round-2 fixes (this page's opus
  parchment numbers)
- `bench/results/2026-07-12T15-07-38-053Z/` — 36-run sonnet suite, old
  14-tool surface, no repair (source of the reused HTML numbers + the "old
  surface" column in the progression table)
- `bench/results/2026-07-12T15-07-39-419Z/` — 12-run opus pass, old surface
  (source of the reused HTML numbers + the "old surface" column)
- `bench/results/2026-07-12T19-52-34-791Z/` — 18-run sonnet parchment-arm
  pass, post round-1 (surface slim + enum repair) only, predates the
  `--disallowedTools` harness fix (the progression table's round-1 column)
- `bench/results/2026-07-12T19-52-36-323Z/` — 6-run opus parchment-arm pass,
  post round-1 only, predates the `--disallowedTools` harness fix (the
  progression table's round-1 column)
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
