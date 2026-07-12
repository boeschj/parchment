// Builds the --mcp-config file the parchment arm points `claude -p` at. Each
// run gets its own file because each run needs a different CANVAS_SESSION_ID
// baked into the canvas MCP server's env (see below) — the file is cheap to
// regenerate and keeping one per run makes each run's exact configuration
// inspectable after the fact.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CANVAS_MCP_SERVER_KEY, MCP_STDIO_ENTRY } from "./config.ts";

export type WriteCanvasMcpConfigOptions = {
  runDir: string;
  sessionId: string;
  benchDaemonHomeDir: string;
};

// The canvas MCP tool resolves its target session via CANVAS_SESSION_ID (see
// src/daemon/mcp-stdio.ts's resolveSessionId) before falling back to a
// heartbeat-based guess. Pinning it here makes slot delivery deterministic:
// every tool call in this run lands on exactly the session id this run
// generated, with no dependency on statusline heartbeats headless runs never
// send. HOME is overridden so the MCP server resolves ~/.parchment to this
// run's isolated bench daemon (see daemon-harness.ts) instead of a
// developer's real one.
export function writeCanvasMcpConfig({
  runDir,
  sessionId,
  benchDaemonHomeDir,
}: WriteCanvasMcpConfigOptions): string {
  mkdirSync(runDir, { recursive: true });
  const configPath = join(runDir, "mcp-config.json");
  const config = {
    mcpServers: {
      [CANVAS_MCP_SERVER_KEY]: {
        command: "bun",
        args: ["run", MCP_STDIO_ENTRY],
        env: {
          HOME: benchDaemonHomeDir,
          CANVAS_SESSION_ID: sessionId,
        },
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}
