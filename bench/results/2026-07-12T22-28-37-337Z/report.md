# Parchment benchmark report

- Generated: 2026-07-12T22:31:41.073Z
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
| CI status dashboard (KPI row + 2 charts) | parchment | sonnet | 3 | 100% | $0.0766 | 23204 | 1 | 11583 | 1 |
| Data table from a CSV snippet | parchment | sonnet | 3 | 100% | $0.0508 | 21468 | 1 | 10699 | 1 |
| Architecture diagram (3-tier system) | parchment | sonnet | 3 | 100% | $0.0454 | 20950 | 1 | 10428 | 1 |
| Incident postmortem report | parchment | sonnet | 3 | 100% | $0.0568 | 22156 | 1 | 11063 | 1 |
| Signup form with validation + submit | parchment | sonnet | 3 | 100% | $0.0674 | 23001 | 1 | 11481 | 1 |
| Live log dashboard (setup half of tokens-per-update) | parchment | sonnet | 3 | 100% | $0.0641 | 22751 | 1 | 11346 | 1 |

## Spread (mean / median / min / max)

| Scenario | Arm | Model | N | Cost $ (mean / median / min / max) | Tokens (mean / median / min / max) | Tokens to first paint (mean / median / min / max) |
|---|---|---|---|---|---|---|
| CI status dashboard (KPI row + 2 charts) | parchment | sonnet | 3 | $0.0766 / $0.0758 / $0.0661 / $0.0878 | 23204 / 22997 / 22674 / 23940 | 11583 / 11491 / 11318 / 11941 |
| Data table from a CSV snippet | parchment | sonnet | 3 | $0.0508 / $0.0508 / $0.0504 / $0.0513 | 21468 / 21469 / 21422 / 21512 | 10699 / 10698 / 10673 / 10727 |
| Architecture diagram (3-tier system) | parchment | sonnet | 3 | $0.0454 / $0.0453 / $0.0451 / $0.0460 | 20950 / 20926 / 20925 / 21000 | 10428 / 10422 / 10418 / 10445 |
| Incident postmortem report | parchment | sonnet | 3 | $0.0568 / $0.0570 / $0.0561 / $0.0571 | 22156 / 22182 / 22094 / 22192 | 11063 / 11070 / 11036 / 11084 |
| Signup form with validation + submit | parchment | sonnet | 3 | $0.0674 / $0.0637 / $0.0597 / $0.0788 | 23001 / 22631 / 22273 / 24099 | 11481 / 11291 / 11122 / 12029 |
| Live log dashboard (setup half of tokens-per-update) | parchment | sonnet | 3 | $0.0641 / $0.0637 / $0.0570 / $0.0715 | 22751 / 22713 / 22084 / 23457 | 11346 / 11323 / 11028 / 11687 |

## Raw runs

| Scenario | Arm | Model | Rep | Passed | Cost $ | Tokens | Turns | JSONL |
|---|---|---|---|---|---|---|---|---|
| status-dashboard | parchment | sonnet | 1 | yes | $0.0878 | 22674 | 2 | `raw/jsonl/status-dashboard-parchment-sonnet-rep1.jsonl` |
| status-dashboard | parchment | sonnet | 2 | yes | $0.0661 | 22997 | 2 | `raw/jsonl/status-dashboard-parchment-sonnet-rep2.jsonl` |
| status-dashboard | parchment | sonnet | 3 | yes | $0.0758 | 23940 | 2 | `raw/jsonl/status-dashboard-parchment-sonnet-rep3.jsonl` |
| csv-data-table | parchment | sonnet | 1 | yes | $0.0504 | 21422 | 2 | `raw/jsonl/csv-data-table-parchment-sonnet-rep1.jsonl` |
| csv-data-table | parchment | sonnet | 2 | yes | $0.0508 | 21469 | 2 | `raw/jsonl/csv-data-table-parchment-sonnet-rep2.jsonl` |
| csv-data-table | parchment | sonnet | 3 | yes | $0.0513 | 21512 | 2 | `raw/jsonl/csv-data-table-parchment-sonnet-rep3.jsonl` |
| architecture-diagram | parchment | sonnet | 1 | yes | $0.0453 | 20926 | 2 | `raw/jsonl/architecture-diagram-parchment-sonnet-rep1.jsonl` |
| architecture-diagram | parchment | sonnet | 2 | yes | $0.0451 | 20925 | 2 | `raw/jsonl/architecture-diagram-parchment-sonnet-rep2.jsonl` |
| architecture-diagram | parchment | sonnet | 3 | yes | $0.0460 | 21000 | 2 | `raw/jsonl/architecture-diagram-parchment-sonnet-rep3.jsonl` |
| incident-report | parchment | sonnet | 1 | yes | $0.0571 | 22192 | 2 | `raw/jsonl/incident-report-parchment-sonnet-rep1.jsonl` |
| incident-report | parchment | sonnet | 2 | yes | $0.0561 | 22094 | 2 | `raw/jsonl/incident-report-parchment-sonnet-rep2.jsonl` |
| incident-report | parchment | sonnet | 3 | yes | $0.0570 | 22182 | 2 | `raw/jsonl/incident-report-parchment-sonnet-rep3.jsonl` |
| validated-form | parchment | sonnet | 1 | yes | $0.0597 | 22273 | 2 | `raw/jsonl/validated-form-parchment-sonnet-rep1.jsonl` |
| validated-form | parchment | sonnet | 2 | yes | $0.0788 | 24099 | 2 | `raw/jsonl/validated-form-parchment-sonnet-rep2.jsonl` |
| validated-form | parchment | sonnet | 3 | yes | $0.0637 | 22631 | 2 | `raw/jsonl/validated-form-parchment-sonnet-rep3.jsonl` |
| live-log-dashboard | parchment | sonnet | 1 | yes | $0.0715 | 23457 | 2 | `raw/jsonl/live-log-dashboard-parchment-sonnet-rep1.jsonl` |
| live-log-dashboard | parchment | sonnet | 2 | yes | $0.0637 | 22713 | 2 | `raw/jsonl/live-log-dashboard-parchment-sonnet-rep2.jsonl` |
| live-log-dashboard | parchment | sonnet | 3 | yes | $0.0570 | 22084 | 2 | `raw/jsonl/live-log-dashboard-parchment-sonnet-rep3.jsonl` |