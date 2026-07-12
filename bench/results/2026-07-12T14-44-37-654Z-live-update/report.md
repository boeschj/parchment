# Metric (c): tokens-per-live-update

- Generated: 2026-07-12T14:47:55.946Z
- Updates measured per arm: 10

## HTML arm — one billable `claude -p` call per update

- Create call: $0.0542 (26603 tokens)
- 10 update calls (--resume, same session): mean $0.0132, median $0.0132, min $0.0106, max $0.0153
- Mean tokens per update: 58832 (min 42675, max 75323)
- Total cost for setup + 10 updates: $0.1862
- Log lines still in the FINAL file: 3/10 (absent: 1, 2, 3, 4, 5, 6, 7). NOTE: the dashboard's original spec shows only the 3 MOST RECENT log lines, so a final count of 3 with all per-step checks passing means every update landed and the table rolled forward correctly — it is NOT data loss. Verified independently: the final file's chart series holds all 15 points (5 seed + 10 updates). Treat the per-step column as the correctness signal.

| Call | Cost $ | Tokens | This step's log line present |
|---|---|---|---|
| create | $0.0542 | 26603 | n/a (create call) |
| update 1 | $0.0106 | 42675 | yes |
| update 2 | $0.0119 | 46328 | yes |
| update 3 | $0.0120 | 49797 | yes |
| update 4 | $0.0126 | 53334 | yes |
| update 5 | $0.0130 | 56888 | yes |
| update 6 | $0.0134 | 60485 | yes |
| update 7 | $0.0139 | 64127 | yes |
| update 8 | $0.0144 | 67814 | yes |
| update 9 | $0.0148 | 71546 | yes |
| update 10 | $0.0153 | 75323 | yes |

## Parchment arm — one call composes and streams, then zero further calls

- Compose+stream call: $0.0311 (62948 tokens) — this is the ONLY cost the user ever pays for this dashboard's updates.
- Baseline series length after compose: 5
- `claude -p` calls made while driving 10 updates: 0 (updates were driven by appending lines directly to the tailed file — no LLM involved)
- Final series length: 15 (expected 15: matches)

Observed state growth after each direct file append (zero claude -p calls in this loop):

| Append # | Elapsed ms since first append | Series length observed |
|---|---|---|
| 1 | 1203 | 6 |
| 2 | 2406 | 7 |
| 3 | 3610 | 8 |
| 4 | 4813 | 9 |
| 5 | 6016 | 10 |
| 6 | 7219 | 11 |
| 7 | 8422 | 12 |
| 8 | 9626 | 13 |
| 9 | 10828 | 14 |
| 10 | 12030 | 15 |

## Headline comparison

- HTML: ~58832 tokens and ~$0.0132 per update (10 real `claude -p` calls).
- Parchment: 0 tokens and $0 per update (0 `claude -p` calls for 10 updates) — cost is paid once, at compose time.