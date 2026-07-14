# Parchment benchmark — the fidelity ladder

**Pilot result, re-run 2026-07-14 against the SHIPPED product. Three scenarios, one
model (sonnet), N=5, browser-verified.** Full report:
`evals/results/2026-07-14T20-00-00-000Z-corrected-harness/report.md`.

## Read this first: the earlier numbers were measured against a mirror

Every number previously on this page was produced by a harness that **vendored its own
copy of the product**. The eval drove a forked markup compiler (`evals/vendor/markup/`)
and a stubbed reimplementation of reference hydration (`evals/hydration/resolvers.ts`),
written when both were unmerged branches. They merged (b12803c, 43e3ed2). The copies
stayed. They drifted.

Those copies are **deleted**. `evals/` now imports `src/daemon/markup`,
`src/daemon/spec-validation`, and pushes to a real parchment daemon that hydrates the
references itself — the same path `canvas_render` runs for a user. The grammar the model
is shown is now *derived* from the shipped component contracts, and
`evals/catalog/vocabulary.test.ts` fails if the two ever diverge again.

**The numbers below are against shipped code.** They are not the same as the old ones.

---

## THE FINDING THAT COMES FIRST: the corrected harness found a real bug in our product

**git-diff did not reproduce.** On the first re-run, the model authored the reference
component in 5/5 runs — and then *threw it away and pasted the file by hand*, at
~9,000 tokens a run. The 51x win vanished to nothing.

The reference was not the problem. **The shipped hydrator was.** `<GitDiff>` was
rendering **one-sided**, silently:

```
before length: 0
after  length: 9988
```

`src/daemon/hydrate/git.ts` resolved the git repo from the **session's cwd** instead of
from the **file**. When the file lives in a repo *below* cwd — a submodule, a vendored
checkout, the benchmark's own fixture repo — `git rev-parse --show-toplevel` answered for
the *outer* repo, where the file's path does not exist at any revision. `git show` failed,
the failure was read as "the file is new, so it has no before", and the DiffViewer painted
a **blank left pane**. No error. Half a diff.

The model saw half a diff, correctly concluded the reference had not done its job, and
pasted the whole file. It was right. **We would have published "the reference does not
pay" and been wrong about our own product.**

Fixed in `a6b74e0` (resolve the repo from the file; the regression test pins the
nested-repo case and fails without the fix). Post-fix, git-diff reproduces. **This is the
benchmark doing its job, and it is the strongest argument in this document for having
deleted the mirror.**

---

## The log scenario: the model now climbs, and the product fix is why

This is the row the last report led with as a failure. It has changed.

| log-chart | Climbed the ladder | Authored tokens (median) | Gap vs `low` |
|---|---:|---:|---:|
| **BEFORE** (vendored harness, old grammar) | **0/5** | 1,108 | **1.2x — no win** |
| **AFTER** (shipped product) | **5/5** | 800 | **1.9x** |

**The cause is named.** The old grammar the harness showed the model was
`groupBy="hour|day|week"`, with no way to filter or aggregate. The task asks for
**ten-minute** buckets. The reference genuinely could not express the question, so the
model — correctly — did the aggregation itself. We published that as a product finding.
**It was a harness bug**: the shipped `LogStream` had already gained real durations plus
`match`/`series`/`metric`. The model was simply never told.

Told the real grammar, it reaches for it every time, and the artifact *is* the question:

```
<LogStream file="logs/app.log" match="ERROR" groupBy="10m" kind="bar" />
```

The daemon reads the log, buckets it, counts the ERROR lines, and fills the chart's
`data`, `x` and `y`. The model never opens the file. The painted chart carries the
fixture's real, hand-counted numbers — `0, 1, 5, 11, 4, 1`, peak 11 at 09:30.

**And yet the win is 1.9x, not 6x — and the reason is uncomfortable, so it is stated
plainly.** The model's *first* artifact is **251 tokens** against the low arm's 1,499 —
a **6x** compression, first try, every time. It then **fails the rubric** and has to spend
a second turn:

```
content-non-empty: 124 non-whitespace characters painted, expected >= 200
```

The rubric requires a page to paint ≥200 visible characters. A page that is *nothing but a
correct chart* paints 124 — a title, six axis labels, six bar values. **The rubric's
anti-emptiness floor rejects the maximally-compressed artifact**, and the model buys its
way past it with prose it did not need. That prose is what takes 251 tokens to 800.

