# Parchment benchmark — the fidelity ladder

**Pilot result, 2026-07-14. One scenario, one model, N=5, browser-verified.**
Read the limitations before quoting anything here. Full report:
`evals/results/2026-07-14T05-41-45-760Z/report.md`.

## The headline

**Task:** render the diff of a real 250-line change to `repo/src/server.ts`
(`HEAD~1..HEAD`), with both sides visible. Same fixture, same rubric, same tools
for every arm. A run passes only when a real headless browser confirms the page
painted the file path, an added line, and a removed line, with zero console
errors — a rubric that never imports parchment's own validator.

| Arm | Pass | pass@1 | **Authored output tokens** | Artifact bytes | Climbed the ladder | $/run |
|---|---|---|---:|---:|---:|---:|
| `parchment-markup-high` | 5/5 | **5/5** | **176** | 104 | **5/5** | **$0.096** |
| `parchment-markup-low` (must paste) | 5/5 | 4/5 | 8,995 | 18,405 | 0/5 | $0.659 |
| `raw-html` (no reference mechanism) | 5/5 | 2/5 | 15,509 | 32,019 | 0/5 | $1.114 |

**51x fewer authored tokens than pasting the same content through the same
runtime. 88x fewer than hand-written HTML. 11.6x cheaper per run.**

This is parchment's **best** scenario, not its typical one. Across all three ladder
scenarios the gap is **1.2x–51x** and it collapses entirely when the reference
component cannot express the task — read the failure section above before quoting
any of these numbers.

The entire artifact the high-fidelity arm authored, in five out of five runs:

```
<GitDiff file="repo/src/server.ts" base="HEAD~1" />
```

51 bytes. The daemon fetches the bytes at push time.

## WHERE IT FAILS: the ladder does not always pay

Run on three ladder scenarios, the win is **not** universal. On one of them it
collapses to nothing:

| Scenario | high | low (pastes) | raw-html | Climbed | Gap (high vs low) |
|---|---:|---:|---:|---:|---:|
| git-diff (250-line change) | **176** | 8,995 | 15,509 | 5/5 | **51x** |
| csv-table (50 rows) | **161** | 4,531 | 4,730 | 5/5 | **28x** |
| **log-chart (100 lines)** | **1,108** | 1,354 | 3,577 | **0/5** | **1.2x — no win** |

On the log scenario the model **never once** used the reference component. It was
right not to. `LogStream` accepts `groupBy="hour|day|week"`; the task asks for
**ten-minute** buckets. **The reference grammar cannot express the question**, so
the model read the log, did the aggregation itself, and emitted six data points
inline — which is the correct engineering call, and it cost 1,108 tokens.

Two things follow, and neither is comfortable:

1. **The ladder's payoff is a function of payload size × reference
   expressiveness — not a property of the ladder itself.** A reference is worth
   51x when it replaces a 250-line diff, 28x when it replaces 50 CSV rows, and
   **nothing** when the answer is six numbers the model had to compute anyway.
   Quoting "51x" as parchment's number would be dishonest; the honest range is
   **1.2x–51x, and it depends entirely on the task.**
2. **Models rationally bypass a reference component that can't express their
   task.** That is a product gap, not a model failure. An aggregating `LogStream`
   (`groupBy="10m"`) would close it — but we have *not* built that, so we do not
   get to claim it.

Disclosure, because it matters: the ten-minute bucketing was fixed in the scenario
(commit `19181ec`) to make the rubric's ground truth deterministic — **before** the
`LogStream` grammar existed (`43e3ed2`). We did not tune the task to fail. But we
also did not tune it to succeed, and it found a real hole.

**Aggregate ladder-climb rate across all three scenarios: 10/15 (67%).**

## The half of the thesis that DIED

We predicted that familiar, top-of-distribution vocabulary (`<GitDiff>`, `<Chart>`)
would beat opaque names, because familiarity is itself a compression and
reliability mechanism. **It isn't. That prediction is false.**

Same grammar, same runtime, same prompt structure, same semantic descriptions —
only the identifiers were replaced with opaque tokens (`<C22 a1=… a2=…>`), with the
mapping given exactly as clearly as the real one:

| Vocabulary | Pass | pass@1 | Authored tokens | Climbed the ladder |
|---|---|---|---:|---:|
| Real (`<GitDiff file=… base=…>`) | 5/5 | 5/5 | 158 | 5/5 |
| **Scrambled** (`<C22 a1=… a2=…>`) | 5/5 | 5/5 | 177 | **5/5** |

Ratio 1.12x, **95% CI 0.98x–1.26x — it brackets 1.00**. The scrambled arm authored
`<C22 a1="repo/src/server.ts" a2="HEAD~1" />` and climbed the ladder just as
reliably. Familiarity bought us **nothing measurable**.

This is consistent with the Anka result (a novel DSL with zero pretraining exposure
hit 99.9% parse success), and we now agree with it: **models do not fumble
unfamiliar grammars.** Anyone repeating the "familiar syntax is why this works"
claim — including us, previously — is not supported by this data.

