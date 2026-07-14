# Authored output tokens to a browser-verified render

- Generated: 2026-07-14T06:53:59.884Z
- Runs: 30 across 3 arms x 2 scenarios x 1 models
- Archive (every number below is reproducible offline from it): `evals/results/2026-07-14T06-29-05-718Z`
- Confidence intervals: percentile bootstrap, 10,000 resamples, 95%, seed `20260713` — deterministic. Proportions use a Wilson score interval.

Acceptance is decided by a real headless browser against a DOM rubric that never imports
parchment code. An arm passes when the page it produced actually paints the required content.

## What we measure, and what we refuse to measure

**THE HEADLINE — authored output tokens.** The output tokens of the single assistant message
that carried the render call (`canvas_render` for the catalog arms, `Write` for raw-html and
raw-jsx). This is the cost of EMITTING the artifact, measured by the same rule for every arm and
read exactly from the transcript. Repairs count: a format that needed three attempts paid for
three artifacts.

**THE SECONDARY NUMBER — session output tokens.** Everything the model emitted: reading files,
running git, thinking, retrying. This is real money and it is published in full (see Session
cost). But it is dominated by AGENTIC EXPLORATION, which is a property of the task and the
harness, not of the format. In the first pilot, one high-fidelity run burned over 11,000 session
output tokens across 11 assistant turns while the artifact it authored cost a small fraction of
that. Leading with that number would have measured how chatty the agent was and called it a
format comparison. Both numbers appear here; neither wears the other's label.

```
authored_output_tokens(run) = output tokens of the render-call message, summed over attempts
session_total_tokens(run)   = system/schema + session output + repair-turn input
```

The initial authoring turn's INPUT is in neither total: it is dominated by a harness constant
that every arm on the same surface pays identically. It is not swept away either — it is printed
raw and harness-subtracted in the decomposition table.

## HEADLINE: authored output tokens to a correct render

The cost of EMITTING the artifact — not the cost of the agent's exploration, which is reported
separately under Session cost. Token columns cover PASSING runs only: a run that never rendered
correctly has no cost-to-a-correct-render. Pass rate sits beside them so a cheap arm that fails
cannot hide. Bytes are exact; tokens are measured from the transcript, not approximated.

**Where parchment loses**

- `parchment-markup-low` on **ladder-csv-table** (sonnet): 7,202 authored output tokens vs `raw-html` 5,609 — parchment is **1.28x worse**.

**Where parchment wins**

- `parchment-markup-high` on **ladder-csv-table** (sonnet): 161 authored output tokens vs `raw-html` 5,609 — parchment is **34.8x better**.
- `parchment-markup-high` on **ladder-log-chart** (sonnet): 1,306 authored output tokens vs `raw-html` 3,577 — parchment is **2.74x better**.
- `parchment-markup-low` on **ladder-log-chart** (sonnet): 1,354 authored output tokens vs `raw-html` 3,577 — parchment is **2.64x better**.

| Arm | Rung | Model | Passed/N | pass@1 | AUTHORED output tokens (mean) | 95% CI | median | min–max | Artifact bytes (EXACT, mean) |
|---|---|---|---|---|---|---|---|---|---|
| `parchment-markup-high` | high | sonnet | 10/10 | 90% | 734 | 379–1,106 | 597 | 149–1,670 | 397 |
| `parchment-markup-low` | low | sonnet | 10/10 | 70% | 4,278 | 2,313–6,374 | 3,205 | 1,069–9,072 | 4,772 |
| `raw-html` | low | sonnet | 10/10 | 90% | 4,593 | 3,723–5,753 | 4,131 | 3,181–8,799 | 7,540 |

## Did the model climb the ladder?

A high-fidelity arm is TOLD, in its system prompt, that it can name a file and have the daemon
fetch the bytes. This section asks whether it actually did. The rate is over ALL runs, not just
passing ones: a run that failed still shows whether the model reached for the reference.

**This is the result most likely to sink the thesis, so it is printed before the win.** If the
compression is available and the model does not take it, the honest headline is not "parchment
is 30x cheaper" — it is "parchment COULD be 30x cheaper, and the model does not do it".

- **INCONCLUSIVE.** 5/10 (50%, 95% CI 24%–76%). The interval straddles half: at this N we cannot say whether the model reliably climbs. Raise `--replicates` before quoting the ladder as a result.

