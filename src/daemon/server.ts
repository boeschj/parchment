import { serve } from "bun";
import { basename } from "node:path";
import { EditKind, SessionStatus, SlotKind, SlotOrigin, SlotStatus } from "../shared/types.ts";
import {
  generateToken,
  writeServerStateFiles,
  clearServerStateFilesIfOwned,
  DAEMON_APP_NAME,
  isParchmentDaemonAt,
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
import type { JsonRenderSpec, SlotOps, SlotOpsResult } from "../shared/types.ts";
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
  setSlotReferenceRefreshSources,
  stopAllLiveSources,
  stopSessionLiveSources,
} from "./live/engine.ts";
import { hydrateSpec } from "./hydrate/index.ts";
import { allowBlobPath, buildBlobUrl, BLOB_ROUTE_PATH, serveBlob } from "./hydrate/blob.ts";
import {
  LiveSourceInputSchema,
  normalizeLiveSource,
  type LiveSourceConfig,
} from "./live/types.ts";
import { extractIntentMenu, resolveIntent } from "./intents.ts";
import { validateBridgeCall } from "./apps/bridge.ts";
import { listAppServerNames } from "./apps/config.ts";
import { closeAllAppConnections } from "./apps/connections.ts";
import { executeBridgeCall, openAppInSlot } from "./apps/open.ts";
import { SANDBOX_PAGE_HTML, SANDBOX_PAGE_PATH } from "./apps/sandbox-page.ts";
import { storeUpload } from "./uploads.ts";
import { serveBuiltInTheme, serveStatic, serveUserTheme } from "./static.ts";
import { deleteLibraryEntry, ensureLibrarySeeded, listLibraryEntries, readLibraryEntry } from "./library.ts";

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
  console.error("parchment: daemon already running; exiting.");
  process.exit(0);
}

const SERVER_TOKEN = generateToken();
const SERVER_STARTED_AT = new Date().toISOString();