**What survives is stronger and simpler.** The 51x win is not in the *words*. It is
in giving the model a component that *does the work* — a reference it can point at
a file instead of pasting the file. That is a semantic and architectural property,
and it is entirely orthogonal to what the tags are called. The ladder is the
product; the vocabulary was a story we told ourselves.

## The result that could have sunk this, and didn't

The ladder only pays off **if the model actually reaches for the reference
component**. It is told, once, in its system prompt, that it may name a file —
and then it is left alone. If it ignored that and pasted the file anyway, the
honest headline would have been *"parchment could be 51x cheaper, and the model
doesn't do it."*

On the two scenarios where the reference **could express the task**, it climbed
**10/10**. On the one where it could not, it climbed **0/5** — see the failure
section above. Overall **10/15 (67%)**.

So the model does reach for the reference, unprompted and reliably, *whenever the
reference actually answers the question*. That is the real finding, and it is
narrower than the one we set out to prove.

## Authored tokens, not session tokens

The first pilot measured **session** output tokens and got 11,271 for the same
task — because the model was reading files, shelling out to git, and retrying.
That is agentic exploration, not the cost of a format. Leading with it would have
measured how chatty the agent was and called it a benchmark.

The headline above is the output tokens of the single assistant message that
carried the render call, read exactly from the transcript, by the same rule for
every arm. Session totals are still reported in full (`parchment-markup-high` 450
· `parchment-markup-low` 14,342 · `raw-html` 30,435) — they are real money, they
just aren't a property of the format.

## Where this is weak — read before quoting

- **Three ladder scenarios, one model (sonnet), N=5 each.** The six ported
  scenarios, opus, and haiku have **not run**. This is a pilot.
- **The ablation ran at N=5, one scenario.** Its CI (0.98x–1.26x) is wide enough
  that a small real effect could hide inside it. What it rules out is a LARGE
  familiarity effect — which is exactly what we had claimed.
- **`raw-html` is not a pure format comparison.** It writes an entire standalone
  document; parchment writes into a running runtime. Its 88x is honest as
  "cost to get this on screen", not as "HTML is 88x more verbose".
- **Grammar-constrained decoding (strict tool use) was NOT TESTED.** It is
  unreachable through Claude Code's MCP path and needs a Console API key, which we
  do not have. It is the single most important untested arm: it would tell us
  whether a DSL's advantage is its *syntax* or merely its *constrained semantics* —
  and if the latter, the constraint is purchasable from a familiar syntax without
  paying a grammar tax. **This is the one thing an API key would buy.**
- The pilot ran through `evals/mcp/`, which previewed the markup argument and the
  reference components. Both have since **merged to main** (b12803c, 43e3ed2), so
  they are shipped product — but these specific numbers were produced against the
  preview.

## Independent check: a rival's published claim

OpenUI Lang publishes a **−51.7%** token win over a "competitor" baseline. Their
competitor arm is serialized **pretty-printed** — `JSON.stringify(x, null, 2)` at
`benchmarks/thesys-c1-converter.ts:39-46`. 45% of that arm's tokens are
whitespace. Their *other* JSON arm is minified, in the same benchmark.

Re-running **their own harness** with one change — dropping the indent:

| | as published | competitor minified |
|---|---:|---:|
| OpenUI vs C1, total | **−51.7%** | **−12.1%** |
| dashboard (their flagship) | −45.8% | **+1.8% — OpenUI loses** |

Reproduce in ~30s: `evals/rival-openui/reproduce.sh` (pinned to their commit
`69c8aae`).

**The caveat, stated plainly:** only that one column collapses. Their arm against
Vercel's JSON (**−52.8%**) is *already* minified and is untouched by this. Their
arithmetic is honest and their tokenizer is fair to both arms. The flaw is in how
one competitor was serialized, not in how they counted. Two figures in our own
research notes were also wrong *in OpenUI's favour*, and are corrected above.

## Reproduce, or falsify

```bash
bun run evals/cli.ts pilot --arms parchment-markup-high,parchment-markup-low,raw-html \
                           --scenarios ladder-git-diff --model sonnet --replicates 5
bun run evals/cli.ts report --from evals/results/<timestamp>   # offline, no model calls
```

**How to falsify us:**
- Show the model does *not* climb the ladder on other tasks — that kills the
  headline, and it is the most likely place for this to break.
- Show the browser rubric passes a page that a human would call wrong
  (`bench/acceptance/`), or fails one a human would call right.
- Show an arm was handed a tool, a hint, or a prompt the others weren't
  (`evals/arms/`, `evals/driver.ts` — every arm gets the same read surface and the
  same git access; only `Write` vs `canvas_render` differs).
- Beat 176 authored tokens with any format, on this fixture, through this rubric.

Every number here is regenerable offline from the archived transcripts.
