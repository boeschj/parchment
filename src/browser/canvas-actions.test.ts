import { describe, it, expect, mock, beforeEach, spyOn } from "bun:test";
import { EditKind, SlotOrigin, SlotStatus, SlotKind } from "../shared/types.ts";
import type { Slot } from "../shared/types.ts";

type PostEditBody = {
  slotId: string;
  elementId?: string | null;
  kind: EditKind;
  payload: Record<string, unknown>;
};

type PostEditCall = { sessionId: string; body: PostEditBody };

const postEditCalls: PostEditCall[] = [];

// Reassignable behind the mocked module so individual tests can change what
// postEdit does (e.g. reject) without re-mocking the module or re-importing
// canvas-actions.ts.
let postEditImpl: (sessionId: string, body: PostEditBody) => Promise<void> = async (sessionId, body) => {
  postEditCalls.push({ sessionId, body });
};

// canvas-actions.ts imports postEdit from ./api.ts, which calls the browser's
// global fetch against the daemon's HTTP API. Mocking the module (rather than
// fetch itself) keeps this test from needing a running daemon or a fetch shim.
mock.module("./api.ts", () => ({
  postEdit: (sessionId: string, body: PostEditBody) => postEditImpl(sessionId, body),
}));

// editKindForPath and elementIdForPath are module-private in canvas-actions.ts
// (not exported). Both are exercised indirectly below through postStateChanges,
// their only caller.
const { postStateChanges, buildCanvasActionHandlers } = await import("./canvas-actions.ts");

beforeEach(() => {
  postEditCalls.length = 0;
  postEditImpl = async (sessionId, body) => {
    postEditCalls.push({ sessionId, body });
  };
});

