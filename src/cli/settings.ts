import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { CLAUDE_USER_SETTINGS } from "./paths.ts";

export type ClaudeSettings = {
  statusLine?: { type?: string; command?: string };
  extraKnownMarketplaces?: Record<string, unknown>;
  enabledPlugins?: Record<string, boolean>;
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
};

export function readClaudeSettings(): ClaudeSettings {
  if (!existsSync(CLAUDE_USER_SETTINGS)) return {};
  const raw = readFileSync(CLAUDE_USER_SETTINGS, "utf8");
  if (raw.trim().length === 0) return {};
  try {
    return JSON.parse(raw) as ClaudeSettings;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    throw new Error(
      `Failed to parse ${CLAUDE_USER_SETTINGS}: ${message}\nFix the JSON manually then re-run install.`,
    );
  }
}

export function writeClaudeSettings(settings: ClaudeSettings): void {
  const serialized = JSON.stringify(settings, null, 2) + "\n";
  writeFileSync(CLAUDE_USER_SETTINGS, serialized);
}

export function backupSettings(): string | null {
  if (!existsSync(CLAUDE_USER_SETTINGS)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${CLAUDE_USER_SETTINGS}.bak-${stamp}`;
  copyFileSync(CLAUDE_USER_SETTINGS, backup);
  return backup;
}
