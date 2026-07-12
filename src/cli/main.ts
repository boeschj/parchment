#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  REPO_ROOT,
  CLAUDE_DIR,
  CLAUDE_USER_SETTINGS,
  STATUSLINE_SCRIPT,
  MCP_STDIO_ENTRY,
  MARKETPLACE_KEY,
  PLUGIN_ENABLE_KEY,
  MCP_SERVER_KEY,
} from "./paths.ts";
import {
  readClaudeSettings,
  writeClaudeSettings,
  backupSettings,
  type ClaudeSettings,
} from "./settings.ts";

const STATE_DIR = join(homedir(), ".parchment");
const PID_FILE = join(STATE_DIR, "server.pid");
const PORT_FILE = join(STATE_DIR, "server.port");
const TOKEN_FILE = join(STATE_DIR, "server.token");

const Color = {
  Reset: "[0m",
  Dim: "[2m",
  Red: "[31m",
  Green: "[32m",
  Yellow: "[33m",
  Cyan: "[36m",
} as const;

function isPlatformSupported(): boolean {
  return process.platform !== "win32";
}

function bail(message: string): never {
  process.stderr.write(`${Color.Red}${message}${Color.Reset}\n`);
  process.exit(1);
}

function info(message: string): void {
  process.stdout.write(`${message}\n`);
}

function muted(message: string): void {
  process.stdout.write(`${Color.Dim}${message}${Color.Reset}\n`);
}

function ok(message: string): void {
  process.stdout.write(`${Color.Green}${message}${Color.Reset}\n`);
}

function warn(message: string): void {
  process.stdout.write(`${Color.Yellow}${message}${Color.Reset}\n`);
}

function isExistingDaemonAlive(): { alive: boolean; pid?: number; port?: string } {
  if (!existsSync(PID_FILE)) return { alive: false };
  const pidRaw = readFileSync(PID_FILE, "utf8").trim();
  const pid = Number(pidRaw);
  if (!Number.isFinite(pid)) return { alive: false };
  try {
    process.kill(pid, 0);
    const port = existsSync(PORT_FILE) ? readFileSync(PORT_FILE, "utf8").trim() : undefined;
    return { alive: true, pid, ...(port !== undefined ? { port } : {}) };
  } catch {
    return { alive: false };
  }
}

function cmdInstall(): number {
  if (!isPlatformSupported()) {
    bail(
      "parchment: Windows is not supported yet. WSL2 works. Roadmap: https://github.com/boeschj/parchment",
    );
  }

  if (!existsSync(STATUSLINE_SCRIPT)) {
    bail(`parchment: expected statusline at ${STATUSLINE_SCRIPT}`);
  }
  if (!existsSync(MCP_STDIO_ENTRY)) {
    bail(`parchment: expected MCP server at ${MCP_STDIO_ENTRY}`);
  }

  mkdirSync(CLAUDE_DIR, { recursive: true });

  let settings: ClaudeSettings;
  try {
    settings = readClaudeSettings();
  } catch (caught) {
    bail(caught instanceof Error ? caught.message : String(caught));
  }

  // Refuse-and-instruct policy for an existing foreign statusLine.command.
  const desiredStatusCommand = `bash ${STATUSLINE_SCRIPT}`;
  const existingStatusCommand = settings.statusLine?.command;
  const hasForeignStatusLine =
    typeof existingStatusCommand === "string" &&
    existingStatusCommand.length > 0 &&
    !existingStatusCommand.includes(STATUSLINE_SCRIPT);

  if (hasForeignStatusLine) {
    warn("parchment: refusing to overwrite your existing statusLine.command.");
    info("");
    info(`  Your current statusLine.command:`);
    muted(`    ${existingStatusCommand}`);
    info("");
    info(`  parchment needs this in your statusline:`);
    process.stdout.write(`    ${Color.Cyan}${desiredStatusCommand}${Color.Reset}\n`);
    info("");
    info("  Pick one:");
    info("    a) Replace your current statusLine.command in ~/.claude/settings.json");
    info("    b) Chain both in a single shell line:");
    process.stdout.write(
      `       ${Color.Cyan}bash -c '${existingStatusCommand} ; ${desiredStatusCommand}'${Color.Reset}\n`,
    );
    info("");
    info("  Then re-run `bun run cli install` to wire the marketplace, plugin, and MCP server.");
    return 1;
  }

  if (existsSync(CLAUDE_USER_SETTINGS)) {
    const backup = backupSettings();
    if (backup) muted(`backed up settings → ${backup}`);
  }

  // 1. Marketplace pointing at the repo source dir
  settings.extraKnownMarketplaces = {
    ...(settings.extraKnownMarketplaces ?? {}),
    [MARKETPLACE_KEY]: { source: { source: "directory", path: REPO_ROOT } },
  };
  // 2. Plugin enable flag
  settings.enabledPlugins = {
    ...(settings.enabledPlugins ?? {}),
    [PLUGIN_ENABLE_KEY]: true,
  };
  // 3. Statusline
  settings.statusLine = { type: "command", command: desiredStatusCommand };
  // 4. MCP server registration (Claude Code reads mcpServers from settings.json
  //    at session start and spawns each server via stdio)
  settings.mcpServers = {
    ...(settings.mcpServers ?? {}),
    [MCP_SERVER_KEY]: {
      command: "bun",
      args: ["run", MCP_STDIO_ENTRY],
    },
  };

  writeClaudeSettings(settings);

  ok("installed parchment at user scope");
  muted(`  repo: ${REPO_ROOT}`);
  muted(`  statusline: ${STATUSLINE_SCRIPT}`);
  muted(`  mcp server: bun run ${MCP_STDIO_ENTRY}`);
  info("");
  info("Try it now:");
  info("  1. Open a NEW terminal (so settings.json reloads)");
  info("  2. Run: claude");
  info("  3. Cmd/Ctrl-click the ◐ canvas URL in your statusline");
  info('  4. Ask Claude something like: "Render a quick plan for adding rate limiting"');
  info("");
  info(`Need to undo? bun run cli uninstall`);
  return 0;
}

