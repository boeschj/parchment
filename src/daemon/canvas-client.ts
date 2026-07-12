import { readFileSync, existsSync, mkdirSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { LOG_FILE, PORT_FILE, STATE_DIR, TOKEN_FILE, TOKEN_HEADER } from "./state.ts";
import type {
  JsonRenderSpec,
  Slot,
  SlotKind,
  SlotOps,
  SlotOpsResult,
  SlotOrigin,
} from "../shared/types.ts";

const FETCH_TIMEOUT_MS = 5000;
// Slot ops wait on a browser round-trip (daemon holds them up to 15s).
const BROWSER_ROUNDTRIP_TIMEOUT_MS = 20_000;
const HEALTH_WAIT_ATTEMPTS = 25;
const HEALTH_WAIT_INTERVAL_MS = 200;
const DAEMON_ENTRY = join(import.meta.dir, "server.ts");

export class CanvasDaemonError extends Error {
  public override readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "CanvasDaemonError";
    this.cause = cause;
  }
}

function readPort(): number {
  if (!existsSync(PORT_FILE)) {
    throw new CanvasDaemonError(
      `canvas daemon port file missing at ${PORT_FILE} — is the daemon running?`,
    );
  }
  const raw = readFileSync(PORT_FILE, "utf8").trim();
  const port = Number(raw);
  if (!Number.isFinite(port) || port <= 0) {
    throw new CanvasDaemonError(`canvas daemon port file is not a valid port: "${raw}"`);
  }
  return port;
}

function readToken(): string {
  if (!existsSync(TOKEN_FILE)) {
    throw new CanvasDaemonError(
      `canvas daemon token file missing at ${TOKEN_FILE} — is the daemon running?`,
    );
  }
  const token = readFileSync(TOKEN_FILE, "utf8").trim();
  if (token.length === 0) {
    throw new CanvasDaemonError(`canvas daemon token file is empty`);
  }
  return token;
}

export function canvasBaseUrl(): string {
  return `http://localhost:${readPort()}`;
}

export function canvasSessionUrl(sessionId: string): string {
  return `${canvasBaseUrl()}/?session=${encodeURIComponent(sessionId)}`;
}

async function authorizedFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const url = `${canvasBaseUrl()}${path}`;
  const token = readToken();
  const headers = new Headers(init.headers);
  headers.set(TOKEN_HEADER, token);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, headers, signal: controller.signal });
    return response;
  } catch (caught) {
    throw new CanvasDaemonError(
      `canvas daemon request failed: ${caught instanceof Error ? caught.message : String(caught)}`,
      caught,
    );
  } finally {
    clearTimeout(timer);
  }
}

// Self-heal: any consumer that finds the daemon dead revives it. The daemon
// itself dedupes concurrent spawns (it exits if a live PID already holds the
// state files), so racing heals are harmless.
export async function ensureDaemonAlive(): Promise<void> {
  if (await pingDaemon()) return;
  spawnDaemonProcess();
  await waitForDaemonHealth();
}

function spawnDaemonProcess(): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const logDescriptor = openSync(LOG_FILE, "a");
  const child = spawn("bun", ["run", DAEMON_ENTRY], {
    detached: true,
    stdio: ["ignore", logDescriptor, logDescriptor],
  });
  child.unref();
}

async function waitForDaemonHealth(): Promise<void> {
  for (let attempt = 0; attempt < HEALTH_WAIT_ATTEMPTS; attempt += 1) {
    if (await pingDaemon()) return;
    await Bun.sleep(HEALTH_WAIT_INTERVAL_MS);
  }
  throw new CanvasDaemonError(
    `canvas daemon did not become healthy after respawn — see ${LOG_FILE}`,
  );
}

export type PushSlotInput = {
  sessionId: string;
  cwd?: string;
  kind: SlotKind;
  title: string;
  spec: JsonRenderSpec;
  origin: SlotOrigin;
  slotId?: string;
};

export async function pushSlot(input: PushSlotInput): Promise<Slot> {
  await ensureDaemonAlive();
  const body = {
    kind: input.kind,
    title: input.title,
    spec: input.spec,
    origin: input.origin,
    cwd: input.cwd ?? "",
    ...(input.slotId !== undefined ? { slotId: input.slotId } : {}),
  };
  const response = await authorizedFetch(`/api/sessions/${encodeURIComponent(input.sessionId)}/slots`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new CanvasDaemonError(`pushSlot failed (${response.status}): ${text}`);
  }
  const payload = (await response.json()) as { slot: Slot };
  return payload.slot;
}

export type OpenAppRequest = {
  sessionId: string;
  cwd?: string;
  server: string;
  register?: unknown;
  tool?: string;
  toolArgs?: Record<string, unknown>;
  resource?: string;
  title?: string;
  slotId?: string;
};

export type OpenAppResponse = {
  slot: Slot;
  resourceUri: string;
  summary: string;
};

// Opening an app may spawn + handshake a stdio server and call a tool on it;
// give it more headroom than a plain slot push.
const OPEN_APP_TIMEOUT_MS = 30_000;

export async function openApp(request: OpenAppRequest): Promise<OpenAppResponse> {
  await ensureDaemonAlive();
  const { sessionId, cwd, ...rest } = request;
  const body = { ...rest, cwd: cwd ?? "" };
  const response = await authorizedFetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/apps/open`,
    { method: "POST", body: JSON.stringify(body) },
    OPEN_APP_TIMEOUT_MS,
  );
  if (!response.ok) {
    const text = await response.text();
    throw new CanvasDaemonError(`openApp failed (${response.status}): ${text}`);
  }
  return (await response.json()) as OpenAppResponse;
}

export async function closeSlot(sessionId: string, slotId: string): Promise<void> {
  await ensureDaemonAlive();
  const response = await authorizedFetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/slots/${encodeURIComponent(slotId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new CanvasDaemonError(`closeSlot failed (${response.status}): ${text}`);
  }
}

export async function sendSlotOps(sessionId: string, ops: SlotOps): Promise<SlotOpsResult> {
  await ensureDaemonAlive();
  const response = await authorizedFetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/slots/ops`,
    { method: "POST", body: JSON.stringify({ ops }) },
    BROWSER_ROUNDTRIP_TIMEOUT_MS,
  );
  if (!response.ok) {
    const text = await response.text();
    throw new CanvasDaemonError(`slot ops failed (${response.status}): ${text}`);
  }
  return (await response.json()) as SlotOpsResult;
}

export async function pingDaemon(): Promise<boolean> {
  try {
    const response = await fetch(`${canvasBaseUrl()}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

// Resolve the daemon's "active" session — the one with the highest recent
// heartbeat. The statusline pings ~1Hz so this is the user's current claude
// session with high confidence. Optional cwd filter biases the pick when
// multiple claude sessions are open.
export async function resolveActiveSessionId(cwd?: string): Promise<string | null> {
  try {
    await ensureDaemonAlive();
    const params = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    const response = await fetch(`${canvasBaseUrl()}/api/sessions/active${params}`);
    if (!response.ok) return null;
    const payload = (await response.json()) as { sessionId: string | null };
    return payload.sessionId;
  } catch {
    return null;
  }
}
