# Parchment benchmark report

- Generated: 2026-07-12T15:16:53.643Z
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
| CI status dashboard (KPI row + 2 charts) | parchment | sonnet | 3 | 100% | $0.1059 | 79684 | 2 | 39054 | 2 |
| CI status dashboard (KPI row + 2 charts) | html | sonnet | 3 | 100% | $0.1197 | 28425 | 1 | 14109 | 1 |
| Data table from a CSV snippet | parchment | sonnet | 3 | 100% | $0.0517 | 36328 | 1 | 18106 | 1 |
| Data table from a CSV snippet | html | sonnet | 3 | 100% | $0.0528 | 21947 | 1 | 10905 | 1 |
| Architecture diagram (3-tier system) | parchment | sonnet | 3 | 100% | $0.0478 | 35928 | 1 | 17913 | 1 |
| Architecture diagram (3-tier system) | html | sonnet | 3 | 100% | $0.0614 | 22733 | 1 | 11295 | 1 |
| Incident postmortem report | parchment | sonnet | 3 | 100% | $0.0938 | 78093 | 2 | 38354 | 2 |
| Incident postmortem report | html | sonnet | 3 | 100% | $0.0748 | 24101 | 1 | 11972 | 1 |
| Signup form with validation + submit | parchment | sonnet | 3 | 100% | $0.0930 | 77290 | 2 | 38077 | 2 |
| Signup form with validation + submit | html | sonnet | 3 | 100% | $0.0493 | 21644 | 1 | 10749 | 1 |
| Live log dashboard (setup half of tokens-per-update) | parchment | sonnet | 3 | 100% | $0.0965 | 78305 | 2 | 38521 | 2 |
| Live log dashboard (setup half of tokens-per-update) | html | sonnet | 3 | 100% | $0.0978 | 26240 | 1 | 13027 | 1 |

## Spread (mean / median / min / max)

| Scenario | Arm | Model | N | Cost $ (mean / median / min / max) | Tokens (mean / median / min / max) | Tokens to first paint (mean / median / min / max) |
|---|---|---|---|---|---|---|
| CI status dashboard (KPI row + 2 charts) | parchment | sonnet | 3 | $0.1059 / $0.1062 / $0.1045 / $0.1071 | 79684 / 79757 / 79346 / 79949 | 39054 / 39094 / 38896 / 39172 |
| CI status dashboard (KPI row + 2 charts) | html | sonnet | 3 | $0.1197 / $0.1173 / $0.1168 / $0.1252 | 28425 / 28183 / 28144 / 28948 | 14109 / 13981 / 13969 / 14377 |
| Data table from a CSV snippet | parchment | sonnet | 3 | $0.0517 / $0.0516 / $0.0516 / $0.0519 | 36328 / 36305 / 36304 / 36375 | 18106 / 18087 / 18087 / 18143 |
| Data table from a CSV snippet | html | sonnet | 3 | $0.0528 / $0.0529 / $0.0523 / $0.0532 | 21947 / 21957 / 21904 / 21981 | 10905 / 10910 / 10886 / 10918 |
| Architecture diagram (3-tier system) | parchment | sonnet | 3 | $0.0478 / $0.0480 / $0.0471 / $0.0483 | 35928 / 35927 / 35901 / 35955 | 17913 / 17913 / 17901 / 17925 |
| Architecture diagram (3-tier system) | html | sonnet | 3 | $0.0614 / $0.0614 / $0.0608 / $0.0618 | 22733 / 22738 / 22684 / 22778 | 11295 / 11297 / 11271 / 11316 |
| Incident postmortem report | parchment | sonnet | 3 | $0.0938 / $0.0933 / $0.0923 / $0.0958 | 78093 / 77916 / 77757 / 78607 | 38354 / 38301 / 38232 / 38530 |
| Incident postmortem report | html | sonnet | 3 | $0.0748 / $0.0778 / $0.0662 / $0.0804 | 24101 / 24386 / 23282 / 24636 | 11972 / 12117 / 11560 / 12238 |
| Signup form with validation + submit | parchment | sonnet | 3 | $0.0930 / $0.0924 / $0.0907 / $0.0959 | 77290 / 77279 / 76843 / 77748 | 38077 / 38093 / 37872 / 38267 |
| Signup form with validation + submit | html | sonnet | 3 | $0.0493 / $0.0494 / $0.0488 / $0.0497 | 21644 / 21652 / 21602 / 21679 | 10749 / 10750 / 10728 / 10768 |
| Live log dashboard (setup half of tokens-per-update) | parchment | sonnet | 3 | $0.0965 / $0.0983 / $0.0916 / $0.0997 | 78305 / 78554 / 77669 / 78693 | 38521 / 38701 / 38137 / 38726 |
| Live log dashboard (setup half of tokens-per-update) | html | sonnet | 3 | $0.0978 / $0.1000 / $0.0934 / $0.1001 | 26240 / 26441 / 25821 / 26459 | 13027 / 13123 / 12818 / 13140 |

