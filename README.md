# clawd-canvas v0.3

> A shared workspace for you and Claude Code. Live session transcript, an instantly-appearing plan editor, a collaborative Excalidraw board, and generative UI Claude composes on demand — one statusline click away.

Claude has Artifacts, ChatGPT has Canvas, Cursor has plan files. Claude Code dumps walls of green ASCII into a terminal. **clawd-canvas** adds the missing rich-rendering surface — as a lightweight statusline-link addon.

## The surfaces

The left rail has three fixed tabs, then whatever Claude generates:

- **Transcript** — the full session, live: your prompts, Claude's prose as rendered markdown, thinking blocks, and every tool call with its input and output as collapsible rows. Streams while Claude works.
- **Plan** — the moment Claude exits plan mode (or calls `canvas_plan`), the plan appears here in a Tiptap WYSIWYG editor. Your edits flow back into Claude's next turn. The statusline flips from `◐ canvas` to `✎ view plan` so you never miss one.
- **Board** — one persistent Excalidraw scene per session, stored as a real `.excalidraw` file. You draw with the full Excalidraw UI; Claude draws through `board_*` MCP tools (incremental element edits, mermaid cold-starts) and can look at the board via PNG export. Both of you see every change live.
- **Generative slots** — Claude pushes composed UI (dashboards, reports, diffs, tables, diagrams) via `canvas_*` MCP tools. Each tool's `inputSchema` is a Zod-derived JSON Schema for a [json-render](https://github.com/vercel-labs/json-render) spec, validated against a 41-component catalog (36 shadcn/ui + 5 canvas extensions). The newest push pulls focus — a render IS the "look at this" signal.

## The trace explorer

A second rail group turns the canvas into a full trace explorer over everything Claude Code has ever recorded on your machine (`~/.claude/projects`). It's built on a typed parser covering the complete session JSONL schema — corpus-validated with zero unknown entry types — and every number is computed from real API usage data, never estimated:

- **Sessions** — browse every project and session: titles, first prompts, cost, tokens, branch, duration, and Claude's own judged outcome. Open any historical session and the transcript, graph, cost, and context views all load for it.
- **Session graph** — the killer view: an animated trace of what Claude did. The main thread is a pinned vertical spine (prompts, tool-call clusters with per-turn cost, compaction events, PR links); subagents diverge into side lanes git-graph style and rejoin where their results landed, each with its own cost/token/tool stats. Click a node to dim everything not connected to it.
- **Cost center** — exact spend, calibrated to reproduce Claude Code's own accounting to the cent (cache read/write tiers priced separately, `[1m]` variants, web-search fees). Per-session composition + burn curve, and an all-time view with daily burn by model and per-project totals.
- **Context explorer** — the context window over time from real usage data: baseline overhead, growth per call, compaction boundaries with exact pre/post token counts, top consumers, and the hidden attachment footprint (task reminders, skill listings, queued commands).
- **Safety** — facts, never scores: flagged shell commands (pattern tables ported from Codex/shellfirm), sensitive-file access, the full domain inventory checked against locally-cached URLhaus/phishing feeds, permission denials, and model refusals.

The transcript itself is metadata-rich: timestamps and day dividers, model + context-size chips, tool durations, denial states with reasons, compaction markers, and slash-command chips.

## Reliability model

The daemon never idles itself out. Every slot, edit, and board scene is persisted under `~/.canvas/sessions/` the moment it changes, and sessions hydrate from disk on access — a crash or restart loses nothing. Every consumer self-heals a dead daemon: the hooks respawn it, and so does any MCP tool call.

## Prerequisites

