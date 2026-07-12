# Parchment

> The missing visual layer for agentic coding tools like Claude Code.

Claude has Artifacts, ChatGPT has Canvas, Cursor has plan files. Claude Code
prints everything as scrolling terminal text. **Parchment** adds the missing
rich-rendering surface: a browser tab, one statusline click away, where
Claude renders plans, diagrams, diffs, dashboards, and tables — and your
edits flow straight back into its next turn, no copy/paste, no `/resume`.

## What it is

A Bun daemon plus a browser app, installed as a Claude Code plugin. Three
pieces work together:

- An MCP server (registered as `canvas`) exposing `canvas_*` tools Claude
  calls to push UI to your browser tab.
- Hooks that boot the daemon, auto-capture plans the moment they're written
  to disk, and inject your canvas edits back into your next prompt.
- A browser tab, linked from your statusline, rendering everything live over
  a WebSocket connection.

## The surfaces

- **Transcript** — the full session, live: your prompts, Claude's prose as
  rendered markdown, thinking blocks, and every tool call with its input and
  output as collapsible rows. Streams while Claude works.
- **Plan** — the moment Claude writes a plan file (or calls `canvas_plan`),
  it appears here in a Tiptap WYSIWYG editor. Edit it — your changes flow
  back into Claude's next turn. The statusline flips from `◐ canvas` to
  `✎ view plan` so you never miss one.