| Scenario | Arm | Rung | Model | Climbed | Rate | 95% CI (Wilson) | Reference used |
|---|---|---|---|---|---|---|---|
| ladder-csv-table | `parchment-markup-low` | low | sonnet | 0/5 | 0% | 0%–43% | none |
| ladder-csv-table | `parchment-markup-high` | high | sonnet | 5/5 | 100% | 57%–100% | `DataTable` |
| ladder-log-chart | `parchment-markup-low` | low | sonnet | 0/5 | 0% | 0%–43% | none |
| ladder-log-chart | `parchment-markup-high` | high | sonnet | 0/5 | 0% | 0%–43% | none |
| ladder-log-chart | `raw-html` | low | sonnet | 0/5 | 0% | 0%–43% | none |
| ladder-csv-table | `raw-html` | low | sonnet | 0/5 | 0% | 0%–43% | none |

Intervals are Wilson score intervals. A rate of 0/3 or 3/3 is exactly where the normal
approximation collapses to zero width and claims certainty from three observations; Wilson keeps
an honest width there.

## The fidelity ladder

Ladder scenarios keep the source data on disk. A high-fidelity arm MAY reference it by path; a
low-fidelity arm and every rival format MUST read it and paste it into the artifact.

Three different numbers live in this table, and they are never added together or swapped:

- **(a) COULD have emitted** — the reference artifact: a static, hand-written floor. Bytes exact,
  tokens APPROXIMATE. This is what the arm was *able* to write. It is NOT a measurement of what
  any model did, and it is never quoted as one.
- **(b) ACTUALLY emitted** — measured authored output tokens, read from the transcript.
- **(c) MUST emit** — the same measured column, read on `raw-html` / `raw-jsx`, which have no
  reference mechanism at all.

**The gap between (a) and (b) is the product's opportunity. The gap between (b) and (c) is the
format's realised win.** Read the ladder-climbing section above before this table: if the model
did not climb, then (a) is a hypothetical and only (b) vs (c) is a result.

**Where parchment loses**

- `parchment-markup-low` on **ladder-csv-table** (sonnet): 7,202 authored output tokens vs `raw-html` 5,609 — parchment is **1.28x worse**.

**Where parchment wins**

- `parchment-markup-high` on **ladder-csv-table** (sonnet): 161 authored output tokens vs `raw-html` 5,609 — parchment is **34.8x better**.
- `parchment-markup-high` on **ladder-log-chart** (sonnet): 1,306 authored output tokens vs `raw-html` 3,577 — parchment is **2.74x better**.
- `parchment-markup-low` on **ladder-log-chart** (sonnet): 1,354 authored output tokens vs `raw-html` 3,577 — parchment is **2.64x better**.

| Arm | Rung | Model | Passed/N | (a) COULD have emitted | (b) ACTUALLY emitted | 95% CI | x vs `parchment-markup-high` (95% CI) |
|---|---|---|---|---|---|---|---|
| `parchment-markup-high` | high | sonnet | 10/10 | NOT MEASURED | 734 | 379–1,106 | 0.46x–2.20x |
| `parchment-markup-low` | low | sonnet | 10/10 | none — no reference mechanism | 4,278 | 2,313–6,374 | 2.73x–12.9x |
| `raw-html` | low | sonnet | 10/10 | none — no reference mechanism | 4,593 | 3,723–5,753 | 3.88x–12.8x |

## Decomposition

The two output columns are the whole argument of this page. **AUTHORED** is the format's cost.
**SESSION** is the agent's cost: it includes reading the file, running git, and thinking, and it
is a property of the task and the harness far more than of the format. Both are real; only the
first one compares formats.

| Arm | Model | Passed/N | AUTHORED output | SESSION output (exploration incl.) | System/schema | Repair turns (in+out) | Input RAW | Input harness-subtracted | pass@1 | pass@3 |
|---|---|---|---|---|---|---|---|---|---|---|
| `parchment-markup-high` | sonnet | 10/10 | 734 | 953 | 4,325 | 5,575 | 73,953 | 22,481 | 90% | 100% |
| `parchment-markup-low` | sonnet | 10/10 | 4,278 | 4,508 | 3,731 | 18,942 | 88,184 | 30,278 | 70% | 100% |
| `raw-html` | sonnet | 10/10 | 4,593 | 4,918 | 131 | 22,122 | 81,297 | 23,525 | 90% | 100% |

## Ablation: real vocabulary vs scrambled vocabulary

Same grammar, same runtime, same schema size. Only the identifiers are opaque. The question is
whether the model's familiarity with real component names is worth anything, or whether the
structure is doing all of the work.

