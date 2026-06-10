# clawd-canvas v0.3

> A shared workspace for you and Claude Code. Live session transcript, an instantly-appearing plan editor, a collaborative Excalidraw board, and generative UI Claude composes on demand — one statusline click away.

Claude has Artifacts, ChatGPT has Canvas, Cursor has plan files. Claude Code dumps walls of green ASCII into a terminal. **clawd-canvas** adds the missing rich-rendering surface — as a lightweight statusline-link addon.

## The surfaces

The left rail has three fixed tabs, then whatever Claude generates:

- **Transcript** — the full session, live: your prompts, Claude's prose as rendered markdown, thinking blocks, and every tool call with its input and output as collapsible rows. Streams while Claude works.
- **Plan** — the moment Claude exits plan mode (or calls `canvas_plan`), the plan appears here in a Tiptap WYSIWYG editor. Your edits flow back into Claude's next turn. The statusline flips from `◐ canvas` to `✎ view plan` so you never miss one.
- **Board** — one persistent Excalidraw scene per session, stored as a real `.excalidraw` file. You draw with the full Excalidraw UI; Claude draws through `board_*` MCP tools (incremental element edits, mermaid cold-starts) and can look at the board via PNG export. Both of you see every change live.
- **Generative slots** — Claude pushes composed UI (dashboards, reports, diffs, tables, diagrams) via `canvas_*` MCP tools. Each tool's `inputSchema` is a Zod-derived JSON Schema for a [json-render](https://github.com/vercel-labs/json-render) spec, validated against a 41-component catalog (36 shadcn/ui + 5 canvas extensions). The newest push pulls focus — a render IS the "look at this" signal.

## Reliability model

The daemon never idles itself out. Every slot, edit, and board scene is persisted under `~/.canvas/sessions/` the moment it changes, and sessions hydrate from disk on access — a crash or restart loses nothing. Every consumer self-heals a dead daemon: the hooks respawn it, and so does any MCP tool call.

## Prerequisites

- macOS or Linux. Windows is on the v0.3 roadmap (uses POSIX-only primitives today).
- [Bun](https://bun.sh) `≥ 1.3` (`curl -fsSL https://bun.sh/install | bash`)
- `jq` and `curl` (preinstalled on macOS; `apt install jq` on Debian/Ubuntu)
- Claude Code `≥ 2.1.150`

## Install

```bash
git clone https://github.com/jboesch/clawd-canvas-v2
cd clawd-canvas-v2
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

## How it works

```
┌────────────────────────────────────────────────────────────┐
│  Claude Code session                                        │
│                                                             │
│  Plugin (this repo):                                        │
│   • Skills: canvas-tools, canvas-extensions + core/react/   │
│     shadcn (copied from json-render) — teaches Claude WHEN  │
│     and HOW to use the canvas tools                         │
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

MIT. Bundles json-render skills under Apache 2.0 (see `skills/{core,react,shadcn}/SKILL.md`).
