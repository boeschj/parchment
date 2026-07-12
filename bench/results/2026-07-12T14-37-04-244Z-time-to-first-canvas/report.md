# Metric (d): time-to-first-canvas (daemon boot, cold vs warm)

- Generated: 2026-07-12T14:37:04.244Z
- Iterations: 5
- Zero LLM cost — this measures daemon boot time only, never spawns `claude -p`.
- "Cold": brand-new `~/.parchment` (fresh HOME, state directory/token/database all created from scratch).
- "Warm": second boot against the SAME `~/.parchment` the cold boot just initialized.

## Summary (ms)

| | N | Mean | Median | Min | Max |
|---|---|---|---|---|---|
| Cold boot | 5 | 205 | 204 | 203 | 209 |
| Warm boot | 5 | 204 | 204 | 203 | 204 |

## Raw per-iteration timings (ms)

| Iteration | Cold | Warm |
|---|---|---|
| 1 | 209 | 203 |
| 2 | 203 | 203 |
| 3 | 203 | 204 |
| 4 | 204 | 204 |
| 5 | 204 | 204 |