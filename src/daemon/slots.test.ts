import { describe, it, expect, mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SlotKind, SlotStatus, SlotOrigin, SessionStatus } from "../shared/types.ts";
import type { JsonRenderSpec } from "../shared/types.ts";
import type { SessionRoom, WebSocketSubscriber } from "./sessions.ts";

// slots.ts transitively imports sessions.ts -> session-store.ts -> state.ts,
// and state.ts computes STATE_DIR = join(homedir(), ".parchment") once, at
// module-load time. Bun's os.homedir() does NOT pick up a runtime
// `process.env.HOME = ...` assignment (only $HOME set before the process
// starts), so the only reliable way to redirect it is to mock the node:os
// module before that chain is ever imported. This must happen via a dynamic
// import — a static one would be hoisted by ESM ahead of the mock.module
// call below.
const fakeHome = mkdtempSync(join(tmpdir(), "clawd-canvas-slots-"));
const realOs = await import("node:os");
mock.module("node:os", () => ({ ...realOs, homedir: () => fakeHome }));

const { upsertSlot, markSlotError, removeSlot, listSlots, requestSlotOps, resolveSlotOps } = await import(
  "./slots.ts"
);

// Every test gets its own sessionId so the module-level session map (shared
// across every test in this file, and every other file that touches it) can
// never leak state between tests.
function uniqueSessionId(): string {
  return `slots-test-${randomUUID()}`;
}

function baseSpec(state?: Record<string, unknown>): JsonRenderSpec {
  return {
    root: "root",
    elements: { root: { type: "Box", props: {} } },
    ...(state ? { state } : {}),
  };
}

type SlotOpsFrame = { kind: string; data: { requestId: string; ops: Record<string, unknown> } };

// JSON.parse is inherently `any`; this named boundary function is the single
// place that trusts the shape of what requestSlotOps sends over the wire,
// rather than sprinkling `as` casts through the assertions below.
function parseSlotOpsFrame(raw: string): SlotOpsFrame {
  return JSON.parse(raw);
}

function createMockSubscriber(): WebSocketSubscriber & { frames: SlotOpsFrame[] } {
  const frames: SlotOpsFrame[] = [];
  return {
    sessionId: "mock-subscriber",
    frames,
    send(raw: string) {
      frames.push(parseSlotOpsFrame(raw));
    },
  };
}

function createFakeSession(subscribers: WebSocketSubscriber[]): SessionRoom {
  return {
    sessionId: `fake-session-${randomUUID()}`,
    cwd: "",
    slots: [],
    pendingEdits: [],
    overlay: new Map(),
    subscribers: new Set(subscribers),
    transcriptPath: null,
    createdAt: Date.now(),
    lastPing: Date.now(),
    status: SessionStatus.Complete,
  };
}

