# Parchment benchmark — the fidelity ladder

**Pilot result, re-run 2026-07-14 against the SHIPPED product. Three scenarios, one
model (sonnet), N=5, browser-verified.** Full report:
`evals/results/2026-07-14T20-00-00-000Z-corrected-harness/report.md`.

---

## Head-to-head vs the competing formats

**This is the section that decides whether the superlative is earned, so its central
finding leads — and it does not flatter us.**

Until now this benchmark had measured parchment against its own pasting arm and against raw
HTML, and reported 56x / 53x. It had **never** measured it against an actual competing
format. It has now: OpenUI Lang (thesys), Google A2UI, minified-key JSON (`terse-json`), and
raw HTML — each built from its own spec, each given the authoring surface it really uses, on
the same three ladder scenarios, the same fixtures, the same browser rubric, the same repair
loop. N=5, sonnet.

### The finding that comes first: we are NOT the only format that can name data instead of carrying it

The whole thesis of the ladder is that a component which lets the model **name** content
beats one that makes it **carry** content. The premise underneath the headline was that no
rival format has that mechanism. **That premise is false.**

**OpenUI Lang has `Query(tool, args, defaults)` — a first-class statement in its shipped
grammar.** It is executed at render time by a host `toolProvider.callTool(name, args)`
(`@openuidev/lang-core`, `src/runtime/queryManager.ts`), and its result is bound straight
into a component's props. The model emits the tool name and its arguments and **never emits
the content** — architecturally identical to a parchment reference, where the daemon reads
the file and fills the prop. Their own generated prompt does not merely permit this; it
forbids the alternative: *"NEVER hardcode tool results as literal arrays or objects."*

Given equivalent tools (we wired OpenUI's `git_diff` / `read_csv` / `log_series` to the
**same** daemon hydrators parchment uses, so a `Query` resolves to the same bytes a
`<GitDiff>` does), **OpenUI's model reached for `Query` and climbed the ladder on 15/15
reference runs.** Side by side, the entire authored artifact for the git-diff task:

```
parchment   <GitDiff file="repo/src/server.ts" base="HEAD~1" />

openui-lang  root = Card([diffView], "server.ts changes", "Diff HEAD~1..HEAD", "full", true)
             diffData = Query("git_diff", {file: "repo/src/server.ts", base: "HEAD~1"}, {file:"", before:"", after:""})
             diffView = DiffViewer(diffData.file, diffData.before, diffData.after, "typescript", "none")
```

Both name the file. Neither pastes a line of the diff. **The 50x compression is a property
of the mechanism, and OpenUI has the mechanism.** The gap between us and OpenUI is therefore
not 50x — it is the difference between a self-closing tag and a `Query` statement plus a
pluck line.

### Content-avoidance mechanism, per arm — verified, not assumed

| Arm | Names content instead of carrying it? | Mechanism (verified) | Climbed the ladder |
|---|---|---|---|
| `parchment-markup-high` | **YES** | reference tags/props → daemon hydrates (`{$diff}`, `{$csv}`, `{$log}`) | 14/15 |
| `openui-lang` | **YES** | `Query(tool,args,defaults)` → host `callTool` → bound to props | **15/15** |
| `terse-json` | NO | — (a minified tree has nowhere to put a reference) | 0/15 |
| `a2ui` | NO | — verified against the v1.0 schema set: the only `url` props are `Image`/`Video`/`AudioPlayer` | 0/5 |
| `raw-jsx` | NO | — a hand-written component cannot name a file | not completed |
| `raw-html` | NO | — | 0/15 |

### The table (authored output tokens, median, N=5)

**Authored output tokens** = the output tokens of the assistant message carrying the render
call, **summed across repair turns**, by the same rule for every arm — the identical rule the
rest of this document uses.

| Scenario | `parchment-markup-high` | `openui-lang` (`Query`) | `terse-json` | `a2ui` | `raw-html` |
|---|---:|---:|---:|---:|---:|
| git-diff (250-line change) | **160** | 394 | 9,359 | 9,301 | 23,952 |
| csv-table (50 rows) | **168** | 385 | 9,995 | 9,237 *(N=1)* | 4,325 |
| log-chart (100 lines) | 800 | 1,454 | **672** | *not completed* | 3,679 |