**A null result is a result.** An interval that brackets 1.00x means familiarity bought nothing
measurable at this N, and it is reported as exactly that.

The last two columns carry the BEHAVIOURAL half of the ablation: on ladder scenarios, did the
scrambled arm still reach for the high-fidelity component, or did it fall back to pasting?

- `scrambled-markup-high` vs `parchment-markup-high` (sonnet, authored output): **insufficient data** (no-samples).
- `scrambled-markup-low` vs `parchment-markup-low` (sonnet, authored output): **insufficient data** (no-samples).

| Rung | Model | Real vocab AUTHORED (mean) | Scrambled AUTHORED (mean) | Scrambled / real (95% CI) | Real pass@1 | Scrambled pass@1 | Real climbed | Scrambled climbed |
|---|---|---|---|---|---|---|---|---|
| high | sonnet | 734 | NOT MEASURED | insufficient data (no-samples) | 90% | n/a | 5/10 | n/a |
| low | sonnet | 4,278 | NOT MEASURED | insufficient data (no-samples) | 70% | n/a | 0/10 | n/a |

## Format density (notation cost per artifact)

This is the table where the terse formats are expected to WIN, and it is sorted densest-first so
they appear at the top. It is printed plainly because it does not decide the argument: density is
a per-character property, while the fidelity ladder is a per-ELEMENT property. A notation that
spells a diff in 20% fewer characters still has to spell the whole diff.

**Bytes are exact. TOKEN COLUMNS ARE APPROXIMATIONS, not model tokenization.** No tokenizer is
reachable offline here (subscription-only Claude Code, no Console API key), so these columns are
computed, not measured. The HEADLINE authored-token numbers do NOT come from here — they are read
from the transcripts and are exact. These approximations are load-bearing for exactly one thing:
the static reference floor, column (a) of the ladder table, which is labelled approximate there.

- Method: Character-class segmentation. Word runs ([A-Za-z0-9_]+) cost ceil(length/4) tokens; a lone space costs 0 (BPE absorbs it into the following piece); a run of 2+ spaces costs ceil(length/4); each newline costs 1; every other character (punctuation, brackets, operators, non-Latin) costs 1. The bytes/4 rule-of-thumb is printed beside it as a second, cruder approximation so a reader can see how sensitive the number is to method.
- Known error: Against a real BPE tokenizer this typically lands within ~10-20% on JSON/HTML/JSX/markup. It OVER-counts punctuation-dense text (real tokenizers merge sequences like `");` or `",` into one token) and UNDER-counts unusual long identifiers, base64, and non-Latin text (which split into more pieces than length/4). Bytes/4 errs the other way on markup. Neither is exact, and no claim in this report depends on either: the headline numbers are measured output tokens from the run transcripts, which are exact.
- Sanity check: across 25 single-attempt passing runs, the approximated artifact accounts for 46% of the MEASURED session output tokens on average (range 6%–96%). Values well under 100% are expected: the session also paid for exploration the artifact never contained.

| Scenario | Arm | Artifact source | Bytes (EXACT) | Tokens (approx., segmentation) | Tokens (approx., bytes/4) |
|---|---|---|---|---|---|
| ladder-csv-table | `parchment-markup-high` | accepted-run | 74 | ~30 | ~19 |
| ladder-log-chart | `parchment-markup-high` | accepted-run | 652 | ~307 | ~163 |
| ladder-log-chart | `parchment-markup-low` | accepted-run | 746 | ~348 | ~187 |
| ladder-log-chart | `raw-html` | accepted-run | 4,949 | ~2,235 | ~1,238 |
| ladder-csv-table | `raw-html` | accepted-run | 7,853 | ~3,479 | ~1,964 |
| ladder-csv-table | `parchment-markup-low` | accepted-run | 8,574 | ~4,396 | ~2,144 |

## Session cost (the agent's bill, not the format's)

**This is the money, and it is NOT the format comparison.** These numbers include every token the
agent spent exploring — reading the file, running git, thinking, retrying. They are the honest
answer to "what did this cost me", and a misleading answer to "which format is cheaper", because
a chatty agent and an expensive format are indistinguishable in this column. The format
comparison is the HEADLINE table.

Both cache numbers are true. **Cold-cache** prices every cache-read token as if it were fresh
input: on the first call of the day nobody's cache is warm. **Warm-cache** prices cache reads at
the cache-read rate — the steady state a returning user pays.

