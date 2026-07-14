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

The entire artifact the high-fidelity arm authored, in five out of five runs:

```
<GitDiff file="repo/src/server.ts" base="HEAD~1" />
```

51 bytes. The daemon fetches the bytes at push time.

## The result that could have sunk this, and didn't

The ladder only pays off **if the model actually reaches for the reference
component**. It is told, once, in its system prompt, that it may name a file —
and then it is left alone. If it ignored that and pasted the file anyway, the
honest headline would have been *"parchment could be 51x cheaper, and the model
doesn't do it."*

It climbed, **5/5 (100%, Wilson 95% CI 57–100%)**. The interval clears half, so
the win is the ladder's and not merely the notation's. But N=5 on one scenario is
a narrow interval to hang a claim on — the CI's lower bound is 57%, and that is
the number to quote, not the 100%.

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

- **One scenario, one model, N=5.** The CSV and log ladder scenarios, the six
  ported scenarios, opus, and haiku have **not run**. This is a pilot.
- **The vocabulary ablation has not run.** Whether familiar tags (`<Chart>`) beat
  opaque ones (`<C08>`) at identical grammar is the other half of the thesis and
  is **not yet tested**. The arms exist and the prompts are built to be identical
  in structure; the numbers do not exist yet. We are not claiming it.
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