That floor was written when no arm could produce a page that terse. It is arguably wrong.
**We did not touch it.** Changing the test because it stopped flattering the product is the
exact Goodhart move this whole exercise exists to root out, and the same floor applies to
every arm. It is reported as a limitation, not edited into a win.

---

## The headline table

**Authored output tokens** = the output tokens of the single assistant message carrying the
render call, summed across repair turns, by the same rule for every arm.

| Scenario | `parchment-markup-high` | `parchment-markup-low` (must paste) | `raw-html` | Climbed | Gap (high vs low) |
|---|---:|---:|---:|---:|---:|
| git-diff (250-line change) | **160** | 8,949 | 23,952 | 4/5 | **56x** |
| csv-table (50 rows) | **168** | 8,906 | 4,325 | 5/5 | **53x** |
| log-chart (100 lines) | **800** | 1,499 | 3,679 | 5/5 | **1.9x** |

Medians. The mean tells a second story worth telling, so here it is: on git-diff the mean is
**1,947**, not 160, because **one run in five declined the ladder** and pasted the file
(9,105 tokens) even though the reference worked. The other four authored ~160 tokens. That
dispersion is real, and it is the model's, not the harness's.

The entire artifact, in the runs that climbed:

```
<GitDiff file="repo/src/server.ts" base="HEAD~1" />               51 bytes
<DataTable caption="Benchmark Results" src="data/results.csv" />  64 bytes
<LogStream file="logs/app.log" match="ERROR" groupBy="10m" />
```

**Aggregate ladder-climb rate: 14/15 (93%, 95% CI 70%–99%)** — up from 10/15, and the
interval now clears half. Cost per run: `high` **$0.139** · `low` $0.301 · `raw-html` $0.564.

**The honest range is 1.9x–56x, and it depends entirely on the task.** Quoting "56x" as
parchment's number would be dishonest. The payoff is a function of payload size × reference
expressiveness: a reference is worth 56x when it replaces a 250-line diff, 53x when it
replaces 50 CSV rows, and **1.9x when the answer is six numbers** — and even that 1.9x is
suppressed by a rubric floor rather than by the format.

## Where it still costs us

- **`parchment-markup-low` LOSES to `raw-html` on csv-table** (8,046 vs 6,013 authored,
  mean — 1.34x worse). Pasting 50 rows through a spec is more verbose than pasting them
  into an HTML table. The low arm is a control, and it is losing honestly.
- **One git-diff run in five did not climb**, despite a working reference.
- The log arm needs a second turn to satisfy the rubric's content floor, every time.

## The half of the thesis that DIED

*(Measured on the pre-correction harness at N=5, one scenario. It has NOT been re-run. A
null result does not become more or less true when the harness is corrected — but its
provenance is disclosed here rather than buried.)*

We predicted that familiar, top-of-distribution vocabulary (`<GitDiff>`, `<Chart>`) would
beat opaque names, because familiarity is itself a compression and reliability mechanism.
**It isn't. That prediction is false.**

Same grammar, same runtime, same prompt structure, same semantic descriptions — only the
identifiers were replaced with opaque tokens (`<C22 a1=… a2=…>`), with the mapping given
exactly as clearly as the real one:

| Vocabulary | Pass | pass@1 | Authored tokens | Climbed the ladder |
|---|---|---|---:|---:|
| Real (`<GitDiff file=… base=…>`) | 5/5 | 5/5 | 158 | 5/5 |
| **Scrambled** (`<C22 a1=… a2=…>`) | 5/5 | 5/5 | 177 | **5/5** |

Ratio 1.12x, **95% CI 0.98x–1.26x — it brackets 1.00**. The scrambled arm authored
`<C22 a1="repo/src/server.ts" a2="HEAD~1" />` and climbed the ladder just as reliably.
Familiarity bought us **nothing measurable**.

This is consistent with the Anka result (a novel DSL with zero pretraining exposure hit
99.9% parse success), and we now agree with it: **models do not fumble unfamiliar
grammars.** Anyone repeating the "familiar syntax is why this works" claim — including us,
previously — is not supported by this data.

**What survives is stronger and simpler.** The win is not in the *words*. It is in giving
the model a component that *does the work* — a reference it can point at a file instead of
pasting the file, and a `$log` that answers a question instead of quoting it. That is a
semantic and architectural property, entirely orthogonal to what the tags are called. The
ladder is the product; the vocabulary was a story we told ourselves.

