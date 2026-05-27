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

export const STATE_DIR = join(homedir(), ".canvas");
export const PID_FILE = join(STATE_DIR, "server.pid");
export const PORT_FILE = join(STATE_DIR, "server.port");
export const TOKEN_FILE = join(STATE_DIR, "server.token");
export const LOG_FILE = join(STATE_DIR, "server.log");
export const SESSIONS_DIR = join(STATE_DIR, "sessions");

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
}

export function clearServerStateFiles(): void {
  if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  if (existsSync(PORT_FILE)) unlinkSync(PORT_FILE);
  if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE);
}

export function isExistingServerAlive(): boolean {
  if (!existsSync(PID_FILE)) return false;
  const pid = Number(readFileSync(PID_FILE, "utf8").trim());
  if (!Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function sessionSlotDir(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, "_");
  return join(SESSIONS_DIR, safe, "slots");
}