The CLI-reported column is Claude Code's own figure, printed so our arithmetic can be checked
against it. It is known to under-report on cached turns; where it disagrees, the token math is
the number to trust.

**Where parchment loses**

- `parchment-markup-low` on **ladder-csv-table** (sonnet): $0.1948 per correct render (warm) vs `raw-html` $0.1658 — parchment is **1.17x worse**.

**Where parchment wins**

- `parchment-markup-high` on **ladder-csv-table** (sonnet): $0.0537 per correct render (warm) vs `raw-html` $0.1658 — parchment is **3.09x better**.
- `parchment-markup-low` on **ladder-log-chart** (sonnet): $0.0906 per correct render (warm) vs `raw-html` $0.1173 — parchment is **1.29x better**.
- `parchment-markup-high` on **ladder-log-chart** (sonnet): $0.0955 per correct render (warm) vs `raw-html` $0.1173 — parchment is **1.23x better**.

| Arm | Model | Passed/N | SESSION tokens to correct render | Cold-cache $ | Warm-cache $ | CLI-reported $ | Cold spend incl. failures (total) |
|---|---|---|---|---|---|---|---|
| `parchment-markup-high` | sonnet | 10/10 | 10,799 | $0.2362 | $0.0746 | $0.1176 | $2.3616 |
| `parchment-markup-low` | sonnet | 10/10 | 25,782 | $0.3322 | $0.1427 | $0.1975 | $3.3217 |
| `raw-html` | sonnet | 10/10 | 26,618 | $0.3177 | $0.1416 | $0.1905 | $3.1766 |

## Methodology (for a hostile reader)

### WHAT IS NOT SHIPPED

**The high-fidelity reference components are not in parchment's shipped catalog.** `GitDiff` and
`LogStream` do not exist in the product at all. `DataTable src=` and `CodeBlock file=` are
reference-prop forms the shipped catalog does not accept. They are AUTHORING-side intents, and
this eval's own resolver (`evals/hydration/resolvers.ts`) lowers them into real catalog
components (DiffViewer, Chart, DataTable, CodeBlock) whose props the model never had to emit. The
real hydration engine lives on an unmerged branch.

So, precisely:

- **REAL, and what this eval measures:** what the model had to EMIT to reach a correct render.
  Those tokens were really spent by a real model, and the page really painted in a real browser.
- **NOT YET REAL:** the daemon fulfilling those references in production. A user cannot do this
  today.

Any claim of the form "parchment renders a diff in 50 tokens" is a claim about a product that
does not exist yet. Read every ladder number with that sentence in front of you.

### Exact models

- `sonnet` -> `NOT RECORDED IN THE ARCHIVE`
- Claude Code version: NOT RECORDED IN THE ARCHIVE
- Prices are the published per-million rates in `evals/config.ts`.

### Exact prompts

Every arm's system prompt, every task prompt, the session JSONL, and the artifact the model
produced were archived verbatim with the run that used them, under `evals/results/2026-07-14T06-29-05-718Z`.
Nothing here was typed by hand: regenerate it with `bun run evals/cli.ts report --from <archive>`
and every number reappears, including the confidence intervals, which are seeded.

### How the headline number is measured

`authoredOutputTokens` is the output-token count of the single assistant message that carried the
render call — `canvas_render` for the catalog arms, `Write` for raw-html and raw-jsx. It is read
from the transcript, not estimated from a character count, and it is derived by the SAME rule for
every arm. It is summed across attempts, so a format that needed three tries pays for three
artifacts. An attempt that never authored anything contributes 0: it did not pay the format's
cost, because it never produced the format.

`usedReference` is set when the artifact the model emitted into the tool call actually used a
reference component. It is read from what was emitted — not inferred from the artifact's size.

An archive that predates these fields prints **NOT MEASURED**. Nothing is backfilled or
reconstructed after the fact.

### How repairs were counted

A failed artifact is handed back to the model with its OWN toolchain's error signal (its
compiler's issues, its validator's issues, the browser's console errors) plus the rubric's
"missing from the page" list, phrased identically for every arm. Up to 3 repair
turns are allowed, so a run is at most 4 attempts, and a repair resumes the
same session so the model can see what it wrote. `pass@1` is the fraction of runs whose FIRST
attempt was accepted; `pass@3` is the fraction accepted within three attempts.

### The harness constant, and how it was measured

