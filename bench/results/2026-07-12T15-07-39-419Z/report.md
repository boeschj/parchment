# Parchment benchmark report

- Generated: 2026-07-12T15:14:08.315Z
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
| CI status dashboard (KPI row + 2 charts) | parchment | opus | 2 | 100% | $0.1821 | 54494 | 2 | 26360 | 2 |
| CI status dashboard (KPI row + 2 charts) | html | opus | 2 | 100% | $0.1736 | 15306 | 1 | 7456 | 1 |
| Signup form with validation + submit | parchment | opus | 2 | 100% | $0.1293 | 53214 | 2 | 25754 | 2 |
| Signup form with validation + submit | html | opus | 2 | 100% | $0.0633 | 9235 | 1 | 4484 | 1 |
| Live log dashboard (setup half of tokens-per-update) | parchment | opus | 2 | 100% | $0.1124 | 51727 | 2 | 25145 | 2 |
| Live log dashboard (setup half of tokens-per-update) | html | opus | 2 | 100% | $0.1324 | 13210 | 1 | 6418 | 1 |

## Spread (mean / median / min / max)

| Scenario | Arm | Model | N | Cost $ (mean / median / min / max) | Tokens (mean / median / min / max) | Tokens to first paint (mean / median / min / max) |
|---|---|---|---|---|---|---|
| CI status dashboard (KPI row + 2 charts) | parchment | opus | 2 | $0.1821 / $0.1821 / $0.1392 / $0.2250 | 54494 / 54494 / 54462 / 54526 | 26360 / 26360 / 26342 / 26377 |
| CI status dashboard (KPI row + 2 charts) | html | opus | 2 | $0.1736 / $0.1736 / $0.1675 / $0.1797 | 15306 / 15306 / 15278 / 15333 | 7456 / 7456 / 7435 / 7476 |
| Signup form with validation + submit | parchment | opus | 2 | $0.1293 / $0.1293 / $0.1220 / $0.1366 | 53214 / 53214 / 52275 / 54152 | 25754 / 25754 / 25345 / 26163 |
| Signup form with validation + submit | html | opus | 2 | $0.0633 / $0.0633 / $0.0611 / $0.0656 | 9235 / 9235 / 9105 / 9364 | 4484 / 4484 / 4418 / 4550 |
| Live log dashboard (setup half of tokens-per-update) | parchment | opus | 2 | $0.1124 / $0.1124 / $0.1123 / $0.1125 | 51727 / 51727 / 51705 / 51748 | 25145 / 25145 / 25121 / 25169 |
| Live log dashboard (setup half of tokens-per-update) | html | opus | 2 | $0.1324 / $0.1324 / $0.1309 / $0.1340 | 13210 / 13210 / 13097 / 13322 | 6418 / 6418 / 6366 / 6470 |

## Raw runs

| Scenario | Arm | Model | Rep | Passed | Cost $ | Tokens | Turns | JSONL |
|---|---|---|---|---|---|---|---|---|
| status-dashboard | parchment | opus | 1 | yes | $0.2250 | 54526 | 4 | `raw/jsonl/status-dashboard-parchment-opus-rep1.jsonl` |
| status-dashboard | parchment | opus | 2 | yes | $0.1392 | 54462 | 4 | `raw/jsonl/status-dashboard-parchment-opus-rep2.jsonl` |
| status-dashboard | html | opus | 1 | yes | $0.1797 | 15333 | 2 | `raw/jsonl/status-dashboard-html-opus-rep1.jsonl` |
| status-dashboard | html | opus | 2 | yes | $0.1675 | 15278 | 2 | `raw/jsonl/status-dashboard-html-opus-rep2.jsonl` |
| validated-form | parchment | opus | 1 | yes | $0.1220 | 52275 | 4 | `raw/jsonl/validated-form-parchment-opus-rep1.jsonl` |
| validated-form | parchment | opus | 2 | yes | $0.1366 | 54152 | 4 | `raw/jsonl/validated-form-parchment-opus-rep2.jsonl` |
| validated-form | html | opus | 1 | yes | $0.0656 | 9364 | 2 | `raw/jsonl/validated-form-html-opus-rep1.jsonl` |
| validated-form | html | opus | 2 | yes | $0.0611 | 9105 | 2 | `raw/jsonl/validated-form-html-opus-rep2.jsonl` |
| live-log-dashboard | parchment | opus | 1 | yes | $0.1125 | 51748 | 4 | `raw/jsonl/live-log-dashboard-parchment-opus-rep1.jsonl` |
| live-log-dashboard | parchment | opus | 2 | yes | $0.1123 | 51705 | 4 | `raw/jsonl/live-log-dashboard-parchment-opus-rep2.jsonl` |
| live-log-dashboard | html | opus | 1 | yes | $0.1309 | 13097 | 2 | `raw/jsonl/live-log-dashboard-html-opus-rep1.jsonl` |
| live-log-dashboard | html | opus | 2 | yes | $0.1340 | 13322 | 2 | `raw/jsonl/live-log-dashboard-html-opus-rep2.jsonl` |