// Fresh installs see the shipped starter templates in the browser's library
// panel (and canvas_library) without waiting on an MCP tool call first —
// cheap no-op after the first boot (guarded by the .seeded marker file).
ensureLibrarySeeded();

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

  // Local-image blob route for the $img reference. Token-checked inside
  // serveBlob (an <img> tag cannot carry the x-canvas-token header, so the
  // token rides in the query string); the Host/Origin guard above already
  // confined it to loopback.
  if (path === BLOB_ROUTE_PATH) {
    return serveBlob(url, SERVER_TOKEN);
  }

  if (path === "/api/health") {
    return jsonResponse({
      ok: true,
      app: DAEMON_APP_NAME,
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

  if (path === "/api/library") {
    return jsonResponse({ entries: listLibraryEntries() });
  }

  const libraryEntryMatch = path.match(/^\/api\/library\/([^/]+)$/);
  if (libraryEntryMatch) {
    const name = decodeURIComponent(libraryEntryMatch[1]!);
    return handleLibraryEntryRoute(request, name);
  }

  if (path === "/api/apps" && request.method === "GET") {
    return jsonResponse({ servers: listAppServerNames() });
  }

  // App bridge: the browser relays whitelisted JSON-RPC calls from an app
  // iframe here. Token-guarded (mutating POST); the iframe itself can never
  // reach this endpoint — its opaque origin and CSP block direct daemon
  // access, so only parchment's own page code brokers calls.
  const bridgeMatch = path.match(/^\/api\/apps\/([^/]+)\/bridge$/);
  if (bridgeMatch && request.method === "POST") {
    const serverName = decodeURIComponent(bridgeMatch[1]!);
    return handleAppBridge(request, serverName);
  }

  // The MCP app sandbox proxy. The canvas loads it via the daemon's OTHER
  // loopback name (localhost vs 127.0.0.1) so it runs cross-origin from the
  // canvas page — the cheap local variant of SEP-1865's sandbox-proxy origin
  // split.
  if (path === SANDBOX_PAGE_PATH) {
    return new Response(SANDBOX_PAGE_HTML, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
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

  // A shipped built-in theme (themes/manuscript.css, themes/terminal.css,
  // themes/slate.css, ...), read live from the repo — no rebuild to pick up
  // an edit.
  const builtInThemeMatch = path.match(/^\/themes\/([a-z]+)\.css$/);
  if (builtInThemeMatch) {
    return serveBuiltInTheme(builtInThemeMatch[1]!);
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
    // Reference hydration runs here, in the daemon, because it needs the
    // session's cwd (relative paths) and the daemon's own git/filesystem/blob
    // access. It rewrites {$file}/{$diff}/{$csv}/{$img} props into {$state}
    // bindings and seeds their content into the slot's "/hydrated" namespace.
    const session = ensureSession(sessionId, body.cwd ?? "");
    const hydration = await hydrateSpec({
      spec: spec as unknown as JsonRenderSpec,
      cwd: session.cwd,
      // The path reaching here is already root-confined and realpath'd by the
      // hydrator; registering it is what authorizes the blob route to serve it.
      buildBlobUrl: (absPath) => {
        allowBlobPath(absPath);
        return buildBlobUrl(absPath, SERVER_TOKEN);
      },
    });
    if (hydration.errors.length > 0) {
      return errorResponse(
        HttpStatus.BadRequest,
        ErrorCode.BadRequest,
        `reference hydration failed:\n${hydration.errors.map((issue) => `- ${issue}`).join("\n")}`,
      );
    }
    const hydratedSpec = hydration.spec;
    // Intent bindings must be resolvable daemon-side or the push fails —
    // an unextractable intent would otherwise become an unclickable button.
    const intentExtraction = extractIntentMenu(hydratedSpec as never);
    if (intentExtraction.issues.length > 0) {
      return errorResponse(
        HttpStatus.BadRequest,
        ErrorCode.BadRequest,
        `intent bindings rejected:\n${intentExtraction.issues.map((issue) => `- ${issue}`).join("\n")}`,
      );
    }
    const origin = isSlotOrigin(body.origin) ? body.origin : SlotOrigin.McpTool;
    const status = isSlotStatus(body.status) ? body.status : SlotStatus.Ready;
    const slot = upsertSlot({
      sessionId,
      cwd: body.cwd ?? "",
      kind: body.kind,
      title: body.title,
      spec: hydratedSpec,
      origin,
      ...(body.slotId !== undefined ? { slotId: body.slotId } : {}),
      status,
      ...(body.state !== undefined ? { state: body.state } : {}),
    });
    // {watch:true} references become live reference-refresh sources, merged
    // alongside any canvas_live sources already on the slot.
    setSlotReferenceRefreshSources(sessionId, slot.id, hydration.watchSources);
    return jsonResponse({ ok: true, slot, notes: hydration.notes });
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
    // SECURITY: intent submissions carry only an opaque id. The payload the
    // agent sees is resolved here, from the menu the daemon recorded at push
    // time — a page cannot fabricate or reshape an intent it was not offered.
    const isIntentSubmission = body.kind === EditKind.Intent;
    const payload = isIntentSubmission
      ? resolveIntentPayload(sessionId, body.slotId, body.payload)
      : body.payload;
    if (payload === null) {
      return errorResponse(
        HttpStatus.BadRequest,
        ErrorCode.BadRequest,
        `unknown intent id for slot ${body.slotId} — not in the daemon-recorded intent menu`,
      );
    }
    const edit = recordEdit({
      sessionId,
      slotId: body.slotId,
      elementId: body.elementId ?? null,
      kind: body.kind,
      payload,
    });
    return jsonResponse({ ok: true, edit });
  }

  if (subPath === "/uploads" && method === "POST") {
    return handleUpload(request, sessionId);
  }

  if (subPath === "/apps/open" && method === "POST") {
    return handleAppOpen(request, sessionId);
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

// GET returns one saved entry's full spec (so the browser can push it into a
// slot); DELETE removes it. Both are read/mutate-by-name, no session scoping —
// the library is shared across every session, unlike slots.
async function handleLibraryEntryRoute(request: Request, name: string): Promise<Response> {
  if (request.method === "GET") {
    const entry = readLibraryEntry(name);
    if (!entry) return errorResponse(HttpStatus.NotFound, ErrorCode.NotFound, `no saved UI named "${name}"`);
    return jsonResponse({ entry });
  }
  if (request.method === "DELETE") {
    const deleted = deleteLibraryEntry(name);
    if (!deleted) return errorResponse(HttpStatus.NotFound, ErrorCode.NotFound, `no saved UI named "${name}"`);
    return jsonResponse({ ok: true });
  }
  return errorResponse(HttpStatus.MethodNotAllowed, ErrorCode.MethodNotAllowed, `method ${request.method} not allowed`);
}

// id -> daemon-recorded intent definition, or null when the id was never
// offered (including ids for slots that don't exist).
function resolveIntentPayload(
  sessionId: string,
  slotId: string,
  submitted: Record<string, unknown>,
): Record<string, unknown> | null {
  const intentId = submitted.id;
  if (typeof intentId !== "string" || intentId.length === 0) return null;
  const session = ensureSession(sessionId);
  const slot = session.slots.find((candidate) => candidate.id === slotId);
  if (!slot) return null;
  const definition = resolveIntent(slot, intentId);
  if (!definition) return null;
  return { ...definition };
}

async function handleUpload(request: Request, sessionId: string): Promise<Response> {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return errorResponse(HttpStatus.BadRequest, ErrorCode.BadRequest, "multipart form body required");
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return errorResponse(HttpStatus.BadRequest, ErrorCode.BadRequest, "form field 'file' must be a file");
  }
  const slotId = formData.get("slotId");
  if (typeof slotId !== "string" || slotId.length === 0) {
    return errorResponse(HttpStatus.BadRequest, ErrorCode.BadRequest, "form field 'slotId' required");
  }
  const elementId = formData.get("elementId");

  const stored = await storeUpload(sessionId, file);
  // The injected payload is the PATH plus metadata — never file contents.
  const edit = recordEdit({
    sessionId,
    slotId,
    elementId: typeof elementId === "string" && elementId.length > 0 ? elementId : null,
    kind: EditKind.FileUpload,
    payload: { ...stored },
  });
  return jsonResponse({ ok: true, savedPath: stored.savedPath, edit });
}

async function handleAppOpen(request: Request, sessionId: string): Promise<Response> {
  const body = (await request.json()) as {
    server?: string;
    register?: unknown;
    tool?: string;
    toolArgs?: Record<string, unknown>;
    resource?: string;
    title?: string;
    slotId?: string;
    cwd?: string;
  };
  if (typeof body.server !== "string" || body.server.length === 0) {
    return errorResponse(HttpStatus.BadRequest, ErrorCode.BadRequest, "server name required");
  }
  try {
    const outcome = await openAppInSlot({
      sessionId,
      cwd: body.cwd ?? "",
      server: body.server,
      ...(body.register !== undefined ? { register: body.register } : {}),
      ...(body.tool !== undefined ? { tool: body.tool } : {}),
      ...(body.toolArgs !== undefined ? { toolArgs: body.toolArgs } : {}),
      ...(body.resource !== undefined ? { resource: body.resource } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.slotId !== undefined ? { slotId: body.slotId } : {}),
    });
    return jsonResponse({
      ok: true,
      slot: outcome.slot,
      resourceUri: outcome.resourceUri,
      summary: outcome.summary,
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return errorResponse(HttpStatus.BadRequest, ErrorCode.BadRequest, message);
  }
}

async function handleAppBridge(request: Request, serverName: string): Promise<Response> {
  const body = await request.json().catch(() => null);
  const validation = validateBridgeCall(body);
  if (!validation.ok) {
    return errorResponse(HttpStatus.BadRequest, ErrorCode.BadRequest, validation.error);
  }
  try {
    const result = await executeBridgeCall(serverName, validation.call);
    return jsonResponse({ ok: true, result });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return errorResponse(HttpStatus.BadRequest, ErrorCode.BadRequest, message);
  }
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
// by another parchment daemon, we lost a spawn race — exit instead of
// becoming a second daemon that clobbers the winner's state files. A foreign
// daemon on the port (e.g. a legacy clawd-canvas install on 7800) is just
// other software; keep walking the port range.
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
      if (await isParchmentDaemonAt(candidatePort)) {
        console.error(
          `parchment: another daemon won port ${candidatePort} during startup; exiting.`,
        );
        process.exit(0);
      }
      const message = caught instanceof Error ? caught.message : String(caught);
      errors.push(`port ${candidatePort}: ${message}`);
    }
  }
  throw new Error(
    `parchment: could not bind any port in [${DEFAULT_PORT}..${DEFAULT_PORT + MAX_PORT_ATTEMPTS - 1}]\n${errors.join("\n")}`,
  );
}

const server = await startServerWithPortFallback();
const boundPort = server.port;
if (boundPort === undefined) {
  throw new Error("parchment: server bound but Bun did not report a port");
}
writeServerStateFiles(boundPort, SERVER_TOKEN);
rehydratePersistedLiveSources();

process.on("exit", () => {
  stopAllLiveSources();
  clearServerStateFilesIfOwned();
});
// Stdio app servers are child processes; close their transports before
// exiting so they don't outlive the daemon.
function shutdown(): void {
  void closeAllAppConnections().finally(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`parchment: listening on http://localhost:${boundPort}`);
