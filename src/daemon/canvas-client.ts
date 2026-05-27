import { readFileSync, existsSync } from "node:fs";
import { PORT_FILE, TOKEN_FILE, TOKEN_HEADER } from "./state.ts";
import type { JsonRenderSpec, Slot, SlotKind, SlotOrigin } from "../shared/types.ts";

const FETCH_TIMEOUT_MS = 5000;

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

async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${canvasBaseUrl()}${path}`;
  const token = readToken();
  const headers = new Headers(init.headers);
  headers.set(TOKEN_HEADER, token);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
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

export async function closeSlot(sessionId: string, slotId: string): Promise<void> {
  const response = await authorizedFetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/slots/${encodeURIComponent(slotId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new CanvasDaemonError(`closeSlot failed (${response.status}): ${text}`);
  }
}

export async function pingDaemon(): Promise<boolean> {
  try {
    const response = await fetch(`${canvasBaseUrl()}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}
