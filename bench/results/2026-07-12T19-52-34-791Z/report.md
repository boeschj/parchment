# Parchment benchmark report

- Generated: 2026-07-12T19:56:24.654Z
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
| CI status dashboard (KPI row + 2 charts) | parchment | sonnet | 3 | 100% | $0.1005 | 40232 | 2 | 24958 | 2 |
| Data table from a CSV snippet | parchment | sonnet | 3 | 100% | $0.0641 | 42023 | 2 | 27789 | 2 |
| Architecture diagram (3-tier system) | parchment | sonnet | 3 | 100% | $0.0469 | 26959 | 1 | 13426 | 1 |
| Incident postmortem report | parchment | sonnet | 3 | 100% | $0.0595 | 28284 | 1 | 14129 | 1 |
| Signup form with validation + submit | parchment | sonnet | 3 | 100% | $0.0736 | 34150 | 1 | 14587 | 1 |
| Live log dashboard (setup half of tokens-per-update) | parchment | sonnet | 3 | 100% | $0.0770 | 43526 | 2 | 28662 | 2 |

## Spread (mean / median / min / max)

| Scenario | Arm | Model | N | Cost $ (mean / median / min / max) | Tokens (mean / median / min / max) | Tokens to first paint (mean / median / min / max) |
|---|---|---|---|---|---|---|
| CI status dashboard (KPI row + 2 charts) | parchment | sonnet | 3 | $0.1005 / $0.1033 / $0.0667 / $0.1314 | 40232 / 44795 / 28926 / 46974 | 24958 / 29465 / 14472 / 30937 |
| Data table from a CSV snippet | parchment | sonnet | 3 | $0.0641 / $0.0642 / $0.0633 / $0.0649 | 42023 / 42025 / 41936 / 42108 | 27789 / 27785 / 27742 / 27841 |
| Architecture diagram (3-tier system) | parchment | sonnet | 3 | $0.0469 / $0.0469 / $0.0468 / $0.0470 | 26959 / 26958 / 26950 / 26969 | 13426 / 13425 / 13420 / 13432 |
| Incident postmortem report | parchment | sonnet | 3 | $0.0595 / $0.0592 / $0.0581 / $0.0611 | 28284 / 28256 / 28157 / 28438 | 14129 / 14117 / 14062 / 14208 |
| Signup form with validation + submit | parchment | sonnet | 3 | $0.0736 / $0.0767 / $0.0656 / $0.0787 | 34150 / 29943 / 28703 / 43805 | 14587 / 14478 / 14335 / 14947 |
| Live log dashboard (setup half of tokens-per-update) | parchment | sonnet | 3 | $0.0770 / $0.0769 / $0.0762 / $0.0778 | 43526 / 43514 / 43430 / 43635 | 28662 / 28662 / 28590 / 28735 |

## Raw runs

| Scenario | Arm | Model | Rep | Passed | Cost $ | Tokens | Turns | JSONL |
|---|---|---|---|---|---|---|---|---|
| status-dashboard | parchment | sonnet | 1 | yes | $0.1314 | 44795 | 3 | `raw/jsonl/status-dashboard-parchment-sonnet-rep1.jsonl` |
| status-dashboard | parchment | sonnet | 2 | yes | $0.1033 | 46974 | 3 | `raw/jsonl/status-dashboard-parchment-sonnet-rep2.jsonl` |
| status-dashboard | parchment | sonnet | 3 | yes | $0.0667 | 28926 | 2 | `raw/jsonl/status-dashboard-parchment-sonnet-rep3.jsonl` |
| csv-data-table | parchment | sonnet | 1 | yes | $0.0633 | 41936 | 3 | `raw/jsonl/csv-data-table-parchment-sonnet-rep1.jsonl` |
| csv-data-table | parchment | sonnet | 2 | yes | $0.0642 | 42025 | 3 | `raw/jsonl/csv-data-table-parchment-sonnet-rep2.jsonl` |
| csv-data-table | parchment | sonnet | 3 | yes | $0.0649 | 42108 | 3 | `raw/jsonl/csv-data-table-parchment-sonnet-rep3.jsonl` |
| architecture-diagram | parchment | sonnet | 1 | yes | $0.0469 | 26958 | 2 | `raw/jsonl/architecture-diagram-parchment-sonnet-rep1.jsonl` |
| architecture-diagram | parchment | sonnet | 2 | yes | $0.0468 | 26950 | 2 | `raw/jsonl/architecture-diagram-parchment-sonnet-rep2.jsonl` |
| architecture-diagram | parchment | sonnet | 3 | yes | $0.0470 | 26969 | 2 | `raw/jsonl/architecture-diagram-parchment-sonnet-rep3.jsonl` |
| incident-report | parchment | sonnet | 1 | yes | $0.0581 | 28157 | 2 | `raw/jsonl/incident-report-parchment-sonnet-rep1.jsonl` |
| incident-report | parchment | sonnet | 2 | yes | $0.0611 | 28438 | 2 | `raw/jsonl/incident-report-parchment-sonnet-rep2.jsonl` |
| incident-report | parchment | sonnet | 3 | yes | $0.0592 | 28256 | 2 | `raw/jsonl/incident-report-parchment-sonnet-rep3.jsonl` |
| validated-form | parchment | sonnet | 1 | yes | $0.0767 | 43805 | 3 | `raw/jsonl/validated-form-parchment-sonnet-rep1.jsonl` |
| validated-form | parchment | sonnet | 2 | yes | $0.0787 | 29943 | 2 | `raw/jsonl/validated-form-parchment-sonnet-rep2.jsonl` |
| validated-form | parchment | sonnet | 3 | yes | $0.0656 | 28703 | 2 | `raw/jsonl/validated-form-parchment-sonnet-rep3.jsonl` |
| live-log-dashboard | parchment | sonnet | 1 | yes | $0.0778 | 43635 | 3 | `raw/jsonl/live-log-dashboard-parchment-sonnet-rep1.jsonl` |
| live-log-dashboard | parchment | sonnet | 2 | yes | $0.0762 | 43430 | 3 | `raw/jsonl/live-log-dashboard-parchment-sonnet-rep2.jsonl` |
| live-log-dashboard | parchment | sonnet | 3 | yes | $0.0769 | 43514 | 3 | `raw/jsonl/live-log-dashboard-parchment-sonnet-rep3.jsonl` |