The scrambled arm is now generated as a **transformation over the derived catalog**, not a
hand-kept second copy, so it tracks the product exactly as closely as the real arm does.

## Authored tokens, not session tokens

The first pilot measured **session** output tokens and got 11,271 for the git-diff task —
because the model was reading files, shelling out to git, and retrying. That is agentic
exploration, not the cost of a format. Leading with it would have measured how chatty the
agent was and called it a benchmark.

The headline is the output tokens of the single assistant message that carried the render
call, read exactly from the transcript, by the same rule for every arm. Session totals are
still reported in full in the archive — they are real money, they just aren't a property of
the format.

## Where this is weak — read before quoting

- **Three scenarios, one model (sonnet), N=5 each.** The six ported scenarios, opus, and
  haiku have **not run**. This is a pilot.
- **The rubric's 200-character content floor penalises compression.** It is the reason the
  log arm's 6x first-artifact win reports as 1.9x. We left it alone deliberately; a reader
  who thinks it is wrong should edit `bench/acceptance/` and re-run, and we would find that
  a fair criticism.
- **The git-diff mean (1,947) and median (160) disagree by 12x**, because one run in five
  declined the ladder. N=5 is too small to characterise that tail.
- **`raw-html` is not a pure format comparison.** It writes an entire standalone document;
  parchment writes into a running runtime. Its numbers are honest as "cost to get this on
  screen", not as "HTML is 150x more verbose".
- **The vocabulary ablation was not re-run** against the corrected harness (see the
  provenance note above).
- **Grammar-constrained decoding (strict tool use) was NOT TESTED.** It is unreachable
  through Claude Code's MCP path and needs a Console API key, which we do not have. It is
  the single most important untested arm: it would tell us whether a DSL's advantage is its
  *syntax* or merely its *constrained semantics* — and if the latter, the constraint is
  purchasable from a familiar syntax without paying a grammar tax. **This is the one thing
  an API key would buy.**

## Independent check: a rival's published claim

OpenUI Lang publishes a **−51.7%** token win over a "competitor" baseline. Their competitor
arm is serialized **pretty-printed** — `JSON.stringify(x, null, 2)` at
`benchmarks/thesys-c1-converter.ts:39-46`. 45% of that arm's tokens are whitespace. Their
*other* JSON arm is minified, in the same benchmark.

Re-running **their own harness** with one change — dropping the indent:

| | as published | competitor minified |
|---|---:|---:|
| OpenUI vs C1, total | **−51.7%** | **−12.1%** |
| dashboard (their flagship) | −45.8% | **+1.8% — OpenUI loses** |

Reproduce in ~30s: `evals/rival-openui/reproduce.sh` (pinned to their commit `69c8aae`).

**The caveat, stated plainly:** only that one column collapses. Their arm against Vercel's
JSON (**−52.8%**) is *already* minified and is untouched by this. Their arithmetic is honest
and their tokenizer is fair to both arms. The flaw is in how one competitor was serialized,
not in how they counted. Two figures in our own research notes were also wrong *in OpenUI's
favour*, and are corrected above.

## Reproduce, or falsify

```bash
bun run evals/cli.ts pilot --arms parchment-markup-high,parchment-markup-low,raw-html \
                           --scenarios ladder-log-chart,ladder-git-diff,ladder-csv-table \
                           --model sonnet --replicates 5
bun run evals/cli.ts report --from evals/results/<timestamp>   # offline, no model calls
```

**How to falsify us:**
- Show the model does *not* climb on other tasks — that kills the headline, and it is the
  most likely place for this to break.
- Show the browser rubric passes a page a human would call wrong (`bench/acceptance/`), or
  fails one a human would call right. **We think its content floor does the second thing,
  and we did not fix it in our own favour.**
- Show an arm was handed a tool, a hint, or a prompt the others weren't (`evals/arms/`,
  `evals/driver.ts` — every arm gets the same read surface and the same git access; only
  `Write` vs `canvas_render` differs).
- Show the harness still differs from the product. It imports `src/` directly now, and
  `evals/catalog/vocabulary.test.ts` fails on any divergence — but that test is ours, and
  you should check it.
- Beat 160 authored tokens with any format, on the git-diff fixture, through this rubric.

Every number here is regenerable offline from the archived transcripts.
