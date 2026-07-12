# Parchment benchmark report

- Generated: 2026-07-12T14:54:15.023Z
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
| Architecture diagram (3-tier system) | html | haiku | 3 | 100% | $0.0253 | 18178 | 1 | 8972 | 1 |
| Architecture diagram (3-tier system) | parchment | haiku | 3 | 100% | $0.0150 | 27879 | 1 | 13856 | 1 |
| Data table from a CSV snippet | html | haiku | 3 | 100% | $0.0248 | 18044 | 1 | 8923 | 1 |
| Data table from a CSV snippet | parchment | haiku | 3 | 100% | $0.0167 | 28337 | 1 | 14117 | 1 |
| Incident postmortem report | html | haiku | 3 | 100% | $0.0304 | 19674 | 1 | 9667 | 1 |
| Incident postmortem report | parchment | haiku | 3 | 100% | $0.0242 | 40183 | 1 | 14935 | 1 |
| Live log dashboard (setup half of tokens-per-update) | html | haiku | 3 | 100% | $0.0429 | 23207 | 1 | 11428 | 1 |
| Live log dashboard (setup half of tokens-per-update) | parchment | haiku | 3 | 100% | $0.0334 | 47955 | 2 | 26232 | 2 |
| CI status dashboard (KPI row + 2 charts) | html | haiku | 3 | 100% | $0.0452 | 23765 | 1 | 11624 | 1 |
| CI status dashboard (KPI row + 2 charts) | parchment | haiku | 3 | 100% | $0.0377 | 50564 | 1 | 22156 | 1 |
| Signup form with validation + submit | html | haiku | 3 | 100% | $0.0226 | 17469 | 1 | 8620 | 1 |
| Signup form with validation + submit | parchment | haiku | 3 | 100% | $0.0353 | 49273 | 2 | 32556 | 2 |

## Spread (mean / median / min / max)

| Scenario | Arm | Model | N | Cost $ (mean / median / min / max) | Tokens (mean / median / min / max) | Tokens to first paint (mean / median / min / max) |
|---|---|---|---|---|---|---|
| Architecture diagram (3-tier system) | html | haiku | 3 | $0.0253 / $0.0252 / $0.0246 / $0.0260 | 18178 / 18136 / 18027 / 18370 | 8972 / 8945 / 8909 / 9061 |
| Architecture diagram (3-tier system) | parchment | haiku | 3 | $0.0150 / $0.0149 / $0.0149 / $0.0154 | 27879 / 27841 / 27824 / 27972 | 13856 / 13842 / 13824 / 13902 |
| Data table from a CSV snippet | html | haiku | 3 | $0.0248 / $0.0239 / $0.0234 / $0.0270 | 18044 / 17788 / 17657 / 18686 | 8923 / 8789 / 8734 / 9245 |
| Data table from a CSV snippet | parchment | haiku | 3 | $0.0167 / $0.0167 / $0.0163 / $0.0170 | 28337 / 28353 / 28230 / 28427 | 14117 / 14105 / 14073 / 14174 |
| Incident postmortem report | html | haiku | 3 | $0.0304 / $0.0303 / $0.0294 / $0.0315 | 19674 / 19628 / 19401 / 19993 | 9667 / 9640 / 9507 / 9854 |
| Incident postmortem report | parchment | haiku | 3 | $0.0242 / $0.0242 / $0.0219 / $0.0263 | 40183 / 44962 / 29938 / 45650 | 14935 / 14938 / 14849 / 15019 |
| Live log dashboard (setup half of tokens-per-update) | html | haiku | 3 | $0.0429 / $0.0362 / $0.0349 / $0.0576 | 23207 / 21289 / 20915 / 27416 | 11428 / 10477 / 10277 / 13529 |
| Live log dashboard (setup half of tokens-per-update) | parchment | haiku | 3 | $0.0334 / $0.0328 / $0.0311 / $0.0364 | 47955 / 47952 / 33961 / 61953 | 26232 / 30339 / 16844 / 31512 |
| CI status dashboard (KPI row + 2 charts) | html | haiku | 3 | $0.0452 / $0.0451 / $0.0442 / $0.0462 | 23765 / 23759 / 23476 / 24059 | 11624 / 11635 / 11487 / 11749 |
| CI status dashboard (KPI row + 2 charts) | parchment | haiku | 3 | $0.0377 / $0.0376 / $0.0304 / $0.0452 | 50564 / 50317 / 32050 / 69326 | 22156 / 16700 / 15879 / 33889 |
| Signup form with validation + submit | html | haiku | 3 | $0.0226 / $0.0224 / $0.0221 / $0.0233 | 17469 / 17424 / 17310 / 17672 | 8620 / 8615 / 8520 / 8725 |
| Signup form with validation + submit | parchment | haiku | 3 | $0.0353 / $0.0351 / $0.0285 / $0.0423 | 49273 / 49203 / 46412 / 52205 | 32556 / 32516 / 30658 / 34494 |

