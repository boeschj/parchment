import { serve } from "bun";
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
  pingSession,
  pingKnownSession,
  getSession,
  listSessions,
  setSessionStatus,
  broadcast,
  sessionSnapshot,
  resolveSessionByShortAlias,
  type WebSocketAttachment,
  type WebSocketSubscriber,
} from "./sessions.ts";
import { upsertSlot, removeSlot, markSlotError } from "./slots.ts";
import { clearPersistedSlots } from "./session-store.ts";
import { registerTranscriptPath, readTranscriptBacklog } from "./transcript.ts";
import {
  readBoardScene,
  writeBoardScene,
  requestBoardOps,
  resolveBoardOps,
} from "./board.ts";
import type { BoardOps, BoardOpsResult, BoardScene } from "../shared/types.ts";
import {
  recordEdit,
  buildInjectionPayload,
  renderInjectionMarkup,
  clearOverlay,
} from "./edits.ts";
import { serveStatic, serveUserTheme } from "./static.ts";

const DEFAULT_PORT = Number(process.env.CANVAS_PORT ?? 7800);
const MAX_PORT_ATTEMPTS = 10;
// Board ops hold a request open up to 15s waiting on a browser round-trip;
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
    const session = pingKnownSession(sessionId);
    return jsonResponse({ ok: true, lastPing: session?.lastPing ?? null });
  }

  if (path === "/api/sessions") {
    return jsonResponse({
      sessions: listSessions().map((session) => ({
        sessionId: session.sessionId,
        cwd: session.cwd,
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

  // User theme override, served from ~/.canvas/theme.css (empty if absent).
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

  if (subPath === "/board" && method === "GET") {
    return jsonResponse(readBoardScene(sessionId));
  }

  if (subPath === "/board" && method === "POST") {
    const body = (await request.json()) as Partial<BoardScene> & { clientId?: string };
    if (!Array.isArray(body.elements)) {
      return errorResponse(HttpStatus.BadRequest, ErrorCode.BadRequest, "elements[] required");
    }
    const session = ensureSession(sessionId);
    const scene: BoardScene = { elements: body.elements, files: body.files ?? {} };
    writeBoardScene(session, scene, body.clientId ?? null);
    return jsonResponse({ ok: true });
  }

  if (subPath === "/board/ops" && method === "POST") {
    const body = (await request.json()) as { ops?: BoardOps };
    if (!body.ops) {
      return errorResponse(HttpStatus.BadRequest, ErrorCode.BadRequest, "ops required");
    }
    const session = ensureSession(sessionId);
    const result = await requestBoardOps(session, body.ops);
    return jsonResponse(result);
  }

  if (subPath === "/board/ops-result" && method === "POST") {
    const body = (await request.json()) as { requestId?: string; result?: BoardOpsResult };
    if (typeof body.requestId !== "string" || !body.result) {
      return errorResponse(HttpStatus.BadRequest, ErrorCode.BadRequest, "requestId and result required");
    }
    const resolved = resolveBoardOps(body.requestId, body.result);
    return jsonResponse({ ok: resolved });
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

  if (subPath === "/reset" && method === "POST") {
    const session = ensureSession(sessionId);
    session.slots = [];
    clearOverlay(sessionId);
    clearPersistedSlots(sessionId);
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
function isSessionStatus(value: unknown): value is SessionStatus {
  return typeof value === "string" && Object.values(SessionStatus).some((candidate) => candidate === value);
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

process.on("exit", () => {
  clearServerStateFilesIfOwned();
});
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

console.log(`clawd-canvas: listening on http://localhost:${boundPort}`);