// dispatchSlotOps runs inside a `.then()` on an already-resolved promise, so
// it fires on a later microtask tick rather than synchronously with the
// requestSlotOps call. A macrotask tick reliably flushes it.
function flushDispatch(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("upsertSlot state seeding", () => {
  it("seeds a new slot's state from spec.state when no explicit state is given", () => {
    const sessionId = uniqueSessionId();
    const slot = upsertSlot({
      sessionId,
      kind: SlotKind.Dashboard,
      title: "Dash",
      spec: baseSpec({ count: 1 }),
      origin: SlotOrigin.McpTool,
    });

    expect(slot.state).toEqual({ count: 1 });
  });

  it("deep-copies spec.state so mutating the original spec afterward does not affect the slot", () => {
    const sessionId = uniqueSessionId();
    const specState = { nested: { count: 1 } };
    const slot = upsertSlot({
      sessionId,
      kind: SlotKind.Dashboard,
      title: "Dash",
      spec: baseSpec(specState),
      origin: SlotOrigin.McpTool,
    });

    specState.nested.count = 999;

    expect(slot.state).toEqual({ nested: { count: 1 } });
  });

  it("prefers explicit state over spec.state for a new slot", () => {
    const sessionId = uniqueSessionId();
    const slot = upsertSlot({
      sessionId,
      kind: SlotKind.Dashboard,
      title: "Dash",
      spec: baseSpec({ count: 1 }),
      state: { count: 42 },
      origin: SlotOrigin.McpTool,
    });

    expect(slot.state).toEqual({ count: 42 });
  });

  it("defaults a new slot's state to an empty object when neither is given", () => {
    const sessionId = uniqueSessionId();
    const slot = upsertSlot({
      sessionId,
      kind: SlotKind.Dashboard,
      title: "Dash",
      spec: baseSpec(),
      origin: SlotOrigin.McpTool,
    });

    expect(slot.state).toEqual({});
  });

  it("reseeds an existing slot's state when the update carries a new spec.state", () => {
    const sessionId = uniqueSessionId();
    const created = upsertSlot({
      sessionId,
      kind: SlotKind.Dashboard,
      title: "Dash",
      spec: baseSpec({ count: 1 }),
      origin: SlotOrigin.McpTool,
    });

    const updated = upsertSlot({
      sessionId,
      slotId: created.id,
      kind: SlotKind.Dashboard,
      title: "Dash v2",
      spec: baseSpec({ count: 2 }),
      origin: SlotOrigin.McpTool,
    });

    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe("Dash v2");
    expect(updated.state).toEqual({ count: 2 });
  });

  it("leaves an existing slot's state untouched when the update carries no new state", () => {
    const sessionId = uniqueSessionId();
    const created = upsertSlot({
      sessionId,
      kind: SlotKind.Dashboard,
      title: "Dash",
      spec: baseSpec({ count: 1 }),
      origin: SlotOrigin.McpTool,
    });

    const updated = upsertSlot({
      sessionId,
      slotId: created.id,
      kind: SlotKind.Dashboard,
      title: "Dash v2",
      spec: baseSpec(),
      origin: SlotOrigin.McpTool,
    });

    expect(updated.state).toEqual({ count: 1 });
  });

  it("creates a new slot (using the given id) when slotId does not match any existing slot", () => {
    const sessionId = uniqueSessionId();
    const slot = upsertSlot({
      sessionId,
      slotId: "does-not-exist-yet",
      kind: SlotKind.Table,
      title: "Table",
      spec: baseSpec(),
      origin: SlotOrigin.SlashCommand,
    });

    expect(slot.id).toBe("does-not-exist-yet");
    expect(listSlots(sessionId)).toHaveLength(1);
  });
});

describe("markSlotError / removeSlot / listSlots", () => {
  it("marks a slot as errored and records the message", () => {
    const sessionId = uniqueSessionId();
    const slot = upsertSlot({ sessionId, kind: SlotKind.Report, title: "R", spec: baseSpec(), origin: SlotOrigin.McpTool });

    const errored = markSlotError(sessionId, slot.id, "boom");

    expect(errored?.status).toBe(SlotStatus.Error);
    expect(errored?.errorMessage).toBe("boom");
  });

  it("returns null when marking an unknown slot as errored", () => {
    expect(markSlotError(uniqueSessionId(), "no-such-slot", "boom")).toBeNull();
  });

  it("removes a slot and reports success, then false on a second removal", () => {
    const sessionId = uniqueSessionId();
    const slot = upsertSlot({ sessionId, kind: SlotKind.Report, title: "R", spec: baseSpec(), origin: SlotOrigin.McpTool });

    expect(removeSlot(sessionId, slot.id)).toBe(true);
    expect(listSlots(sessionId)).toHaveLength(0);
    expect(removeSlot(sessionId, slot.id)).toBe(false);
  });

  it("returns an empty array for a session that was never created", () => {
    expect(listSlots(uniqueSessionId())).toEqual([]);
  });
});

describe("requestSlotOps", () => {
  it("sends the slot-ops frame to every connected subscriber", async () => {
    const subA = createMockSubscriber();
    const subB = createMockSubscriber();
    const session = createFakeSession([subA, subB]);
    const ops = { exportPng: { slotId: "slot-1" } };

    const pending = requestSlotOps(session, ops, "http://localhost:7800");
    await flushDispatch();

    expect(subA.frames).toHaveLength(1);
    expect(subB.frames).toHaveLength(1);
    expect(subA.frames[0]?.kind).toBe("slot-ops");
    expect(subA.frames[0]?.data.ops).toEqual(ops);
    expect(subB.frames[0]?.data.requestId).toBe(subA.frames[0]?.data.requestId);

    // Resolve so the pending map entry and its timer don't linger.
    const requestId = subA.frames[0]?.data.requestId;
    if (requestId) resolveSlotOps(requestId, { ok: true });
    await pending;
  });

  it("resolves the held promise with the first result posted for its requestId", async () => {
    const sub = createMockSubscriber();
    const session = createFakeSession([sub]);

    const pending = requestSlotOps(session, { exportPng: { slotId: "slot-1" } }, "http://localhost:7800");
    await flushDispatch();
    const requestId = sub.frames[0]?.data.requestId;
    if (!requestId) throw new Error("expected a dispatched slot-ops frame");

    const didResolve = resolveSlotOps(requestId, { ok: true, pngBase64: "abc123", width: 10, height: 20 });
    expect(didResolve).toBe(true);

    const result = await pending;
    expect(result).toEqual({ ok: true, pngBase64: "abc123", width: 10, height: 20 });
  });

  it("ignores a duplicate resolve for the same requestId", async () => {
    const sub = createMockSubscriber();
    const session = createFakeSession([sub]);

    const pending = requestSlotOps(session, { exportPng: { slotId: "slot-1" } }, "http://localhost:7800");
    await flushDispatch();
    const requestId = sub.frames[0]?.data.requestId;
    if (!requestId) throw new Error("expected a dispatched slot-ops frame");

    expect(resolveSlotOps(requestId, { ok: true })).toBe(true);
    expect(resolveSlotOps(requestId, { ok: false, error: "too late" })).toBe(false);

    expect(await pending).toEqual({ ok: true });
  });

  it("resolves immediately with ok:false when no canvas tab is connected", async () => {
    const session = createFakeSession([]);

    const result = await requestSlotOps(session, { exportPng: { slotId: "slot-1" } }, "http://localhost:7800");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("no canvas tab is connected");
  });

  // The 15s SLOT_OPS_TIMEOUT_MS in slots.ts is a module-private constant, not
  // exported, so there is no way to shrink it for a unit test. Per the task
  // instructions, the timeout path is intentionally left untested rather than
  // padding this suite with a real 15s+ wait.
});