## Raw runs

| Scenario | Arm | Model | Rep | Passed | Cost $ | Tokens | Turns | JSONL |
|---|---|---|---|---|---|---|---|---|
| architecture-diagram | html | haiku | 1 | yes | $0.0252 | 18136 | 2 | `raw/jsonl/architecture-diagram-html-haiku-rep1.jsonl` |
| architecture-diagram | html | haiku | 2 | yes | $0.0260 | 18370 | 2 | `raw/jsonl/architecture-diagram-html-haiku-rep2.jsonl` |
| architecture-diagram | html | haiku | 3 | yes | $0.0246 | 18027 | 2 | `raw/jsonl/architecture-diagram-html-haiku-rep3.jsonl` |
| architecture-diagram | parchment | haiku | 1 | yes | $0.0149 | 27841 | 2 | `raw/jsonl/architecture-diagram-parchment-haiku-rep1.jsonl` |
| architecture-diagram | parchment | haiku | 2 | yes | $0.0154 | 27972 | 2 | `raw/jsonl/architecture-diagram-parchment-haiku-rep2.jsonl` |
| architecture-diagram | parchment | haiku | 3 | yes | $0.0149 | 27824 | 2 | `raw/jsonl/architecture-diagram-parchment-haiku-rep3.jsonl` |
| csv-data-table | html | haiku | 1 | yes | $0.0270 | 18686 | 2 | `raw/jsonl/csv-data-table-html-haiku-rep1.jsonl` |
| csv-data-table | html | haiku | 2 | yes | $0.0239 | 17788 | 2 | `raw/jsonl/csv-data-table-html-haiku-rep2.jsonl` |
| csv-data-table | html | haiku | 3 | yes | $0.0234 | 17657 | 2 | `raw/jsonl/csv-data-table-html-haiku-rep3.jsonl` |
| csv-data-table | parchment | haiku | 1 | yes | $0.0163 | 28230 | 2 | `raw/jsonl/csv-data-table-parchment-haiku-rep1.jsonl` |
| csv-data-table | parchment | haiku | 2 | yes | $0.0170 | 28427 | 2 | `raw/jsonl/csv-data-table-parchment-haiku-rep2.jsonl` |
| csv-data-table | parchment | haiku | 3 | yes | $0.0167 | 28353 | 2 | `raw/jsonl/csv-data-table-parchment-haiku-rep3.jsonl` |
| incident-report | html | haiku | 1 | yes | $0.0294 | 19401 | 2 | `raw/jsonl/incident-report-html-haiku-rep1.jsonl` |
| incident-report | html | haiku | 2 | yes | $0.0303 | 19628 | 2 | `raw/jsonl/incident-report-html-haiku-rep2.jsonl` |
| incident-report | html | haiku | 3 | yes | $0.0315 | 19993 | 2 | `raw/jsonl/incident-report-html-haiku-rep3.jsonl` |
| incident-report | parchment | haiku | 1 | yes | $0.0242 | 44962 | 3 | `raw/jsonl/incident-report-parchment-haiku-rep1.jsonl` |
| incident-report | parchment | haiku | 2 | yes | $0.0219 | 29938 | 2 | `raw/jsonl/incident-report-parchment-haiku-rep2.jsonl` |
| incident-report | parchment | haiku | 3 | yes | $0.0263 | 45650 | 3 | `raw/jsonl/incident-report-parchment-haiku-rep3.jsonl` |
| live-log-dashboard | html | haiku | 1 | yes | $0.0576 | 27416 | 2 | `raw/jsonl/live-log-dashboard-html-haiku-rep1.jsonl` |
| live-log-dashboard | html | haiku | 2 | yes | $0.0349 | 20915 | 2 | `raw/jsonl/live-log-dashboard-html-haiku-rep2.jsonl` |
| live-log-dashboard | html | haiku | 3 | yes | $0.0362 | 21289 | 2 | `raw/jsonl/live-log-dashboard-html-haiku-rep3.jsonl` |
| live-log-dashboard | parchment | haiku | 1 | yes | $0.0311 | 61953 | 4 | `raw/jsonl/live-log-dashboard-parchment-haiku-rep1.jsonl` |
| live-log-dashboard | parchment | haiku | 2 | yes | $0.0328 | 47952 | 3 | `raw/jsonl/live-log-dashboard-parchment-haiku-rep2.jsonl` |
| live-log-dashboard | parchment | haiku | 3 | yes | $0.0364 | 33961 | 2 | `raw/jsonl/live-log-dashboard-parchment-haiku-rep3.jsonl` |
| status-dashboard | html | haiku | 1 | yes | $0.0442 | 23476 | 2 | `raw/jsonl/status-dashboard-html-haiku-rep1.jsonl` |
| status-dashboard | html | haiku | 2 | yes | $0.0451 | 23759 | 2 | `raw/jsonl/status-dashboard-html-haiku-rep2.jsonl` |
| status-dashboard | html | haiku | 3 | yes | $0.0462 | 24059 | 2 | `raw/jsonl/status-dashboard-html-haiku-rep3.jsonl` |
| status-dashboard | parchment | haiku | 1 | yes | $0.0304 | 32050 | 2 | `raw/jsonl/status-dashboard-parchment-haiku-rep1.jsonl` |
| status-dashboard | parchment | haiku | 2 | yes | $0.0452 | 69326 | 4 | `raw/jsonl/status-dashboard-parchment-haiku-rep2.jsonl` |
| status-dashboard | parchment | haiku | 3 | yes | $0.0376 | 50317 | 3 | `raw/jsonl/status-dashboard-parchment-haiku-rep3.jsonl` |
| validated-form | html | haiku | 1 | yes | $0.0233 | 17672 | 2 | `raw/jsonl/validated-form-html-haiku-rep1.jsonl` |
| validated-form | html | haiku | 2 | yes | $0.0224 | 17424 | 2 | `raw/jsonl/validated-form-html-haiku-rep2.jsonl` |
| validated-form | html | haiku | 3 | yes | $0.0221 | 17310 | 2 | `raw/jsonl/validated-form-html-haiku-rep3.jsonl` |
| validated-form | parchment | haiku | 1 | yes | $0.0423 | 52205 | 3 | `raw/jsonl/validated-form-parchment-haiku-rep1.jsonl` |
| validated-form | parchment | haiku | 2 | yes | $0.0285 | 46412 | 3 | `raw/jsonl/validated-form-parchment-haiku-rep2.jsonl` |
| validated-form | parchment | haiku | 3 | yes | $0.0351 | 49203 | 3 | `raw/jsonl/validated-form-parchment-haiku-rep3.jsonl` |