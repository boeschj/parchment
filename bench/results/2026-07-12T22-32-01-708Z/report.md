# Parchment benchmark report

- Generated: 2026-07-12T22:33:46.393Z
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
| CI status dashboard (KPI row + 2 charts) | parchment | opus | 2 | 100% | $0.0926 | 11802 | 1 | 5828 | 1 |
| Signup form with validation + submit | parchment | opus | 2 | 100% | $0.0815 | 11412 | 1 | 5564 | 1 |
| Live log dashboard (setup half of tokens-per-update) | parchment | opus | 2 | 100% | $0.0767 | 11231 | 1 | 5485 | 1 |

## Spread (mean / median / min / max)

| Scenario | Arm | Model | N | Cost $ (mean / median / min / max) | Tokens (mean / median / min / max) | Tokens to first paint (mean / median / min / max) |
|---|---|---|---|---|---|---|
| CI status dashboard (KPI row + 2 charts) | parchment | opus | 2 | $0.0926 / $0.0926 / $0.0858 / $0.0994 | 11802 / 11802 / 11793 / 11811 | 5828 / 5828 / 5817 / 5839 |
| Signup form with validation + submit | parchment | opus | 2 | $0.0815 / $0.0815 / $0.0805 / $0.0825 | 11412 / 11412 / 11331 / 11492 | 5564 / 5564 / 5488 / 5640 |
| Live log dashboard (setup half of tokens-per-update) | parchment | opus | 2 | $0.0767 / $0.0767 / $0.0758 / $0.0776 | 11231 / 11231 / 11169 / 11293 | 5485 / 5485 / 5442 / 5527 |

## Raw runs

| Scenario | Arm | Model | Rep | Passed | Cost $ | Tokens | Turns | JSONL |
|---|---|---|---|---|---|---|---|---|
| status-dashboard | parchment | opus | 1 | yes | $0.0994 | 11793 | 2 | `raw/jsonl/status-dashboard-parchment-opus-rep1.jsonl` |
| status-dashboard | parchment | opus | 2 | yes | $0.0858 | 11811 | 2 | `raw/jsonl/status-dashboard-parchment-opus-rep2.jsonl` |
| validated-form | parchment | opus | 1 | yes | $0.0825 | 11492 | 2 | `raw/jsonl/validated-form-parchment-opus-rep1.jsonl` |
| validated-form | parchment | opus | 2 | yes | $0.0805 | 11331 | 2 | `raw/jsonl/validated-form-parchment-opus-rep2.jsonl` |
| live-log-dashboard | parchment | opus | 1 | yes | $0.0776 | 11293 | 2 | `raw/jsonl/live-log-dashboard-parchment-opus-rep1.jsonl` |
| live-log-dashboard | parchment | opus | 2 | yes | $0.0758 | 11169 | 2 | `raw/jsonl/live-log-dashboard-parchment-opus-rep2.jsonl` |