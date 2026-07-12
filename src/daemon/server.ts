import { serve } from "bun";
import { basename } from "node:path";
import { EditKind, SessionStatus, SlotKind, SlotOrigin, SlotStatus } from "../shared/types.ts";
import {
  generateToken,
  writeServerStateFiles,
  clearServerStateFilesIfOwned,
  isCanvasDaemonAt,
  isExistingDaemonHealthy,
} from "./state.ts";
import { guardRequest, jsonResponse, errorResponse, ErrorCode, HttpStatus } from "./security.ts";
import {
  ensureSession,
  activateSession,
  pingSession,
  pingKnownSession,
  getSession,
  listSessions,
  setSessionStatus,
  broadcast,
  sessionSnapshot,
  resolveSessionByShortAlias,
  type SessionRoom,
  type WebSocketAttachment,
  type WebSocketSubscriber,
} from "./sessions.ts";
import { upsertSlot, removeSlot, markSlotError, requestSlotOps, resolveSlotOps } from "./slots.ts";
import { clearPersistedSlots } from "./session-store.ts";
import { registerTranscriptPath, readTranscriptBacklog, firstHumanPrompt } from "./transcript.ts";
import type { SlotOps, SlotOpsResult } from "../shared/types.ts";
import {
  recordEdit,
  buildInjectionPayload,
  consumeOneShotEdits,
  renderInjectionMarkup,
  clearOverlay,
} from "./edits.ts";
import {
  listSessionLiveSources,
  rehydratePersistedLiveSources,
  setSlotLiveSources,
  stopAllLiveSources,
  stopSessionLiveSources,
} from "./live/engine.ts";
import {
  LiveSourceInputSchema,
  normalizeLiveSource,
  type LiveSourceConfig,
} from "./live/types.ts";
import { serveStatic, serveUserTheme } from "./static.ts";

const DEFAULT_PORT = Number(process.env.CANVAS_PORT ?? 7800);
const MAX_PORT_ATTEMPTS = 10;
// Slot ops hold a request open up to 15s waiting on a browser round-trip;
// Bun's default idleTimeout (10s) would kill them mid-wait.
const REQUEST_IDLE_TIMEOUT_S = 30;

// The daemon runs until explicitly stopped (cli clean, SIGTERM). Idle
// shutdown was removed in v0.3: a canvas that kills itself between glances
// is worse than a few MB of resident memory, and every consumer (hooks,
// MCP, browser) had to carry respawn logic to compensate.

if (await isExistingDaemonHealthy()) {
  console.error("clawd-canvas: daemon already running; exiting.");
  process.exit(0);
}

const SERVER_TOKEN = generateToken();
const SERVER_STARTED_AT = new Date().toISOString();

type CanvasServer = ReturnType<typeof serve<WebSocketAttachment>>;

