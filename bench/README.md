# parchment benchmark harness

Measurement infrastructure for the launch story's headline claim: parchment's
canvas_* MCP tools beat single-file HTML artifact authoring on the metrics
that actually matter — not raw spec size, but how many model turns it takes
to land a correct render, how many tokens the user pays before seeing
anything, and what a live dashboard costs to keep updated. See
`docs/internal/ARCHITECTURE-PLAN.md`'s "Benchmarks" section for the research
this was scoped against.

This directory is self-contained: it does not import from or modify `src/`,
and it never touches a developer's real `~/.parchment` daemon state (see
"Daemon isolation" below).

## Quick start

```bash
# One scenario, both arms, haiku, 2 reps each — a cheap sanity check (~4 claude -p calls, ~$0.20).
bun run bench/cli.ts run --scenario status-dashboard --arms parchment,html --models haiku --reps 2

# The full moderate suite: every scenario, both arms, both models, 5 reps each.
bun run bench/cli.ts run --scenario all --arms parchment,html --models haiku,sonnet --reps 5
```

Each invocation:
1. Boots an isolated, disposable parchment daemon (only if the `parchment` arm is requested).
2. Runs every (scenario × arm × model × repetition) combination through a headless `claude -p`.
3. Extracts token/turn metrics from the run's own session JSONL and validates the resulting
   artifact against the scenario's requirements (hitting the live daemon's HTTP API for the
   parchment arm; reading the written file for the HTML arm).
4. Writes `bench/results/<timestamp>/report.md` plus one raw JSON record and one archived JSONL
   copy per run under `bench/results/<timestamp>/raw/`.

Run `bun run bench/cli.ts` with no arguments for the full flag list.

## Architecture

```
bench/
  claude-cli.ts        spawns `claude -p` with arm-appropriate flags, parses the result JSON
  session-locator.ts    finds the session JSONL a run just wrote, by exact session-id filename
  daemon-harness.ts     boots/tears down an isolated bench daemon (own HOME, own port)
  mcp-config.ts          writes the per-run --mcp-config file for the parchment arm
  runner.ts              composes the above into one repetition: run -> locate -> extract -> validate
  metrics/
    read-transcript.ts    JSONL -> TraceEntry[] (@boeschj/claude-jsonl)
    extract-metrics.ts    TraceEntry[] -> token/turn/first-paint numbers (pure, unit-tested)
  validators/
    parchment-validator.ts   hits the daemon's /api/sessions/<id>/state, checks component counts
    html-validator.ts        regex-based structural check of the written HTML file
  scenarios/              6 fixed tasks; each defines a prompt + requirement per arm
  stats.ts                 mean/median/min/max
  report.ts                 aggregates RunRecords into report.md
  cli.ts                    entry point
```

## Daemon isolation

A developer's real parchment daemon may already be running with live sessions —
it was, on this machine, when this harness was built (21 active sessions on
port 7801). The daemon's entire state directory (`~/.parchment`: port, token,
PID files, session slots) is derived from `os.homedir()`, and that is **not**
configurable via an environment variable in the current daemon code (see
`src/daemon/state.ts`). `HOME` is the only lever available without touching
`src/`, so `daemon-harness.ts` boots the bench daemon with `HOME` pointed at a
freshly `mkdtemp`'d directory. `mcp-config.ts` gives the spawned canvas MCP
server subprocess (not the outer `claude -p` process, which still needs the
real `HOME` for auth) the same overridden `HOME`, so it resolves the bench
daemon instead of a developer's real one. This was verified directly before
being wired into the harness: booting a daemon with `HOME=<scratch>
CANVAS_PORT=7811` produced a completely separate `<scratch>/.parchment/`,
and the real daemon's `~/.parchment/server.port` was unchanged throughout.

## The exact `claude -p` invocation that worked

Confirmed end-to-end against the real daemon (not simulated) — see
`bench/results/2026-07-12T06-31-15-061Z/` for the run that produced this.

**Parchment arm:**

```bash
claude -p "<scenario prompt>" \
  --model haiku \
  --session-id <uuid> \
  --output-format json \
  --setting-sources "" \
  --permission-mode bypassPermissions \
  --strict-mcp-config \
  --mcp-config <run-dir>/mcp-config.json \
  --tools "" \
  --allowedTools "mcp__canvas__canvas_render"
```

where `mcp-config.json` is:

```json
{
  "mcpServers": {
    "canvas": {
      "command": "bun",
      "args": ["run", "<repo>/src/daemon/mcp-stdio.ts"],
      "env": { "HOME": "<bench-daemon-home>", "CANVAS_SESSION_ID": "<uuid>" }
    }
  }
}
```

**HTML arm:**

```bash
claude -p "<scenario prompt>" \
  --model haiku \
  --session-id <uuid> \
  --output-format json \
  --setting-sources "" \
  --permission-mode bypassPermissions \
  --strict-mcp-config \
  --tools "Write,Edit"
```

Notes on flags that mattered:
- `--session-id <uuid>` (a UUID the harness generates) makes the transcript file locatable by
  exact filename (`~/.claude/projects/<any-project-dir>/<uuid>.jsonl`) — see session-locator.ts's
  doc comment for why this beats reimplementing Claude Code's undocumented cwd-encoding scheme.
- `--setting-sources ""` strips the operator's personal CLAUDE.md/memory/project settings.
  Verified this matters: a trivial one-word reply cost ~10.2k cache-creation tokens with the
  operator's real CLAUDE.md loaded, dropping to ~7k with `--setting-sources ""` (the remaining
  ~7k is the fixed system-prompt/tool-schema overhead every Claude Code call pays).
