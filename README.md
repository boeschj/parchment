# clawd-canvas

> Generative-UI canvas for Claude Code.

Claude has Artifacts, ChatGPT has Canvas, Cursor has plan files. Claude Code dumps walls of green ASCII into a terminal. **clawd-canvas** adds the missing rich-rendering surface — as a lightweight statusline-link addon.

## How it works

- **Claude calls MCP tools** (`canvas_plan`, `canvas_diagram`, `canvas_diff`, `canvas_dashboard`, `canvas_table`, `canvas_report`, `canvas_render`) when it has something richer than terminal text to show.
- **Each tool's `inputSchema` is a Zod-derived JSON Schema** for a json-render spec constrained to a catalog (full shadcn/ui + canvas extensions: PlanFile / DiffViewer / MermaidEditor / Chart / DataTable). Claude can only emit valid specs.
- **The daemon pushes the validated spec to your browser tab** via WebSocket. `@json-render/react` renders it.
- **Edit anything in place** — Tiptap WYSIWYG for plans, Monaco for diffs, source pane + live preview for mermaid, in-line cell edit for tables.
- **Edits flow back into Claude's next turn** via the `UserPromptSubmit` hook — no copy/paste, no `/resume`, no ceremony.
- **Plans auto-render** via `PostToolUse` matcher on `ExitPlanMode` — the one auto-capture we keep.

No `claude -p` subprocess. No transcript tailing. No API billing surprise.

## Install

(Coming during v0.2 build.)

## Status

Pre-alpha rebuild of [clawd-canvas v0.1](https://github.com/jboesch/clawd-canvas). See `STEP-PLAN.md` for the v0.2 sequence.

## License

MIT