`a2ui` csv-table is N=1 (one completed run); its log-chart cell and the `raw-jsx` arm were
**not completed** before the run was stopped, and are reported as such rather than estimated.
First-artifact medians (before any repair) are lower for every arm that repairs — parchment
251, OpenUI 490, terse-json 5,063 on the cells where the rubric's content floor forces a
second turn; the headline above counts the repair, because a re-paste is a real cost.

### Losses first

1. **`terse-json` beats us on log-chart: 672 vs 800.** A clean loss on total authored tokens.
   Parchment's *first* artifact is the leanest on the board (251 tokens, a bare `<LogStream>`),
   but a page that is nothing but a correct six-bar chart paints 124 visible characters and
   **fails the rubric's 200-character content floor** — so it spends a second turn adding prose,
   ending at 800. `terse-json` pastes the six bucket counts *and* a six-row table, clears the
   floor on the first try, and wins. When the referenced answer is six numbers, pasting it is
   cheaper than referencing it — the ladder pays least exactly where the payload is smallest,
   and here it goes negative. (The content floor is discussed at length below; we did not touch
   it.)

2. **On the git-diff *mean*, OpenUI beats us — because it climbed more reliably.** Median
   parchment 160 < OpenUI 394, so per-artifact-that-climbed we author fewer. But parchment
   climbed **4/5** on git-diff — one run in five declined the ladder and pasted the file
   (9,105 tokens) — while OpenUI climbed **5/5**. Weighting every run, parchment's git-diff
   mean is **1,947** against OpenUI's **385**. On reliability of reaching for the reference,
   the rival was strictly better on this scenario.

3. **The margin over the strongest rival is a small constant, not an order of magnitude.**
   Where both formats reference (git-diff, csv), parchment authors **~2.3–2.5x** fewer tokens
   than OpenUI+`Query` (160 vs 394; 168 vs 385). That gap is tag-density — one self-closing
   tag against a `Query` statement plus a pluck line — not the ladder. The 50x figure only
   ever described the distance to formats that *must carry content* (`terse-json`, `a2ui`,
   `raw-html`), and only on large payloads.

### A2UI, stated fairly

A2UI's *basic* catalog has no Chart and no Table, so it physically cannot render these tasks;
we gave it a **custom chart-capable catalog** (its own spec tells production users to build
one) so the comparison is about its format, not its starter kit. With that catalog it
**renders correctly** — git-diff passed 5/5. It simply has no reference mechanism, so it
pastes, landing at ~9,300 tokens on git-diff: the same bucket as `terse-json` and `raw-html`,
and ~58x parchment. Its leaner JSON encoding (props inline, no `props` wrapper, no
`children:[]`) buys it nothing here, because the cost is the pasted payload, not the envelope.

### The verdict on "the most token-efficient generative UI system for coding agents"

**Not earned as an unqualified superlative.** It is defensible only in the narrow, measured
form the evidence supports, and must be stated that way:

> On file-referencing tasks (rendering a git diff, a CSV on disk), parchment authors the
> fewest output tokens of any format measured — but its lead over the strongest rival,
> **OpenUI Lang with `Query`, is ~2–2.5x, not an order of magnitude**, and OpenUI reached for
> its reference mechanism *more* reliably on git-diff. On a task whose referenced answer is
> tiny (six numbers), a compact pasting format (`terse-json`) authors **fewer** total tokens
> than parchment, because parchment's maximally-compressed artifact is rejected by the rubric's
> content floor and must be padded.

Where it holds: git-diff and csv-table, on the median, by a modest constant. Where it does
not: log-chart (a paste format wins), and git-diff reliability/mean (OpenUI wins). The
order-of-magnitude framing (56x / 53x) is true only against formats with **no** reference
mechanism, and naming it as parchment's number — now that a rival format demonstrably has
one — would be the same overclaim we caught OpenUI making with pretty-printed JSON.

*Head-to-head spend this run: **$10.72** (subscription; reported CLI cost across 37 runs).
`raw-jsx` (React + recharts) and A2UI's csv/log cells were not completed and are marked so.
`evals/scenarios/` and `bench/acceptance/` were not touched — task definitions and the
acceptance rubric are byte-identical to the runs above.*

---

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

**This table is parchment against its own pasting arm and raw HTML — the ladder measured
against formats with NO reference mechanism. For the comparison against formats that DO have
one (OpenUI's `Query`), read the head-to-head section at the top: the gap there is ~2–2.5x,
not the 56x below.** The 56x is the distance to pasting, not to the field.

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