async function handleFetch(
  request: Request,
  srv: CanvasServer,
): Promise<Response | undefined> {
  const guard = guardRequest(request, SERVER_TOKEN);
  if (!guard.allowed) return guard.response;

  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/ws") {
    const sessionId = url.searchParams.get("session") ?? "default";
    pingSession(sessionId);
    const upgraded = srv.upgrade(request, { data: { sessionId } });
    if (upgraded) return;
    return errorResponse(
      HttpStatus.BadRequest,
      ErrorCode.UpgradeFailed,
      "WebSocket upgrade failed",
    );
  }

  if (path === "/api/bootstrap") {
    return jsonResponse({ token: SERVER_TOKEN });
  }

  if (path === "/api/health") {
    return jsonResponse({
      ok: true,
      port: srv.port,
      sessions: listSessions().length,
      startedAt: SERVER_STARTED_AT,
    });
  }

  if (path === "/api/heartbeat") {
    const sessionId = url.searchParams.get("session");
    if (!sessionId) return jsonResponse({ ok: true });
    const session = pingKnownSession(sessionId);
    return jsonResponse({ ok: true, lastPing: session?.lastPing ?? null });
  }

  if (path === "/api/sessions") {
    return jsonResponse({
      sessions: listSessions().map((session) => ({
        sessionId: session.sessionId,
        cwd: session.cwd,
        name: sessionName(session),
        summary: sessionSummary(session),
        slotCount: session.slots.length,
        createdAt: session.createdAt,
        lastPing: session.lastPing,
        status: session.status,
      })),
    });
  }

  // /api/sessions/active returns the session with the highest recent heartbeat.
  // The statusline pings ~1Hz so this is the "active claude session" with high
  // confidence. Optional ?cwd=... filter biases the pick to the session whose
  // hook stdin reported a matching working directory — useful when multiple
  // claude sessions are open simultaneously.
  if (path === "/api/sessions/active") {
    const filterCwd = url.searchParams.get("cwd");
    const sessions = listSessions().filter((session) => session.sessionId !== "default");
    const candidates = filterCwd
      ? sessions.filter((session) => session.cwd === filterCwd)
      : sessions;
    const pool = candidates.length > 0 ? candidates : sessions;
    if (pool.length === 0) {
      return jsonResponse({ sessionId: null });
    }
    const active = pool.reduce((best, current) =>
      current.lastPing > best.lastPing ? current : best,
    );
    return jsonResponse({
      sessionId: active.sessionId,
      cwd: active.cwd,
      lastPing: active.lastPing,
    });
  }

  const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)(\/.*)?$/);
  if (sessionMatch) {
    const sessionId = decodeURIComponent(sessionMatch[1]!);
    const subPath = sessionMatch[2] ?? "";
    pingSession(sessionId);
    return handleSessionRoute(request, sessionId, subPath);
  }

  // Short-alias redirect: /s/<prefix> → /?session=<full-id>
  const shortMatch = path.match(/^\/s\/([^/]+)\/?$/);
  if (shortMatch) {
    const prefix = decodeURIComponent(shortMatch[1]!).toLowerCase();
    const resolved = resolveSessionByShortAlias(prefix);
    const target = resolved
      ? `/?session=${encodeURIComponent(resolved)}`
      : `/?session=${encodeURIComponent(prefix)}`;
    return new Response(null, { status: 302, headers: { location: target } });
  }

  // User theme override, served from ~/.parchment/theme.css (empty if absent).
  if (path === "/theme.css") {
    return serveUserTheme();
  }

  if (path === "/" || path.startsWith("/assets/") || path.startsWith("/ui/")) {
    return serveStatic(
      path === "/" ? "" : path.startsWith("/ui/") ? path.replace(/^\/ui\/?/, "") : path,
    );
  }

  // SPA fallback for any other non-API path
  if (!path.startsWith("/api")) {
    return serveStatic("");
  }

  return errorResponse(HttpStatus.NotFound, ErrorCode.NotFound, "route not found");
}

