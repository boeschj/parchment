import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

// src/cli/paths.ts → repo root is two dirs up
const CLI_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(CLI_DIR, "..", "..");

export const STATUSLINE_SCRIPT = join(REPO_ROOT, "scripts", "statusline.sh");
export const MCP_STDIO_ENTRY = join(REPO_ROOT, "src", "daemon", "mcp-stdio.ts");
export const DAEMON_ENTRY = join(REPO_ROOT, "src", "daemon", "server.ts");

export const CLAUDE_DIR = join(homedir(), ".claude");
export const CLAUDE_USER_SETTINGS = join(CLAUDE_DIR, "settings.json");

export const MARKETPLACE_KEY = "clawd-canvas";
export const PLUGIN_ENABLE_KEY = "clawd-canvas@clawd-canvas";
export const MCP_SERVER_KEY = "canvas";
