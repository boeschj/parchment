# Parchment benchmark report

- Generated: 2026-07-12T19:55:19.200Z
- Claude Code version(s) observed: 2.1.207

## Methodology

**What's measured:** for each (scenario, arm, model) combination, N repetitions of a single
headless `claude -p` turn attempting a fixed task. Metrics are derived two ways: token/turn
counts come from parsing the run's own session JSONL (`@boeschj/claude-jsonl`); pass/fail
correctness comes from an independent, arm-appropriate validator — the live parchment daemon's
HTTP API for the parchment arm, a regex-based structural check of the written file for the HTML arm.

**What's controlled:** every run passes `--setting-sources ""` so a developer's personal
CLAUDE.md, memory files, and project settings never inflate the measured token counts.
Tool availability is scoped per arm and per scenario — the parchment arm can only call the
one canvas_* tool the scenario is testing; the HTML arm can only call Write/Edit. The parchment
arm runs against an isolated, disposable parchment daemon (its own HOME, its own port) — never
a developer's real, interactively-used daemon.

**Known limitations:**
- The HTML arm has no analog to canvas_render's server-side validate-and-reject loop: an
  invalid HTML artifact simply ships broken, with no structural retry signal mid-session. A
  higher `passes-to-correct-render` for the parchment arm on a given scenario can mean the
  tool caught and forced a fix — not that parchment is slower to a correct result.
- "First paint" is a proxy: for parchment it's the first accepted (non-error) render tool
  call; for HTML it's the first successful write of the output file. Neither confirms a human
  actually looked at a rendered browser tab.
- tokens-per-live-update (metric c) is not measured end-to-end here: parchment's live data
  engine (file-tail/command-poll sources feeding slot state with zero LLM calls) had not
  landed as of this report. See bench/scenarios/live-update-plan.ts for the interface the
  moderate suite will measure against once it does.
- Costs reflect this machine's model pricing and Anthropic's prompt-caching behavior at run
  time; they are not a stable long-term forecast.

## Summary (mean unless noted)

| Scenario | Arm | Model | N | Pass rate | Cost (mean $) | Prompt+completion tokens (mean) | Turns to first paint (mean) | Tokens to first paint (mean) | Render attempts (mean) |
|---|---|---|---|---|---|---|---|---|---|
| CI status dashboard (KPI row + 2 charts) | parchment | opus | 2 | 100% | $0.1639 | 34190 | 2 | 18784 | 2 |
| Signup form with validation + submit | parchment | opus | 2 | 100% | $0.1274 | 37890 | 2 | 18162 | 2 |
| Live log dashboard (setup half of tokens-per-update) | parchment | opus | 2 | 100% | $0.1105 | 27264 | 2 | 17643 | 2 |

## Spread (mean / median / min / max)

| Scenario | Arm | Model | N | Cost $ (mean / median / min / max) | Tokens (mean / median / min / max) | Tokens to first paint (mean / median / min / max) |
|---|---|---|---|---|---|---|
| CI status dashboard (KPI row + 2 charts) | parchment | opus | 2 | $0.1639 / $0.1639 / $0.1416 / $0.1863 | 34190 / 34190 / 29459 / 38920 | 18784 / 18784 / 18541 / 19027 |
| Signup form with validation + submit | parchment | opus | 2 | $0.1274 / $0.1274 / $0.1232 / $0.1315 | 37890 / 37890 / 37438 / 38341 | 18162 / 18162 / 17918 / 18405 |
| Live log dashboard (setup half of tokens-per-update) | parchment | opus | 2 | $0.1105 / $0.1105 / $0.1070 / $0.1140 | 27264 / 27264 / 26951 / 27576 | 17643 / 17643 / 17421 / 17865 |

## Raw runs

| Scenario | Arm | Model | Rep | Passed | Cost $ | Tokens | Turns | JSONL |
|---|---|---|---|---|---|---|---|---|
| status-dashboard | parchment | opus | 1 | yes | $0.1863 | 38920 | 4 | `raw/jsonl/status-dashboard-parchment-opus-rep1.jsonl` |
| status-dashboard | parchment | opus | 2 | yes | $0.1416 | 29459 | 3 | `raw/jsonl/status-dashboard-parchment-opus-rep2.jsonl` |
| validated-form | parchment | opus | 1 | yes | $0.1232 | 37438 | 4 | `raw/jsonl/validated-form-parchment-opus-rep1.jsonl` |
| validated-form | parchment | opus | 2 | yes | $0.1315 | 38341 | 4 | `raw/jsonl/validated-form-parchment-opus-rep2.jsonl` |
| live-log-dashboard | parchment | opus | 1 | yes | $0.1070 | 26951 | 3 | `raw/jsonl/live-log-dashboard-parchment-opus-rep1.jsonl` |
| live-log-dashboard | parchment | opus | 2 | yes | $0.1140 | 27576 | 3 | `raw/jsonl/live-log-dashboard-parchment-opus-rep2.jsonl` |