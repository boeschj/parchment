import { serve } from "bun";
import { EditKind, SlotKind, SlotOrigin, SlotStatus } from "../shared/types.ts";
import {
  generateToken,
  writeServerStateFiles,
  clearServerStateFiles,
  isExistingServerAlive,
} from "./state.ts";
import { guardRequest, jsonResponse, errorResponse, ErrorCode, HttpStatus } from "./security.ts";
import {
  configureSessionLifecycleHooks,
  ensureSession,
  pingSession,
  getSession,
  listSessions,
  broadcast,
  sessionSnapshot,
  resolveSessionByShortAlias,
  runIdleSweep,
  type WebSocketAttachment,
  type WebSocketSubscriber,
} from "./sessions.ts";
import {
  upsertSlot,
  removeSlot,
  markSlotError,
  clearSessionSlotDir,
} from "./slots.ts";
import {
  recordEdit,
  buildInjectionPayload,
  renderInjectionMarkup,
  clearOverlay,
} from "./edits.ts";
import { serveStatic } from "./static.ts";

const DEFAULT_PORT = Number(process.env.CANVAS_PORT ?? 7777);
const MAX_PORT_ATTEMPTS = 10;
const DEFAULT_SESSION_STALE_MS = 120 * 1000;
const DEFAULT_EXIT_GRACE_MS = 60 * 1000;
const IDLE_CHECK_INTERVAL_MS = 15 * 1000;

const SESSION_STALE_MS = Number(process.env.CANVAS_SESSION_STALE_MS ?? DEFAULT_SESSION_STALE_MS);
const EXIT_GRACE_MS = Number(process.env.CANVAS_EXIT_GRACE_MS ?? DEFAULT_EXIT_GRACE_MS);
const IDLE_SHUTDOWN_ENABLED = SESSION_STALE_MS > 0 && EXIT_GRACE_MS > 0;

if (isExistingServerAlive()) {
  console.error("clawd-canvas: daemon already running; exiting.");
  process.exit(0);
}

const SERVER_TOKEN = generateToken();

let pendingExitTimer: ReturnType<typeof setTimeout> | null = null;

function cancelExitTimer(): void {
  if (pendingExitTimer !== null) {
    clearTimeout(pendingExitTimer);
    pendingExitTimer = null;
  }
}

function scheduleExitTimer(): void {
  if (pendingExitTimer !== null) return;
  pendingExitTimer = setTimeout(() => {
    console.log(
      `clawd-canvas: no sessions for ${Math.round(EXIT_GRACE_MS / 1000)}s — shutting down`,
    );
    process.exit(0);
  }, EXIT_GRACE_MS);
}

configureSessionLifecycleHooks({
  onSessionCreated: cancelExitTimer,
  onEmptyMap: scheduleExitTimer,
});

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
    return jsonResponse({ ok: true, port: srv.port, sessions: listSessions().length });
  }

  if (path === "/api/heartbeat") {
    const sessionId = url.searchParams.get("session");
    if (!sessionId) return jsonResponse({ ok: true });
    const session = pingSession(sessionId);
    return jsonResponse({ ok: true, lastPing: session.lastPing });
  }

  if (path === "/api/sessions") {
    return jsonResponse({
      sessions: listSessions().map((session) => ({
        sessionId: session.sessionId,
        cwd: session.cwd,
        slotCount: session.slots.length,
        createdAt: session.createdAt,
        lastPing: session.lastPing,
      })),
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
      return new Response(renderInjectionMarkup(payload), {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return jsonResponse(payload);
  }

  if (subPath === "/reset" && method === "POST") {
    const session = ensureSession(sessionId);
    session.slots = [];
    clearOverlay(sessionId);
    clearSessionSlotDir(sessionId);
    broadcast(session, { kind: "reset", data: { sessionId } });
    return jsonResponse({ ok: true });
  }

  return errorResponse(HttpStatus.NotFound, ErrorCode.NotFound, "route not found");
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

function startServerWithPortFallback(): CanvasServer {
  const errors: string[] = [];
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const candidatePort = DEFAULT_PORT + offset;
    try {
      return serve<WebSocketAttachment>({
        port: candidatePort,
        fetch: handleFetch,
        websocket: websocketHandler,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      errors.push(`port ${candidatePort}: ${message}`);
    }
  }
  throw new Error(
    `clawd-canvas: could not bind any port in [${DEFAULT_PORT}..${DEFAULT_PORT + MAX_PORT_ATTEMPTS - 1}]\n${errors.join("\n")}`,
  );
}

const server = startServerWithPortFallback();
const boundPort = server.port;
if (boundPort === undefined) {
  throw new Error("clawd-canvas: server bound but Bun did not report a port");
}
writeServerStateFiles(boundPort, SERVER_TOKEN);

let idleCheckInterval: ReturnType<typeof setInterval> | null = null;
if (IDLE_SHUTDOWN_ENABLED) {
  idleCheckInterval = setInterval(() => {
    runIdleSweep(SESSION_STALE_MS);
  }, IDLE_CHECK_INTERVAL_MS);
}

process.on("exit", () => {
  if (idleCheckInterval) clearInterval(idleCheckInterval);
  cancelExitTimer();
  clearServerStateFiles();
});
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

console.log(`clawd-canvas: listening on http://localhost:${boundPort}`);
if (IDLE_SHUTDOWN_ENABLED) {
  console.log(
    `clawd-canvas: idle shutdown enabled (evict > ${Math.round(SESSION_STALE_MS / 1000)}s, exit after ${Math.round(EXIT_GRACE_MS / 1000)}s empty)`,
  );
}