- `--bare` was tried and rejected: it forces `ANTHROPIC_API_KEY`/`apiKeyHelper` auth and fails
  outright under an OAuth subscription login ("Not logged in · Please run /login").
  `--setting-sources ""` gets the same noise reduction without breaking auth.
- `--permission-mode bypassPermissions` is required — headless mode has no TTY to answer a
  permission prompt, and MCP tool calls are gated by the same permission system as built-ins.
- `--tools ""` (parchment arm) disables every built-in tool; MCP-provided tools are a separate
  registration path and are unaffected — confirmed by the model successfully calling
  `mcp__canvas__canvas_render` with zero built-ins available.
- The MCP tool name convention is `mcp__<serverKey>__<toolName>` — `canvas` is the server key
  (see `src/cli/paths.ts`'s `MCP_SERVER_KEY`), so `canvas_render` becomes `mcp__canvas__canvas_render`.

## Metric definitions

- **passes-to-correct-render**: not directly stored as one field — derive it from
  `transcript.renderAttempts` (how many times the authoring tool was called: `Write`/`Edit` for
  HTML, the scenario's one canvas_* tool for parchment) combined with `validation.passed` (did the
  *final* state — the live daemon's slot, or the file on disk — satisfy the scenario). A run that
  never validates has no "passes to correct" — it failed within budget.
- **tokens-to-first-paint** / **turns-to-first-paint**: cumulative prompt+completion tokens (and
  turn count) through the first *accepted* authoring call — the first canvas_render that wasn't
  rejected, or the first successful file write. Not necessarily the first *correct* one; see
  "Known limitations" in the generated report for why first-paint and first-correct are tracked
  separately.
- **Prompt tokens**: `usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens`,
  not `input_tokens` alone. Anthropic's `input_tokens` is only the cache-miss delta for that turn;
  almost the entire system prompt and tool schemas arrive as cache reads. Using `input_tokens`
  alone under-reports by ~1000x on some turns (verified: a run showing 34 "prompt tokens" cost
  $0.055 — obviously wrong; the same run recomputed with cache tokens included showed ~54k).
- **tokens-per-live-update** (metric c): measured by `bun run bench/live-update.ts` (10 updates
  per arm, 1 rep, haiku). The parchment arm makes ONE `claude -p` call (canvas_render seeding
  chart state + canvas_live registering a file-tail source), after which the script appends
  lines directly to the tailed file and polls the daemon's own `/api/sessions/<id>/state`
  endpoint to watch the slot's state array grow — proving the zero-token claim by observation,
  not assumption. The HTML arm makes 1 create call + 10 `--resume`d update calls, each a real
  billable turn, priced from that call's own usage block (never the cumulative session JSONL,
  which would double-count earlier calls).
- **time-to-first-canvas** (metric d, daemon cold vs warm): measured by
  `bun run bench/time-to-first-canvas.ts` — 5 iterations of a cold boot (fresh HOME) followed
  by a warm boot (same HOME, state already initialized), timing `startBenchDaemon`'s own
  health-poll loop. Zero LLM cost.
- **skills delta**: `bun run bench/skills-delta.ts` re-runs status-dashboard/parchment/haiku
  with the canvas-tools + canvas-spec SKILL.md cores passed via `--append-system-prompt`
  (2 reps). Every other run uses `--setting-sources ""`, which never loads plugin skills, so
  the main suite is the no-skills control this compares against.
- **report rebuild**: `bun run bench/cli.ts report --dir bench/results/<timestamp>` regenerates
  a results directory's report.md from its raw/*.json records at zero cost — useful after a
  report-format change.

## Cost estimates

Tonight's smoke run (1 scenario, both arms, haiku, 2 reps each — 4 `claude -p` calls) actually
cost, in total: **$0.211** (parchment: $0.0377 + $0.0360; HTML: $0.0540 + $0.0825). Per-run
costs varied 2x within the same arm/scenario/model — expect real variance, not a fixed number.

Rough extrapolation for the full moderate suite (6 scenarios × 2 arms × 2 models × 5 reps = 120
runs), assuming sonnet costs roughly 3x haiku per run (not yet measured — re-check with a small
sonnet batch before committing budget):

| | haiku (5 reps × 6 scenarios × 2 arms = 60 runs) | sonnet (60 runs) | Total |
|---|---|---|---|
| Estimated cost | ~$6.30 | ~$18.90 | **~$25** |

This excludes the live-update sweep (metric c), which is priced separately per its own N since
it multiplies by 20 update-calls per rep — do not fold it into the base estimate above without
first re-measuring at N=1.

## Known gaps in this version

- The HTML validators are regex-based, not a real DOM parse (`node-html-parser` was considered
  and explicitly not added, to keep the harness dependency-free — every requirement here reduces
  to "does this tag/text appear," which a parser would not make meaningfully more reliable).
- The two arms' pass/fail checks are not equally strict: the parchment daemon rejects
  structurally invalid specs before they ever render, while the HTML regex check only asserts
  that required tags/text exist — a file can pass it while rendering poorly.
- `live-update.ts` checks each update's log line by its distinctive fragment (without the
  `[INFO] ` prefix), because models legitimately render the level in its own styled table cell.
  The final-file retention count can also legitimately be 3/N: the scenario's own spec says the
  table shows the 3 most recent lines. Use the per-step column, plus the chart series length,
  as the correctness signals.

All six scenarios have now been exercised against live `claude -p` runs (see
`bench/results/2026-07-12T07-53-15-666Z/` for the full 36-run haiku suite); the published
numbers live in `docs/benchmarks.md`.
