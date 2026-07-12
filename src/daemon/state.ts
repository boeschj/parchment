import { homedir } from "node:os";
import { join } from "node:path";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  unlinkSync,
  chmodSync,
} from "node:fs";
import { randomBytes } from "node:crypto";

export const STATE_DIR = join(homedir(), ".parchment");
export const PID_FILE = join(STATE_DIR, "server.pid");
export const PORT_FILE = join(STATE_DIR, "server.port");
export const TOKEN_FILE = join(STATE_DIR, "server.token");
export const LOG_FILE = join(STATE_DIR, "server.log");
export const SESSIONS_DIR = join(STATE_DIR, "sessions");
// Written once at startup; its mtime marks when this daemon booted. SessionStart
// compares the on-disk runtime code against it and replaces the daemon when the
// code is newer, so a plugin update or rebuild is adopted on the next session
// with no manual restart.
export const BUILD_FILE = join(STATE_DIR, "server.build");

const TOKEN_BYTES = 32;
const TOKEN_FILE_MODE = 0o600;

export const TOKEN_HEADER = "x-canvas-token";

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export function writeServerStateFiles(boundPort: number, token: string): void {
  mkdirSync(STATE_DIR, { recursive: true });
  mkdirSync(SESSIONS_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(process.pid));
  writeFileSync(PORT_FILE, String(boundPort));
  writeFileSync(TOKEN_FILE, token, { mode: TOKEN_FILE_MODE });
  chmodSync(TOKEN_FILE, TOKEN_FILE_MODE);
  // mtime = now = this daemon's boot time; the content is for humans reading the file.
  writeFileSync(BUILD_FILE, `${new Date().toISOString()} pid=${process.pid} port=${boundPort}\n`);
}

// Only the process that owns the PID file may clear state — a dying loser
// of a spawn race must never delete the winner's files.
export function clearServerStateFilesIfOwned(): void {
  if (!existsSync(PID_FILE)) return;
  const recordedPid = readFileSync(PID_FILE, "utf8").trim();
  if (recordedPid !== String(process.pid)) return;
  unlinkSync(PID_FILE);
  if (existsSync(PORT_FILE)) unlinkSync(PORT_FILE);
  if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE);
  if (existsSync(BUILD_FILE)) unlinkSync(BUILD_FILE);
}

const HEALTH_PROBE_TIMEOUT_MS = 750;

// "A daemon exists" means it answers /api/health — a PID check alone is
// wrong twice over: stale PID files get recycled to unrelated processes
// (bricking startup forever), and a live-but-wedged daemon shouldn't block
// a replacement.
export async function isCanvasDaemonAt(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { ok?: boolean };
    return payload.ok === true;
  } catch {
    return false;
  }
}

export async function isExistingDaemonHealthy(): Promise<boolean> {
  if (!existsSync(PORT_FILE)) return false;
  const port = Number(readFileSync(PORT_FILE, "utf8").trim());
  if (!Number.isFinite(port) || port <= 0) return false;
  return isCanvasDaemonAt(port);
}

export function sessionSlotDir(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "_");
  return join(SESSIONS_DIR, safe, "slots");
}
