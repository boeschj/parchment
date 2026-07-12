# Metric (c): tokens-per-live-update

- Generated: 2026-07-12T15:19:55.968Z
- Model: sonnet
- Updates measured per arm: 10

## HTML arm — one billable `claude -p` call per update

- Create call: $0.1023 (26640 tokens)
- 10 update calls (--resume, same session): mean $0.0321, median $0.0326, min $0.0223, max $0.0417
- Mean tokens per update: 38628 (min 29675, max 49587)
- Total cost for setup + 10 updates: $0.4233
- Log lines still in the FINAL file: 10/10. NOTE: the dashboard's original spec shows only the 3 MOST RECENT log lines, so a final count of 3 with all per-step checks passing means every update landed and the table rolled forward correctly — it is NOT data loss. Treat the per-step column as the correctness signal.

| Call | Cost $ | Tokens | This step's log line present |
|---|---|---|---|
| create | $0.1023 | 26640 | n/a (create call) |
| update 1 | $0.0369 | 29675 | yes |
| update 2 | $0.0223 | 31254 | yes |
| update 3 | $0.0243 | 32983 | yes |
| update 4 | $0.0265 | 34827 | yes |
| update 5 | $0.0289 | 36847 | yes |
| update 6 | $0.0313 | 39043 | yes |
| update 7 | $0.0338 | 41415 | yes |
| update 8 | $0.0364 | 43963 | yes |
| update 9 | $0.0390 | 46687 | yes |
| update 10 | $0.0417 | 49587 | yes |

## Parchment arm — one call composes and streams, then zero further calls

- Compose+stream call: $0.0862 (76979 tokens) — this is the ONLY cost the user ever pays for this dashboard's updates.
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
| 6 | 7222 | 11 |
| 7 | 8426 | 12 |
| 8 | 9630 | 13 |
| 9 | 10833 | 14 |
| 10 | 12037 | 15 |

## Headline comparison

- HTML: ~38628 tokens and ~$0.0321 per update (10 real `claude -p` calls).
- Parchment: 0 tokens and $0 per update (0 `claude -p` calls for 10 updates) — cost is paid once, at compose time.