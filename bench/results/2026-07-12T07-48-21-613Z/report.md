# Parchment benchmark report

- Generated: 2026-07-12T07:49:43.400Z
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
| CI status dashboard (KPI row + 2 charts) | parchment | haiku | 1 | 100% | $0.0603 | 68773 | 2 | 33759 | 2 |
| CI status dashboard (KPI row + 2 charts) | html | haiku | 1 | 100% | $0.0535 | 26064 | 1 | 12789 | 1 |

## Raw runs

| Scenario | Arm | Model | Rep | Passed | Cost $ | Tokens | Turns | JSONL |
|---|---|---|---|---|---|---|---|---|
| status-dashboard | parchment | haiku | 1 | yes | $0.0603 | 68773 | 4 | `raw/jsonl/status-dashboard-parchment-haiku-rep1.jsonl` |
| status-dashboard | html | haiku | 1 | yes | $0.0535 | 26064 | 2 | `raw/jsonl/status-dashboard-html-haiku-rep1.jsonl` |