Claude Code injects its own system prompt and tool schemas into every arm before the arm has said
anything. It is MEASURED, not estimated: one control turn per authoring surface, through the same
harness, with a trivial task and no arm system prompt. The constant is the prompt tokens of the
FIRST assistant message — everything the model read before it had written anything.

- `sonnet` / `canvas-tool`: 16,085 tokens
- `sonnet` / `written-file`: 15,614 tokens

Measured per SURFACE because the tool schemas differ (canvas_render's schema vs Write's). It is
subtracted once per assistant turn and floored at zero. It lands in the INPUT columns only, never
in output — so it cannot bias the headline.

Worked example from this archive: `127312 raw prompt tokens - (16085 harness constant x 5 assistant turns) = 46887`.

Input RAW and input harness-subtracted are printed side by side. Subtract it or restore it
yourself; the report never does it quietly.

### Confidence intervals

Percentile bootstrap: the sample is resampled with replacement, the statistic is recomputed on each resample, and the interval is the empirical [alpha/2, 1-alpha/2] quantiles of those resampled statistics (R type-7 interpolation). Resampling is driven by mulberry32 seeded with a fixed constant, so every published bound reproduces exactly. Seed: `20260713`. Resamples: 10,000. Confidence: 95%.

Wilson score interval. A rate that sits at 0/N or N/N is exactly where the normal approximation degenerates to zero width and claims certainty it has not earned; Wilson keeps an honest width at the boundary, which is the regime this eval's small N lives in.

A cell with fewer than two passing runs prints `insufficient data` rather than a point estimate
dressed up as a measurement.

### What we did NOT control for

- **Model nondeterminism.** Temperature is not pinnable through the Claude Code path. Replicates
  are the only defence, and N per cell is small.
- **Agentic exploration.** How much the model reads, greps, and thinks before it authors is a
  property of the task and the harness, and it varies enormously run to run. This is precisely
  why the headline is the authored artifact and not the session.
- **Prompt-writing skill.** Each arm's system prompt was written by us. A better prompt for a
  rival format exists, and we did not find it. This cuts both ways: a better prompt for OUR arm
  might also make the model climb the ladder — which the section above says we failed to get.
- **Model familiarity with HTML.** HTML and JSX are overwhelmingly represented in pretraining;
  parchment's vocabulary is not. This cuts AGAINST parchment, and we did not correct for it.
- **Scenario selection.** We chose the scenarios, and we chose them to exercise the ladder —
  which is the hypothesis under test. That is the point, and it is also the bias.
- **Cache state across runs.** Cache hits depend on run order; that is why both the cold and the
  warm cost columns are published instead of one blended number.

### NOT TESTED — and this is THE open question

**Strict tool use / grammar-constrained decoding is UNREACHABLE through Claude Code's MCP path,
and was NOT tested.** Reaching it needs a Console API key, which this eval does not have: it runs
on a subscription. This gap matters more than any other on this page, for two reasons:

1. A constrained decoder would likely eliminate the rival formats' syntax errors and cut their
   repair turns — so the arm most likely to benefit is the one we beat.
2. It is also the most plausible mechanism for making a model actually USE a reference component
   instead of pasting a file. The ladder-climbing failure reported above might simply not survive
   it.

We did not simulate it, and we claim nothing about it. Anyone with a Console API key can settle
it, and until someone does, this page has an open question at its centre.

Also not measured: streaming and partial-render latency; human preference and aesthetic quality;
multi-turn conversational editing of an existing canvas; any model not listed above.

### How to falsify this

1. **Make the model climb.** If a better system prompt (or a constrained decoder) makes the
   high-fidelity arm reach for the reference component reliably, the ladder becomes a measured
   result instead of an opportunity. If nothing makes it climb, the ladder is worth nothing in
   practice, no matter how good column (a) looks.
2. **Kill the ladder.** Give a rival format a reference mechanism its runtime hydrates. If the
   authored-token gap survives that, the claim is about the ladder. If it collapses, the claim
   was only ever about a missing feature in the rivals.
3. **Rewrite our rival prompts.** They are archived. If a better raw-HTML system prompt closes the
   authored-token gap, say so with the run records.
4. **Raise N.** Every interval here is over a small sample. Raise `--replicates` until the
   intervals separate or overlap decisively.
5. **Change the rubric.** It is pure data and imports no parchment code. If it flatters us, edit
   the assertions and re-run.
6. **Check the arithmetic offline.** `report --from <archive>` recomputes every table from the raw
   records without calling a model. The intervals are seeded, so they must come back identical. If
   they do not, something is wrong and you should not trust this page.