## Raw runs

| Scenario | Arm | Model | Rep | Passed | Cost $ | Tokens | Turns | JSONL |
|---|---|---|---|---|---|---|---|---|
| status-dashboard | parchment | sonnet | 1 | yes | $0.1045 | 79346 | 4 | `raw/jsonl/status-dashboard-parchment-sonnet-rep1.jsonl` |
| status-dashboard | parchment | sonnet | 2 | yes | $0.1062 | 79757 | 4 | `raw/jsonl/status-dashboard-parchment-sonnet-rep2.jsonl` |
| status-dashboard | parchment | sonnet | 3 | yes | $0.1071 | 79949 | 4 | `raw/jsonl/status-dashboard-parchment-sonnet-rep3.jsonl` |
| status-dashboard | html | sonnet | 1 | yes | $0.1168 | 28144 | 2 | `raw/jsonl/status-dashboard-html-sonnet-rep1.jsonl` |
| status-dashboard | html | sonnet | 2 | yes | $0.1173 | 28183 | 2 | `raw/jsonl/status-dashboard-html-sonnet-rep2.jsonl` |
| status-dashboard | html | sonnet | 3 | yes | $0.1252 | 28948 | 2 | `raw/jsonl/status-dashboard-html-sonnet-rep3.jsonl` |
| csv-data-table | parchment | sonnet | 1 | yes | $0.0519 | 36375 | 2 | `raw/jsonl/csv-data-table-parchment-sonnet-rep1.jsonl` |
| csv-data-table | parchment | sonnet | 2 | yes | $0.0516 | 36305 | 2 | `raw/jsonl/csv-data-table-parchment-sonnet-rep2.jsonl` |
| csv-data-table | parchment | sonnet | 3 | yes | $0.0516 | 36304 | 2 | `raw/jsonl/csv-data-table-parchment-sonnet-rep3.jsonl` |
| csv-data-table | html | sonnet | 1 | yes | $0.0523 | 21904 | 2 | `raw/jsonl/csv-data-table-html-sonnet-rep1.jsonl` |
| csv-data-table | html | sonnet | 2 | yes | $0.0529 | 21957 | 2 | `raw/jsonl/csv-data-table-html-sonnet-rep2.jsonl` |
| csv-data-table | html | sonnet | 3 | yes | $0.0532 | 21981 | 2 | `raw/jsonl/csv-data-table-html-sonnet-rep3.jsonl` |
| architecture-diagram | parchment | sonnet | 1 | yes | $0.0483 | 35955 | 2 | `raw/jsonl/architecture-diagram-parchment-sonnet-rep1.jsonl` |
| architecture-diagram | parchment | sonnet | 2 | yes | $0.0480 | 35927 | 2 | `raw/jsonl/architecture-diagram-parchment-sonnet-rep2.jsonl` |
| architecture-diagram | parchment | sonnet | 3 | yes | $0.0471 | 35901 | 2 | `raw/jsonl/architecture-diagram-parchment-sonnet-rep3.jsonl` |
| architecture-diagram | html | sonnet | 1 | yes | $0.0608 | 22684 | 2 | `raw/jsonl/architecture-diagram-html-sonnet-rep1.jsonl` |
| architecture-diagram | html | sonnet | 2 | yes | $0.0614 | 22738 | 2 | `raw/jsonl/architecture-diagram-html-sonnet-rep2.jsonl` |
| architecture-diagram | html | sonnet | 3 | yes | $0.0618 | 22778 | 2 | `raw/jsonl/architecture-diagram-html-sonnet-rep3.jsonl` |
| incident-report | parchment | sonnet | 1 | yes | $0.0923 | 77757 | 4 | `raw/jsonl/incident-report-parchment-sonnet-rep1.jsonl` |
| incident-report | parchment | sonnet | 2 | yes | $0.0933 | 77916 | 4 | `raw/jsonl/incident-report-parchment-sonnet-rep2.jsonl` |
| incident-report | parchment | sonnet | 3 | yes | $0.0958 | 78607 | 4 | `raw/jsonl/incident-report-parchment-sonnet-rep3.jsonl` |
| incident-report | html | sonnet | 1 | yes | $0.0778 | 24386 | 2 | `raw/jsonl/incident-report-html-sonnet-rep1.jsonl` |
| incident-report | html | sonnet | 2 | yes | $0.0662 | 23282 | 2 | `raw/jsonl/incident-report-html-sonnet-rep2.jsonl` |
| incident-report | html | sonnet | 3 | yes | $0.0804 | 24636 | 2 | `raw/jsonl/incident-report-html-sonnet-rep3.jsonl` |
| validated-form | parchment | sonnet | 1 | yes | $0.0959 | 77748 | 4 | `raw/jsonl/validated-form-parchment-sonnet-rep1.jsonl` |
| validated-form | parchment | sonnet | 2 | yes | $0.0924 | 77279 | 4 | `raw/jsonl/validated-form-parchment-sonnet-rep2.jsonl` |
| validated-form | parchment | sonnet | 3 | yes | $0.0907 | 76843 | 4 | `raw/jsonl/validated-form-parchment-sonnet-rep3.jsonl` |
| validated-form | html | sonnet | 1 | yes | $0.0497 | 21679 | 2 | `raw/jsonl/validated-form-html-sonnet-rep1.jsonl` |
| validated-form | html | sonnet | 2 | yes | $0.0488 | 21602 | 2 | `raw/jsonl/validated-form-html-sonnet-rep2.jsonl` |
| validated-form | html | sonnet | 3 | yes | $0.0494 | 21652 | 2 | `raw/jsonl/validated-form-html-sonnet-rep3.jsonl` |
| live-log-dashboard | parchment | sonnet | 1 | yes | $0.0916 | 77669 | 4 | `raw/jsonl/live-log-dashboard-parchment-sonnet-rep1.jsonl` |
| live-log-dashboard | parchment | sonnet | 2 | yes | $0.0983 | 78554 | 4 | `raw/jsonl/live-log-dashboard-parchment-sonnet-rep2.jsonl` |
| live-log-dashboard | parchment | sonnet | 3 | yes | $0.0997 | 78693 | 4 | `raw/jsonl/live-log-dashboard-parchment-sonnet-rep3.jsonl` |
| live-log-dashboard | html | sonnet | 1 | yes | $0.1001 | 26459 | 2 | `raw/jsonl/live-log-dashboard-html-sonnet-rep1.jsonl` |
| live-log-dashboard | html | sonnet | 2 | yes | $0.1000 | 26441 | 2 | `raw/jsonl/live-log-dashboard-html-sonnet-rep2.jsonl` |
| live-log-dashboard | html | sonnet | 3 | yes | $0.0934 | 25821 | 2 | `raw/jsonl/live-log-dashboard-html-sonnet-rep3.jsonl` |