async function handleSessionRoute(
  request: Request,
  sessionId: string,
  subPath: string,
): Promise<Response> {
  const method = request.method;

  if (subPath === "" || subPath === "/state") {
    if (method !== "GET") {
      return errorResponse(
        HttpStatus.MethodNotAllowed,
        ErrorCode.MethodNotAllowed,
        `method ${method} not allowed on ${subPath}`,
      );
    }
    const session = ensureSession(sessionId);
    return jsonResponse(sessionSnapshot(session));
  }

  // SessionStart calls this so the daemon knows the foreground session id and
  // its cwd the instant a session begins — the fix that makes /clear route new
  // artifacts to the new session instead of the one it replaced.
  if (subPath === "/activate" && method === "POST") {
    const body = (await request.json()) as { cwd?: string };
    const session = activateSession(sessionId, body.cwd ?? "");
    return jsonResponse({ ok: true, sessionId: session.sessionId, cwd: session.cwd });
  }

  if (subPath === "/slots" && method === "POST") {
    const body = (await request.json()) as {
      kind: string;
      title: string;
      spec: unknown;
      origin?: string;
      slotId?: string;
      status?: string;
      state?: Record<string, unknown>;
      cwd?: string;
    };
    if (!isSlotKind(body.kind)) {
      return errorResponse(
        HttpStatus.BadRequest,
        ErrorCode.BadRequest,
        `unknown slot kind: ${body.kind}`,
      );
    }
    const spec = body.spec as { root: string; elements: Record<string, unknown> };
    if (!spec || typeof spec !== "object" || !spec.root || !spec.elements) {
      return errorResponse(
        HttpStatus.BadRequest,
        ErrorCode.BadRequest,
        "spec must be { root, elements }",
      );
    }
    const origin = isSlotOrigin(body.origin) ? body.origin : SlotOrigin.McpTool;
    const status = isSlotStatus(body.status) ? body.status : SlotStatus.Ready;
    const slot = upsertSlot({
      sessionId,
      cwd: body.cwd ?? "",
      kind: body.kind,
      title: body.title,
      spec: spec as never,
      origin,
      ...(body.slotId !== undefined ? { slotId: body.slotId } : {}),
      status,
      ...(body.state !== undefined ? { state: body.state } : {}),
    });
    return jsonResponse({ ok: true, slot });
  }

  if (subPath === "/slots/ops" && method === "POST") {
    const body = (await request.json()) as { ops?: SlotOps };
    if (!body.ops) {
      return errorResponse(HttpStatus.BadRequest, ErrorCode.BadRequest, "ops required");
    }
    const session = ensureSession(sessionId);
    const canvasUrl = sessionCanvasUrl(request, sessionId);
    const result = await requestSlotOps(session, body.ops, canvasUrl);
    return jsonResponse(result);
  }

  if (subPath === "/slots/ops-result" && method === "POST") {
    const body = (await request.json()) as { requestId?: string; result?: SlotOpsResult };
    if (typeof body.requestId !== "string" || !body.result) {
      return errorResponse(HttpStatus.BadRequest, ErrorCode.BadRequest, "requestId and result required");
    }
    const resolved = resolveSlotOps(body.requestId, body.result);
    return jsonResponse({ ok: resolved });
  }

  const slotMatch = subPath.match(/^\/slots\/([^/]+)$/);
  if (slotMatch) {
    const slotId = decodeURIComponent(slotMatch[1]!);
    if (method === "DELETE") {
      const removed = removeSlot(sessionId, slotId);
      return removed
        ? jsonResponse({ ok: true })
        : errorResponse(HttpStatus.NotFound, ErrorCode.NotFound, "slot not found");
    }
    if (method === "PATCH") {
      const body = (await request.json()) as { error?: string };
      if (typeof body.error === "string") {
        const slot = markSlotError(sessionId, slotId, body.error);
        if (!slot) return errorResponse(HttpStatus.NotFound, ErrorCode.NotFound, "slot not found");
        return jsonResponse({ ok: true, slot });
      }
      return errorResponse(HttpStatus.BadRequest, ErrorCode.BadRequest, "no patch body");
    }
  }

  if (subPath === "/edits" && method === "POST") {
    const body = (await request.json()) as {
      slotId: string;
      elementId?: string | null;
      kind: string;
      payload: Record<string, unknown>;
    };
    if (!isEditKind(body.kind)) {
      return errorResponse(
        HttpStatus.BadRequest,
        ErrorCode.BadRequest,
        `unknown edit kind: ${body.kind}`,
      );
    }
    const edit = recordEdit({
      sessionId,
      slotId: body.slotId,
      elementId: body.elementId ?? null,
      kind: body.kind,
      payload: body.payload,
    });
    return jsonResponse({ ok: true, edit });
  }

  if (subPath === "/edits" && method === "GET") {
    const payload = buildInjectionPayload(sessionId);
    const format = new URL(request.url).searchParams.get("format");
    if (format === "injection") {
      consumeOneShotEdits(sessionId);
      return new Response(renderInjectionMarkup(payload), {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return jsonResponse(payload);
  }

  if (subPath === "/status" && method === "POST") {
    const { status } = await request.json();
    if (!isSessionStatus(status)) {
      return errorResponse(
        HttpStatus.BadRequest,
        ErrorCode.BadRequest,
        `unknown session status: ${status}`,
      );
    }
    const session = setSessionStatus(sessionId, status);
    return jsonResponse({ ok: true, status: session.status });
  }

  if (subPath === "/transcript" && method === "POST") {
    const body = (await request.json()) as { path?: string };
    if (typeof body.path !== "string" || body.path.length === 0) {
      return errorResponse(HttpStatus.BadRequest, ErrorCode.BadRequest, "path required");
    }
    registerTranscriptPath(sessionId, body.path);
    return jsonResponse({ ok: true });
  }

  // Live data sources are set wholesale per slot: PUT the full desired set
  // (an empty array stops streaming). One canvas_render + one PUT here is a
  // complete live dashboard — updates then flow with zero further calls.
  if (subPath === "/live" && method === "GET") {
    return jsonResponse({ sources: listSessionLiveSources(sessionId) });
  }

  if (subPath === "/live" && method === "PUT") {
    const body = (await request.json()) as { slotId?: string; sources?: unknown[] };
    if (typeof body.slotId !== "string" || !Array.isArray(body.sources)) {
      return errorResponse(HttpStatus.BadRequest, ErrorCode.BadRequest, "slotId and sources[] required");
    }
    const session = ensureSession(sessionId);
    const slotExists = session.slots.some((slot) => slot.id === body.slotId);
    if (!slotExists) {
      return errorResponse(HttpStatus.NotFound, ErrorCode.NotFound, `slot ${body.slotId} not found`);
    }
    const validated = validateLiveSources(body.sources);
    if (!validated.ok) {
      return errorResponse(HttpStatus.BadRequest, ErrorCode.BadRequest, validated.error);
    }
    setSlotLiveSources(sessionId, body.slotId, validated.configs);
    return jsonResponse({ ok: true, sourceIds: validated.configs.map((config) => config.id) });
  }

  if (subPath === "/reset" && method === "POST") {
    const session = ensureSession(sessionId);
    stopSessionLiveSources(sessionId);
    session.slots = [];
    clearOverlay(sessionId);
    clearPersistedSlots(sessionId);
    broadcast(session, { kind: "reset", data: { sessionId } });
    return jsonResponse({ ok: true });
  }

  return errorResponse(HttpStatus.NotFound, ErrorCode.NotFound, "route not found");
}

type ValidatedLiveSources =
  | { ok: true; configs: LiveSourceConfig[] }
  | { ok: false; error: string };

function validateLiveSources(rawSources: unknown[]): ValidatedLiveSources {
  const configs: LiveSourceConfig[] = [];
  const errors: string[] = [];
  for (const [index, rawSource] of rawSources.entries()) {
    const parsed = LiveSourceInputSchema.safeParse(rawSource);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join("/")}: ${issue.message}`)
        .join("; ");
      errors.push(`sources[${index}]: ${detail}`);
      continue;
    }
    const normalized = normalizeLiveSource(parsed.data);
    if (!normalized.ok) {
      errors.push(normalized.error);
      continue;
    }
    configs.push(normalized.config);
  }
  const duplicateId = firstDuplicateSourceId(configs);
  if (duplicateId) errors.push(`duplicate source id '${duplicateId}'`);
  if (errors.length > 0) return { ok: false, error: errors.join("\n") };
  return { ok: true, configs };
}

function firstDuplicateSourceId(configs: LiveSourceConfig[]): string | null {
  const seen = new Set<string>();
  for (const config of configs) {
    if (seen.has(config.id)) return config.id;
    seen.add(config.id);
  }
  return null;
}

function isSlotKind(value: unknown): value is import("../shared/types.ts").SlotKind {
  return typeof value === "string" && Object.values(SlotKind).includes(value as never);
}
function isSlotStatus(value: unknown): value is import("../shared/types.ts").SlotStatus {
  return typeof value === "string" && Object.values(SlotStatus).includes(value as never);
}
function isSlotOrigin(value: unknown): value is import("../shared/types.ts").SlotOrigin {
  return typeof value === "string" && Object.values(SlotOrigin).includes(value as never);
}
function isEditKind(value: unknown): value is import("../shared/types.ts").EditKind {
  return typeof value === "string" && Object.values(EditKind).includes(value as never);
}
function isSessionStatus(value: unknown): value is SessionStatus {
  return typeof value === "string" && Object.values(SessionStatus).some((candidate) => candidate === value);
}

// The URL the user would open for this session, derived from the request's
// own origin so error messages point at the port actually bound.
function sessionCanvasUrl(request: Request, sessionId: string): string {
  const origin = new URL(request.url).origin;
  return `${origin}/?session=${encodeURIComponent(sessionId)}`;
}

const SHORT_ID_LENGTH = 8;

function sessionName(session: SessionRoom): string {
  const base = basename(session.cwd);
  if (base.length > 0) return base;
  return shortSessionId(session.sessionId);
}

function sessionSummary(session: SessionRoom): string {
  if (session.cachedSummary !== undefined) return session.cachedSummary;
  if (!session.transcriptPath) return "";
  const summary = firstHumanPrompt(session.transcriptPath);
  if (summary.length > 0) session.cachedSummary = summary;
  return summary;
}

function shortSessionId(sessionId: string): string {
  const hexish = sessionId.replace(/[^0-9a-f]/gi, "");
  return (hexish || sessionId).slice(0, SHORT_ID_LENGTH);
}

const websocketHandler: Bun.WebSocketHandler<WebSocketAttachment> = {
  open(ws) {
    const session = pingSession(ws.data.sessionId);
    const subscriber: WebSocketSubscriber = {
      send: (data) => ws.send(data),
      sessionId: ws.data.sessionId,
    };
    session.subscribers.add(subscriber);
    ws.data.subscriber = subscriber;
    ws.send(JSON.stringify({ kind: "snapshot", data: sessionSnapshot(session) }));
    const transcriptEntries = readTranscriptBacklog(session);
    ws.send(JSON.stringify({ kind: "transcript-snapshot", data: { entries: transcriptEntries } }));
  },
  close(ws) {
    const session = getSession(ws.data.sessionId);
    if (session && ws.data.subscriber) {
      session.subscribers.delete(ws.data.subscriber);
    }
  },
  message() {
    // Browser sends edits via HTTP POST; WebSocket is server→client only.
  },
};

// Port fallback exists for ports held by OTHER software. If a port is held
// by another canvas daemon, we lost a spawn race — exit instead of becoming
// a second daemon that clobbers the winner's state files.
async function startServerWithPortFallback(): Promise<CanvasServer> {
  const errors: string[] = [];
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const candidatePort = DEFAULT_PORT + offset;
    try {
      return serve<WebSocketAttachment>({
        hostname: "127.0.0.1",
        port: candidatePort,
        idleTimeout: REQUEST_IDLE_TIMEOUT_S,
        fetch: handleFetch,
        websocket: websocketHandler,
      });
    } catch (caught) {
      if (await isCanvasDaemonAt(candidatePort)) {
        console.error(
          `clawd-canvas: another daemon won port ${candidatePort} during startup; exiting.`,
        );
        process.exit(0);
      }
      const message = caught instanceof Error ? caught.message : String(caught);
      errors.push(`port ${candidatePort}: ${message}`);
    }
  }
  throw new Error(
    `clawd-canvas: could not bind any port in [${DEFAULT_PORT}..${DEFAULT_PORT + MAX_PORT_ATTEMPTS - 1}]\n${errors.join("\n")}`,
  );
}

const server = await startServerWithPortFallback();
const boundPort = server.port;
if (boundPort === undefined) {
  throw new Error("clawd-canvas: server bound but Bun did not report a port");
}
writeServerStateFiles(boundPort, SERVER_TOKEN);
rehydratePersistedLiveSources();

process.on("exit", () => {
  stopAllLiveSources();
  clearServerStateFilesIfOwned();
});
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

console.log(`clawd-canvas: listening on http://localhost:${boundPort}`);
