// The --mcp-config the driver points `claude -p` at, and the env the eval's
// canvas MCP server reads back out of it.
//
// The server key stays "canvas" and the tool stays "canvas_render", so the model
// sees `mcp__canvas__canvas_render` — the same tool name the real product
// exposes. An arm that had to learn a different tool name would be answering a
// different question than the one we are asking.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DAEMON_PORT } from "../config.ts";
import type { ArmId } from "../types.ts";

const mcpDir = dirname(fileURLToPath(import.meta.url));

export const EVAL_CANVAS_SERVER_ENTRY = join(mcpDir, "canvas-server.ts");

// Claude Code exposes an MCP tool as `mcp__<serverKey>__<toolName>`.
export const CANVAS_MCP_SERVER_KEY = "canvas";
export const CANVAS_RENDER_TOOL_NAME = "canvas_render";
export const CANVAS_RENDER_TOOL = `mcp__${CANVAS_MCP_SERVER_KEY}__${CANVAS_RENDER_TOOL_NAME}`;

// The env the server is configured through. The arm id is passed because the
// server must know which AUTHORING vocabulary and notation the document arrives
// in (scrambled aliases? terse structural keys?) — it cannot infer that from the
// bytes without guessing, and a guess here would silently mis-decode an arm.
export const EvalMcpEnv = {
  SessionId: "CANVAS_SESSION_ID",
  ArmId: "EVAL_ARM_ID",
} as const;

const PARCHMENT_STATE_DIRNAME = ".parchment";
const PORT_FILENAME = "server.port";
const TOKEN_FILENAME = "server.token";

export type WriteEvalMcpConfigOptions = {
  // Where this attempt's generated config file is written.
  runDir: string;
  // Pins the canvas session so every render from this attempt lands in a session
  // the harness can find, with no dependence on statusline heartbeats that a
  // headless run never sends.
  sessionId: string;
  armId: ArmId;
  // The eval daemon's scratch HOME. The server resolves ~/.parchment from it, so
  // it can never reach the operator's real daemon state.
  daemonHomeDir: string;
};

export function writeEvalCanvasMcpConfig(options: WriteEvalMcpConfigOptions): string {
  mkdirSync(options.runDir, { recursive: true });
  const configPath = join(options.runDir, "mcp-config.json");

  const config = {
    mcpServers: {
      [CANVAS_MCP_SERVER_KEY]: {
        command: "bun",
        args: ["run", EVAL_CANVAS_SERVER_ENTRY],
        env: {
          HOME: options.daemonHomeDir,
          [EvalMcpEnv.SessionId]: options.sessionId,
          [EvalMcpEnv.ArmId]: options.armId,
        },
      },
    },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

export type DaemonEndpoint = { baseUrl: string; token: string };

// The daemon writes its port and token into ~/.parchment at boot. With HOME
// pointed at the eval's scratch dir, this reads THAT daemon and no other.
export function readEvalDaemonEndpoint(homeDir: string): DaemonEndpoint {
  const stateDir = join(homeDir, PARCHMENT_STATE_DIRNAME);

  const token = readFileSync(join(stateDir, TOKEN_FILENAME), "utf8").trim();
  const port = readPort(join(stateDir, PORT_FILENAME));

  return { baseUrl: `http://127.0.0.1:${port}`, token };
}

function readPort(portFile: string): number {
  const raw = readFileSync(portFile, "utf8").trim();
  const port = Number(raw);
  if (!Number.isFinite(port) || port <= 0) return DAEMON_PORT;
  return port;
}