function cmdUninstall(): number {
  if (!existsSync(CLAUDE_USER_SETTINGS)) {
    info("no user settings file — nothing to uninstall");
    return 0;
  }
  const backup = backupSettings();
  if (backup) muted(`backed up settings → ${backup}`);

  const settings = readClaudeSettings();
  if (settings.extraKnownMarketplaces) {
    delete settings.extraKnownMarketplaces[MARKETPLACE_KEY];
  }
  if (settings.enabledPlugins) {
    delete settings.enabledPlugins[PLUGIN_ENABLE_KEY];
  }
  if (settings.mcpServers) {
    delete settings.mcpServers[MCP_SERVER_KEY];
  }
  if (
    settings.statusLine?.command &&
    settings.statusLine.command.includes(STATUSLINE_SCRIPT)
  ) {
    delete settings.statusLine;
  }

  writeClaudeSettings(settings);
  ok("uninstalled parchment from user scope");
  info("Restart Claude Code to drop the plugin + statusline + MCP server.");
  return 0;
}

function cmdStatus(): number {
  const liveness = isExistingDaemonAlive();
  if (liveness.alive) {
    ok(`daemon alive (pid ${liveness.pid}${liveness.port ? `, port ${liveness.port}` : ""})`);
  } else {
    warn("daemon not running");
  }
  if (existsSync(CLAUDE_USER_SETTINGS)) {
    const settings = readClaudeSettings();
    const installed =
      settings.enabledPlugins?.[PLUGIN_ENABLE_KEY] === true &&
      typeof settings.statusLine?.command === "string" &&
      settings.statusLine.command.includes(STATUSLINE_SCRIPT) &&
      settings.mcpServers?.[MCP_SERVER_KEY] !== undefined;
    if (installed) {
      ok("plugin installed (marketplace + enable + statusline + mcp server)");
    } else {
      warn("plugin not fully installed — run `bun run cli install`");
    }
  } else {
    warn(`no ${CLAUDE_USER_SETTINGS}`);
  }
  if (existsSync(STATE_DIR)) {
    const sessions = readdirSync(join(STATE_DIR, "sessions"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    muted(`state dir: ${STATE_DIR} (sessions: ${sessions.length})`);
  }
  return liveness.alive ? 0 : 1;
}

function cmdClean(): number {
  const liveness = isExistingDaemonAlive();
  if (liveness.alive && liveness.pid) {
    try {
      process.kill(liveness.pid, "SIGTERM");
      muted(`signaled daemon (pid ${liveness.pid})`);
    } catch {
      // process gone already
    }
  }
  for (const path of [PID_FILE, PORT_FILE, TOKEN_FILE]) {
    if (existsSync(path)) {
      try {
        const { unlinkSync } = require("node:fs") as typeof import("node:fs");
        unlinkSync(path);
      } catch {
        // best-effort
      }
    }
  }
  ok("cleaned ~/.parchment/ state files (sessions/ kept; rm -rf manually if desired)");
  return 0;
}

function cmdHelp(): number {
  info("parchment v0.1.0");
  info("");
  info("Usage: bun run cli <command>");
  info("");
  info("Commands:");
  info("  install     Register the plugin, statusline, and MCP server in ~/.claude/settings.json");
  info("  uninstall   Symmetric removal (backs up settings first)");
  info("  status      Show daemon liveness + plugin install state");
  info("  clean       Stop the daemon and remove state files");
  info("  help        This message");
  info("");
  info("Files:");
  info(`  REPO_ROOT:    ${REPO_ROOT}`);
  info(`  STATUSLINE:   ${STATUSLINE_SCRIPT}`);
  info(`  MCP_ENTRY:    ${MCP_STDIO_ENTRY}`);
  info(`  SETTINGS:     ${CLAUDE_USER_SETTINGS}`);
  return 0;
}

const command = process.argv[2] ?? "help";
let exitCode: number;
switch (command) {
  case "install":
    exitCode = cmdInstall();
    break;
  case "uninstall":
    exitCode = cmdUninstall();
    break;
  case "status":
    exitCode = cmdStatus();
    break;
  case "clean":
    exitCode = cmdClean();
    break;
  case "help":
  case "--help":
  case "-h":
    exitCode = cmdHelp();
    break;
  default:
    bail(`unknown command: ${command}\nRun \`bun run cli help\` for usage.`);
}
process.exit(exitCode);