- macOS or Linux. Windows is on the v0.3 roadmap (uses POSIX-only primitives today).
- [Bun](https://bun.sh) `≥ 1.3` (`curl -fsSL https://bun.sh/install | bash`)
- `jq` and `curl` (preinstalled on macOS; `apt install jq` on Debian/Ubuntu)
- Claude Code `≥ 2.1.150`

## Install

Two commands inside Claude Code (requires [Bun](https://bun.sh) ≥ 1.3 on PATH):

```
/plugin marketplace add boeschj/clawd-canvas
/plugin install clawd-canvas@clawd-canvas
```

The first session after install builds the canvas in the background (~1 min
on a cold cache — watch for the `[clawd-canvas]` line at startup). The plugin
ships its own MCP server and hooks; every session start prints the canvas URL.

Optional: for a persistent statusline link (Claude Code doesn't yet let
plugins set `statusLine` themselves), add to your `~/.claude/settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "bash ~/.canvas/statusline.sh"
}
```

`~/.canvas/statusline.sh` is a small launcher the plugin regenerates on every
session start so it always points at your installed version. Use it rather than
a path into `~/.claude/plugins/cache/…/<version>/scripts/…` — that path is
version-stamped and dangles the next time the plugin updates.

The launcher is written the first time a session starts with the plugin
installed. Confirm it before restarting:

```bash
echo '{}' | bash ~/.canvas/statusline.sh
```

That prints `◐ canvas …` (or `◐ canvas: not running` if the daemon is down).
If instead you see `No such file`, start one Claude Code session so the plugin
can generate the launcher, then re-run the check.

<details>
<summary>Dev install (working from a clone)</summary>

```bash
git clone https://github.com/boeschj/clawd-canvas
cd clawd-canvas
bun install
bun run build       # produces dist/browser/
bun run cli install # patches ~/.claude/settings.json (backed up first)
```

`bun run cli install` writes four entries to `~/.claude/settings.json`:

1. `extraKnownMarketplaces["clawd-canvas"]` — local directory marketplace
2. `enabledPlugins["clawd-canvas@clawd-canvas"]: true`
3. `statusLine.command` — refuse-and-instruct if you already have one set
4. `mcpServers["canvas"]` — registers the canvas MCP server (gives Claude the `canvas_*` tools)

Your prior `settings.json` is backed up to `~/.claude/settings.json.bak-<timestamp>` first.
</details>

### Coexisting with clawd-canvas v0.1

v0.1 (`~/Documents/GitHub/clawd-canvas`) and v0.2 share the `clawd-canvas` plugin/marketplace key. Installing v0.2 will overwrite v0.1's entries. To revert, `cd` back to v0.1 and run its install. v0.2 also adds `mcpServers["canvas"]`, which v0.1 didn't have — uninstalling v0.2 cleanly removes it.

## Try it

After install, in a **new** terminal so settings reload:

```bash
claude
```

You'll see a clickable URL in your statusline:

```
◐ canvas localhost:7800/s/abc123
```

Cmd/Ctrl-click it. A browser tab opens with the empty canvas welcome card.

Back in your terminal, try:

```
> Make a 3-step plan for adding rate limiting to my API.
  Render it to the canvas as an editable plan.
```

Claude calls `canvas_plan`. A `✎ plan` tab appears in the canvas with the plan rendered in a Tiptap WYSIWYG editor.

**Edit the plan in the canvas** (change wording, add a step, anything).

Back in your terminal, send another message:

```
> Continue with the plan as I've edited it.
```

Claude's response references your edited version. The roundtrip just worked — no copy/paste, no `/resume`.

### Other things to try

```
> Show me a mermaid sequence diagram of the OAuth login flow,
  render it editable in the canvas.
```
→ `canvas_diagram` slot with side-by-side source + live mermaid render. Click any node to leave a comment.

```
> Propose a refactor for src/users/handler.ts: extract the validation
  into a helper. Render the diff in the canvas so I can tweak it.
```
→ `canvas_diff` slot with Monaco side-by-side diff, "after" side editable.

```
> Pull the top 10 slowest queries from pg_stat_statements
  and render as a sortable table in the canvas.
```
→ `canvas_table` slot with sortable columns + CSV export.

```
> Render a dashboard with 3 cards (revenue, MRR, churn) and a
  line chart of daily revenue for the last 30 days.
```
→ `canvas_render` with `kind: "dashboard"` composing shadcn Card + Heading + Chart.

### `/plan` mode auto-capture

Enter plan mode (Shift+Tab) and ask Claude for a plan. When Claude exits plan mode, the `PostToolUse` hook automatically pushes the plan to the canvas as a `✎ plan` slot — no MCP call needed.

## Templates

The **Library** tab in the left rail (book icon) lists every saved canvas UI — a
named copy of a rendered slot's spec, reloadable any time. A fresh install ships
with five starter templates, seeded automatically the first time the daemon or
the `canvas` MCP server starts, so the library is never empty:

| Template | What it composes |
|---|---|
| `project-status-dashboard` | Sprint KPIs, a milestone timeline with the blocker called out, per-workstream health, backlog table. |
| `pr-review` | What/why callout, size/risk metrics, per-file changes, an architecture-delta diagram, the crux diff, test results. |
| `incident-timeline` | Impact metrics, the causal chain with the break point marked, the smoking-gun log line, the offending code, a fix callout. |
| `cost-report` | Spend KPIs, a daily burn chart by model, a per-project breakdown table, an optimization callout. |
| `agent-fleet-snapshot` | Active-session KPIs, a live-session table, a token-usage chart — the flagship "what is every Claude session doing right now" shape. |

Ask Claude to save any rendered view for later — *"save this dashboard as
perf-overview"* calls `canvas_save`, and it appears in the Library alongside
the starters. From the panel, **Open** re-renders a saved UI into a slot;
**Delete** removes it. The same actions are available to Claude as
`canvas_save` / `canvas_load` / `canvas_library` MCP tools.

## Themes

The default look never changes — every alternate theme is opt-in. Pick one
from the palette icon in the left rail (built-ins, "Custom", or "Default" —
applies instantly, no refresh), or copy a file from `themes/` to
`~/.parchment/theme.css` for a zero-config override the daemon serves live.
Three fully-designed built-ins ship in `themes/`: **manuscript** (warm paper,
editorial serif accents), **terminal** (high-contrast phosphor green),
**slate** (cool, minimal dev-tool gray). Full variable contract and a
starter for writing your own: [`themes/README.md`](themes/README.md).

## How it works

```
┌────────────────────────────────────────────────────────────┐
│  Claude Code session                                        │
│                                                             │
│  Plugin (this repo):                                        │
│   • Skills: canvas-tools (composition playbook: transform   │
│     rules, named layouts, score rubric) + canvas-spec       │
│     (spec grammar, expressions, component inventory)        │
│   • Hooks:                                                  │
│     - SessionStart → boots daemon if dead                   │
│     - UserPromptSubmit → injects pending <canvas-edit>      │
│       blocks before the user's message                      │
│     - PostToolUse(ExitPlanMode) → auto-pushes plans         │
│   • MCP server `canvas` registered in settings.json:        │
│     - canvas_plan, canvas_diagram, canvas_diff,             │
│       canvas_dashboard, canvas_table, canvas_report,        │
│       canvas_render, canvas_close                           │
│   • Statusline: OSC-8 link with per-kind slot glyphs        │
│                                                             │
└──────────────────────────┬──────────────────────────────────┘
                           │ MCP stdio
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Bun daemon (default port 7800)                              │
│                                                              │
│  HTTP /api/sessions/:sid/slots POST/DELETE/PATCH            │
│  HTTP /api/sessions/:sid/edits POST/GET                     │
│  HTTP /api/bootstrap → token   /api/heartbeat               │
│  WebSocket /ws?session=:sid (server → browser push)         │
│                                                              │
│  Security: Host check, Origin match, X-Canvas-Token (0600)  │
│  Sessions: in-memory Map (persistence is v0.3)              │
│  Idle shutdown: 120s session stale + 60s empty-map grace    │
│                                                              │
└──────────────────────────┬──────────────────────────────────┘
                           │ WebSocket push
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Browser tab — http://localhost:7800/?session=<id>           │
│                                                              │
│  @json-render/react Renderer + @json-render/shadcn (36       │
│  components) + 5 canvas extensions:                          │
│   ✎ plan      PlanFile      Tiptap WYSIWYG markdown          │
│   ▱ diagram   MermaidEditor source pane + live render +      │
│                              click-to-comment                │
│   ⇄ diff      DiffViewer    Monaco side-by-side, "after"     │
│                              editable                        │
│   ▦ dashboard Composed via Stack + Grid + Card + Chart       │
│   ⊞ table     DataTable     sortable, CSV export, inline     │
│                              cell edit                       │
│   ¶ report    Composed long-form mixed content               │
│                                                              │
│  Actions (edit/save/comment) → POST /api/edits → sticky      │
│  overlay → injected on next UserPromptSubmit                 │
└─────────────────────────────────────────────────────────────┘
```

## CLI reference

| Command | What it does |
|---|---|
| `bun run cli install` | Patches `~/.claude/settings.json` (marketplace + plugin enable + statusline + MCP server). Backs up first. |
| `bun run cli uninstall` | Symmetric removal. Backs up first. |
| `bun run cli status` | Daemon liveness + plugin install state + state-dir summary. |
| `bun run cli clean` | Stop daemon, remove `~/.canvas/server.{pid,port,token}`. Sessions dir is kept. |
| `bun run cli help` | Command list. |

## Config

| Env var | Default | Purpose |
|---|---|---|
| `CANVAS_PORT` | `7800` | Daemon preferred port; falls back through `7801..7809` on collision. |
| `CANVAS_SESSION_ID` | _(unset)_ | Override the session id the MCP server pushes to. Useful for testing; in production Claude Code sets `CLAUDE_CODE_SESSION_ID` automatically. |
| `CANVAS_MCP_DEBUG` | _(unset)_ | Set to `1` to write MCP tool-call traces to `/tmp/canvas-mcp-debug.log`. |

State at `~/.canvas/`:

| File | Purpose |
|---|---|
| `server.pid` | Daemon process id |
| `server.port` | Bound port (after fallback) |
| `server.token` | Per-startup 32-byte hex secret (mode `0600`) |
| `server.log` | Daemon stdout/stderr |
| `sessions/<id>/slots/slot_<id>.json` | Per-slot status files (read by statusline) |

## Roadmap

- **v0.3** — SQLite persistence so canvas state survives daemon restarts; per-kind chunk lazy-loading (mermaid + monaco are the bulk of the 2 MB bundle); canvas-history slash command; Windows port (`fs.openSync(path, 'wx')` for atomic spawn, OSC-8 fallback, PowerShell hooks).
- **v0.4** — Excalidraw editor (wire `excalidraw-ai` mermaid converter); `canvas_3d` for react-three-fiber specs; multi-tab session switcher in the canvas header.

## Development

```bash
bun install
bun run typecheck       # tsc --noEmit
bun run build           # build:browser + typecheck
bun run dev:daemon      # bun --watch run src/daemon/server.ts
bun run dev:browser     # vite dev server (port 5174)
```

Daemon at `src/daemon/server.ts`. Browser entry at `src/browser/main.tsx`. MCP server at `src/daemon/mcp-stdio.ts`. CLI at `src/cli/main.ts`.

## License

MIT. Built on [json-render](https://github.com/vercel-labs/json-render) (Apache 2.0).
