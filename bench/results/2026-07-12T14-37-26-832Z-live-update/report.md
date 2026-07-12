# Metric (c): tokens-per-live-update

- Generated: 2026-07-12T14:41:33.241Z
- Updates measured per arm: 10

## HTML arm — one billable `claude -p` call per update

- Create call: $0.0354 (21164 tokens)
- 10 update calls (--resume, same session): mean $0.0191, median $0.0242, min $0.0023, max $0.0368
- Mean tokens per update: 76250 (min 10993, max 168519)
- Total cost for setup + 10 updates: $0.2265
- Final file contains all 10 appended log lines: NO — updates were lost or corrupted across turns

| Call | Cost $ | Tokens | This step's log line present |
|---|---|---|---|
| create | $0.0354 | 21164 | n/a (create call) |
| update 1 | $0.0026 | 10993 | NO |
| update 2 | $0.0023 | 11204 | NO |
| update 3 | $0.0025 | 11462 | NO |
| update 4 | $0.0035 | 11908 | NO |
| update 5 | $0.0194 | 54372 | NO |
| update 6 | $0.0296 | 97690 | NO |
| update 7 | $0.0289 | 114657 | NO |
| update 8 | $0.0314 | 131893 | NO |
| update 9 | $0.0340 | 149804 | NO |
| update 10 | $0.0368 | 168519 | NO |

## Parchment arm — one call composes and streams, then zero further calls

- Compose+stream call: $0.0488 (48592 tokens) — this is the ONLY cost the user ever pays for this dashboard's updates.
- Baseline series length after compose: 5
- `claude -p` calls made while driving 10 updates: 0 (updates were driven by appending lines directly to the tailed file — no LLM involved)
- Final series length: 15 (expected 15: matches)

Observed state growth after each direct file append (zero claude -p calls in this loop):

| Append # | Elapsed ms since first append | Series length observed |
|---|---|---|
| 1 | 1203 | 6 |
| 2 | 2410 | 7 |
| 3 | 3613 | 8 |
| 4 | 4817 | 9 |
| 5 | 6019 | 10 |
| 6 | 7223 | 11 |
| 7 | 8426 | 12 |
| 8 | 9629 | 13 |
| 9 | 10831 | 14 |
| 10 | 12034 | 15 |

## Headline comparison

- HTML: ~76250 tokens and ~$0.0191 per update (10 real `claude -p` calls).
- Parchment: 0 tokens and $0 per update (0 `claude -p` calls for 10 updates) — cost is paid once, at compose time.