function makeSlot(kind: Slot["kind"]): Slot {
  return {
    id: "slot-1",
    kind,
    status: SlotStatus.Ready,
    origin: SlotOrigin.McpTool,
    title: "Test slot",
    spec: { root: "root", elements: {} },
    state: {},
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("postStateChanges path -> edit kind mapping", () => {
  it("maps a /plan/ path to plan-edit regardless of the slot's own kind", async () => {
    await postStateChanges("session-1", makeSlot(SlotKind.Table), [{ path: "/plan/markdown", value: "hi" }]);

    expect(postEditCalls[0]?.body.kind).toBe(EditKind.PlanEdit);
  });

  it("maps a /diff/ path to diff-edit regardless of the slot's own kind", async () => {
    await postStateChanges("session-1", makeSlot(SlotKind.Table), [{ path: "/diff/after", value: "hi" }]);

    expect(postEditCalls[0]?.body.kind).toBe(EditKind.DiffEdit);
  });

  it("maps a /mermaid/ path to mermaid-edit regardless of the slot's own kind", async () => {
    await postStateChanges("session-1", makeSlot(SlotKind.Table), [{ path: "/mermaid/source", value: "graph TD" }]);

    expect(postEditCalls[0]?.body.kind).toBe(EditKind.MermaidEdit);
  });

  it("maps a /table/ path to table-edit regardless of the slot's own kind", async () => {
    await postStateChanges("session-1", makeSlot(SlotKind.Plan), [{ path: "/table/cells/0", value: 1 }]);

    expect(postEditCalls[0]?.body.kind).toBe(EditKind.TableEdit);
  });

  it("falls back to the slot's kind when the path matches no known prefix", async () => {
    await postStateChanges("session-1", makeSlot(SlotKind.Plan), [{ path: "/custom/thing", value: 1 }]);
    expect(postEditCalls[0]?.body.kind).toBe(EditKind.PlanEdit);

    await postStateChanges("session-1", makeSlot(SlotKind.Diagram), [{ path: "/custom/thing", value: 1 }]);
    expect(postEditCalls[1]?.body.kind).toBe(EditKind.MermaidEdit);

    await postStateChanges("session-1", makeSlot(SlotKind.Diff), [{ path: "/custom/thing", value: 1 }]);
    expect(postEditCalls[2]?.body.kind).toBe(EditKind.DiffEdit);

    await postStateChanges("session-1", makeSlot(SlotKind.Table), [{ path: "/custom/thing", value: 1 }]);
    expect(postEditCalls[3]?.body.kind).toBe(EditKind.TableEdit);
  });

  it("falls back to generic-edit for slot kinds with no dedicated edit kind", async () => {
    await postStateChanges("session-1", makeSlot(SlotKind.Dashboard), [{ path: "/custom/thing", value: 1 }]);

    expect(postEditCalls[0]?.body.kind).toBe(EditKind.GenericEdit);
  });
});

describe("postStateChanges elementId derivation", () => {
  it("strips the leading slash and dots the remaining segments", async () => {
    await postStateChanges("session-1", makeSlot(SlotKind.Plan), [{ path: "/plan/markdown", value: "hi" }]);

    expect(postEditCalls[0]?.body.elementId).toBe("plan.markdown");
  });

  it("posts one edit per changed path, preserving order", async () => {
    await postStateChanges("session-1", makeSlot(SlotKind.Table), [
      { path: "/table/cells/0", value: "a" },
      { path: "/table/cells/1", value: "b" },
    ]);

    expect(postEditCalls).toHaveLength(2);
    expect(postEditCalls[0]?.body.elementId).toBe("table.cells.0");
    expect(postEditCalls[1]?.body.elementId).toBe("table.cells.1");
  });

  it("continues to the next change when postEdit rejects for an earlier one", async () => {
    // postStateChanges logs the rejection via console.error by design; silence
    // it here so this expected failure doesn't clutter the test output.
    const consoleError = spyOn(console, "error").mockImplementation(() => {});

    postEditImpl = async (sessionId, body) => {
      if (body.elementId === "table.cells.0") throw new Error("network error");
      postEditCalls.push({ sessionId, body });
    };

    await postStateChanges("session-1", makeSlot(SlotKind.Table), [
      { path: "/table/cells/0", value: "a" },
      { path: "/table/cells/1", value: "b" },
    ]);

    expect(postEditCalls).toHaveLength(1);
    expect(postEditCalls[0]?.body.elementId).toBe("table.cells.1");
    expect(consoleError).toHaveBeenCalledTimes(1);

    consoleError.mockRestore();
  });
});

describe("buildCanvasActionHandlers", () => {
  it("canvas.submit posts a form-submit edit using the id param as elementId", async () => {
    const handlers = buildCanvasActionHandlers("session-1", makeSlot(SlotKind.Plan));

    await handlers["canvas.submit"]?.({ id: "my-form", value: "x" });

    expect(postEditCalls).toEqual([
      {
        sessionId: "session-1",
        body: { slotId: "slot-1", elementId: "my-form", kind: EditKind.FormSubmit, payload: { id: "my-form", value: "x" } },
      },
    ]);
  });

  it("canvas.submit uses a null elementId when id is not a string", async () => {
    const handlers = buildCanvasActionHandlers("session-1", makeSlot(SlotKind.Plan));

    await handlers["canvas.submit"]?.({ value: "x" });

    expect(postEditCalls[0]?.body.elementId).toBeNull();
  });

  it("canvas.commentMermaid posts a mermaid-comment edit keyed by the node id", async () => {
    const handlers = buildCanvasActionHandlers("session-1", makeSlot(SlotKind.Diagram));

    await handlers["canvas.commentMermaid"]?.({ nodeId: "n1", body: "looks off" });

    expect(postEditCalls).toEqual([
      {
        sessionId: "session-1",
        body: { slotId: "slot-1", elementId: "node:n1", kind: EditKind.MermaidComment, payload: { nodeId: "n1", body: "looks off" } },
      },
    ]);
  });

  it("canvas.commentMermaid is a no-op when nodeId or body is missing", async () => {
    const handlers = buildCanvasActionHandlers("session-1", makeSlot(SlotKind.Diagram));

    await handlers["canvas.commentMermaid"]?.({ nodeId: "", body: "text" });
    await handlers["canvas.commentMermaid"]?.({ nodeId: "n1", body: "" });

    expect(postEditCalls).toHaveLength(0);
  });

  it("canvas.flushPending never calls postEdit", async () => {
    const handlers = buildCanvasActionHandlers("session-1", makeSlot(SlotKind.Plan));

    await handlers["canvas.flushPending"]?.({});

    expect(postEditCalls).toHaveLength(0);
  });
});