- **Generative slots** — Claude composes UI on demand via `canvas_*` MCP
  tools (`canvas_diagram`, `canvas_diff`, `canvas_table`, `canvas_render` for
  everything else, plus `canvas_snapshot` / `canvas_patch` for reviewing and
  iterating on what's already rendered, and `canvas_save` / `canvas_load` /
  `canvas_library` for reusable views). Each call is a
  [json-render](https://github.com/vercel-labs/json-render) spec, validated
  against a catalog of 36 shadcn/ui components plus 14 purpose-built
  extensions (Metric, Steps, CodeBlock, Callout, Terminal, FileChange,
  TestResults, Markdown, Scene3D, PlanFile, DiffViewer, MermaidEditor, Chart,
  DataTable). Invalid specs are rejected with an exact issue list instead of
  silently rendering broken UI. The newest push pulls focus — a render IS
  the "look at this" signal.

## Reliability model

The daemon runs until you stop it (`bun run cli clean`, or it's killed) —
there's no idle self-shutdown. Every slot and edit is persisted under
`~/.parchment/sessions/<id>/` the moment it changes, so a crash or restart
loses nothing and the browser tab reconnects on its own. The hooks and the
MCP server both self-heal a dead daemon — you never run a command to bring
it back.

## Prerequisites

- macOS or Linux. Windows: WSL2 works; native support isn't there yet.
- [Bun](https://bun.sh) `≥ 1.3` (`curl -fsSL https://bun.sh/install | bash`)
- `jq` and `curl` (preinstalled on macOS; `apt install jq` on Debian/Ubuntu)
- Claude Code `≥ 2.1.150`

## Install

Two commands inside Claude Code (requires [Bun](https://bun.sh) ≥ 1.3 on
PATH):

```
/plugin marketplace add boeschj/parchment
/plugin install parchment@parchment
```

The first session after install builds the canvas in the background (~1 min
on a cold cache — watch for the `[parchment]` line at startup). The plugin
ships its own MCP server and hooks; every session start prints the canvas
URL.

Optional: for a persistent statusline link (Claude Code doesn't yet let
plugins set `statusLine` themselves), add to your `~/.claude/settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "bash ~/.parchment/statusline.sh"
}
```

`~/.parchment/statusline.sh` is a small launcher the plugin regenerates on
every session start so it always points at your installed version. Use it
rather than a path into `~/.claude/plugins/cache/…/<version>/scripts/…` —
that path is version-stamped and dangles the next time the plugin updates.

The launcher is written the first time a session starts with the plugin
installed. Confirm it before restarting:

```bash
echo '{}' | bash ~/.parchment/statusline.sh
```

That prints `◐ canvas …` (or `◐ canvas: not running` if the daemon is down).
If instead you see `No such file`, start one Claude Code session so the
plugin can generate the launcher, then re-run the check.

<details>
<summary>Dev install (working from a clone)</summary>

```bash
git clone https://github.com/boeschj/parchment
cd parchment
pnpm install
pnpm build           # produces dist/browser/
bun run cli install  # patches ~/.claude/settings.json (backed up first)
```

`bun run cli install` writes four entries to `~/.claude/settings.json`:

1. `extraKnownMarketplaces["parchment"]` — local directory marketplace
2. `enabledPlugins["parchment@parchment"]: true`
3. `statusLine.command` — refuse-and-instruct if you already have one set
4. `mcpServers["canvas"]` — registers the canvas MCP server (gives Claude
   the `canvas_*` tools)

Your prior `settings.json` is backed up to
`~/.claude/settings.json.bak-<timestamp>` first.
</details>

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

Claude calls `canvas_plan`. A `✎ plan` tab appears in the canvas with the
plan rendered in a Tiptap WYSIWYG editor.

**Edit the plan in the canvas** (change wording, add a step, anything).

Back in your terminal, send another message:

```
> Continue with the plan as I've edited it.
```

Claude's response references your edited version. The roundtrip just
worked — no copy/paste, no `/resume`.

### Other things to try

```
> Show me a mermaid sequence diagram of the OAuth login flow,
  render it editable in the canvas.
```
→ `canvas_diagram` slot with side-by-side source + live mermaid render.
Click any node to leave a comment.

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
→ `canvas_render` with `kind: "dashboard"` composing shadcn Card + Heading +
Chart.

### `/plan` mode auto-capture

Enter plan mode (Shift+Tab) and ask Claude for a plan. The moment Claude (or
you) writes the plan file to disk, the `PostToolUse` hook pushes it to the
canvas as a `✎ plan` slot — no MCP call needed, and it updates again on
every revision.

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
│       blocks before the user's message, self-heals a dead   │
│       daemon                                                │
│     - PostToolUse(Write/Edit/ExitPlanMode) → auto-pushes     │
│       plans                                                 │
│   • MCP server `canvas` registered in settings.json:        │
│     - canvas_plan, canvas_diagram, canvas_diff,             │
│       canvas_table, canvas_render (kind: render/dashboard/   │
│       report), canvas_snapshot, canvas_patch, canvas_save,  │
│       canvas_load, canvas_library, canvas_close             │
│   • Statusline: OSC-8 link with per-kind slot glyphs         │
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
│  Sessions: in-memory Map, persisted to ~/.parchment/sessions │
│  Runs until stopped — no idle self-shutdown                 │
│                                                              │
└──────────────────────────┬──────────────────────────────────┘
                           │ WebSocket push
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Browser tab — http://localhost:7800/?session=<id>           │
│                                                              │
│  @json-render/react Renderer + @json-render/shadcn (36        │
│  components) + 14 canvas extensions:                          │
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
| `bun run cli clean` | Stop daemon, remove `~/.parchment/server.{pid,port,token}`. Sessions dir is kept. |
| `bun run cli help` | Command list. |

## Config

| Env var | Default | Purpose |
|---|---|---|
| `CANVAS_PORT` | `7800` | Daemon preferred port; falls back through `7801..7809` on collision. |
| `CANVAS_SESSION_ID` | _(unset)_ | Override the session id the MCP server pushes to. Useful for testing; in production Claude Code sets `CLAUDE_CODE_SESSION_ID` automatically. |
| `CANVAS_MCP_DEBUG` | _(unset)_ | Set to `1` to write MCP tool-call traces to `/tmp/canvas-mcp-debug.log`. |

State at `~/.parchment/`:

| File | Purpose |
|---|---|
| `server.pid` | Daemon process id |
| `server.port` | Bound port (after fallback) |
| `server.token` | Per-startup 32-byte hex secret (mode `0600`) |
| `server.log` | Daemon stdout/stderr |
| `sessions/<id>/slots/<slotId>.json` | Per-slot content (spec + state), read by the statusline for its kind glyphs |
| `sessions/<id>/edits.json` | Pending edits + the sticky overlay |
| `library/<name>.json` | Saved UIs from `canvas_save`, reloaded with `canvas_load` |
| `theme.css` | Optional user theme override (see `themes/custom-theme.example.css`) |

## Development

```bash
pnpm install
pnpm typecheck       # tsc --noEmit
pnpm build           # build:browser + typecheck
pnpm dev:daemon      # bun --watch run src/daemon/server.ts
pnpm dev:browser     # vite dev server
bun test             # runs the daemon test suite (bun's native test runner)
```

Daemon at `src/daemon/server.ts`. Browser entry at `src/browser/main.tsx`.
MCP server at `src/daemon/mcp-stdio.ts`. CLI at `src/cli/main.ts`.

pnpm manages packages (`pnpm@10.23.0`, pinned via `packageManager`); Bun only
runs the TypeScript at runtime — never `bun install`.

## License

MIT. Built on [json-render](https://github.com/vercel-labs/json-render)
(Apache 2.0).
