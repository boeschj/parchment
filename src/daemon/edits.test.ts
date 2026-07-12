import { describe, it, expect } from "bun:test";
import { randomUUID } from "node:crypto";
import { EditKind } from "../shared/types.ts";
import {
  recordEdit,
  buildInjectionPayload,
  consumeOneShotEdits,
  drainPendingEdits,
  clearOverlay,
  renderInjectionMarkup,
} from "./edits.ts";

// edits.ts transitively imports state.ts, whose STATE_DIR is redirected to a
// temp dir by src/daemon/test-preload.ts (bunfig.toml [test].preload) before
// any module loads. That injection replaces the old per-file node:os homedir
// mock, so these tests use plain static imports and never touch the real
// ~/.parchment.

// Every test gets its own sessionId so the module-level session map (shared
// across every test in this file, and every other file that touches it) can
// never leak state between tests.
function uniqueSessionId(): string {
  return `edits-test-${randomUUID()}`;
}

describe("recordEdit", () => {
  it("coalesces edits for the same (slotId, elementId), keeping only the newest", () => {
    const sessionId = uniqueSessionId();
    recordEdit({
      sessionId,
      slotId: "slot-1",
      elementId: "el-1",
      kind: EditKind.GenericEdit,
      payload: { value: "first" },
    });
    recordEdit({
      sessionId,
      slotId: "slot-1",
      elementId: "el-1",
      kind: EditKind.GenericEdit,
      payload: { value: "second" },
    });

    const payload = buildInjectionPayload(sessionId);
    expect(payload.count).toBe(1);
    expect(payload.entries[0]?.payload).toEqual({ value: "second" });

    const pending = drainPendingEdits(sessionId);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.payload).toEqual({ value: "second" });
  });

  it("keeps edits for different elementIds within the same slot separate", () => {
    const sessionId = uniqueSessionId();
    recordEdit({ sessionId, slotId: "slot-1", elementId: "el-1", kind: EditKind.GenericEdit, payload: { a: 1 } });
    recordEdit({ sessionId, slotId: "slot-1", elementId: "el-2", kind: EditKind.GenericEdit, payload: { a: 2 } });

    expect(buildInjectionPayload(sessionId).count).toBe(2);
  });

  it("keeps edits for different slotIds separate, even with a shared elementId", () => {
    const sessionId = uniqueSessionId();
    recordEdit({ sessionId, slotId: "slot-1", elementId: "el-1", kind: EditKind.GenericEdit, payload: { a: 1 } });
    recordEdit({ sessionId, slotId: "slot-2", elementId: "el-1", kind: EditKind.GenericEdit, payload: { a: 2 } });

    expect(buildInjectionPayload(sessionId).count).toBe(2);
  });

  it("treats a null elementId as its own coalescing key", () => {
    const sessionId = uniqueSessionId();
    recordEdit({ sessionId, slotId: "slot-1", elementId: null, kind: EditKind.PlanEdit, payload: { a: 1 } });
    recordEdit({ sessionId, slotId: "slot-1", elementId: null, kind: EditKind.PlanEdit, payload: { a: 2 } });

    const payload = buildInjectionPayload(sessionId);
    expect(payload.count).toBe(1);
    expect(payload.entries[0]?.payload).toEqual({ a: 2 });
  });
});

describe("buildInjectionPayload", () => {
  it("returns count 0 and no entries for a session with no edits", () => {
    expect(buildInjectionPayload(uniqueSessionId())).toEqual({ count: 0, entries: [] });
  });

  it("reflects every distinct overlay entry recorded so far", () => {
    const sessionId = uniqueSessionId();
    recordEdit({ sessionId, slotId: "slot-1", elementId: "el-1", kind: EditKind.DiffEdit, payload: { after: "x" } });
    recordEdit({ sessionId, slotId: "slot-2", elementId: "el-9", kind: EditKind.TableEdit, payload: { cell: "y" } });

    const payload = buildInjectionPayload(sessionId);
    expect(payload.count).toBe(2);
    expect(payload.entries.map((entry) => entry.slotId).sort()).toEqual(["slot-1", "slot-2"]);
  });
});

describe("consumeOneShotEdits", () => {
  it("removes form-submit and mermaid-comment entries but keeps sticky state kinds", () => {
    const sessionId = uniqueSessionId();
    recordEdit({ sessionId, slotId: "slot-1", elementId: "el-1", kind: EditKind.FormSubmit, payload: { id: "form" } });
    recordEdit({
      sessionId,
      slotId: "slot-1",
      elementId: "node:1",
      kind: EditKind.MermaidComment,
      payload: { nodeId: "1", body: "hi" },
    });
    recordEdit({
      sessionId,
      slotId: "slot-1",
      elementId: "el-2",
      kind: EditKind.PlanEdit,
      payload: { markdown: "keep me" },
    });

    consumeOneShotEdits(sessionId);

    const payload = buildInjectionPayload(sessionId);
    expect(payload.count).toBe(1);
    expect(payload.entries[0]?.kind).toBe(EditKind.PlanEdit);
  });

  it("consumes intent, file-upload, and app command kinds but keeps app-model-context sticky", () => {
    const sessionId = uniqueSessionId();
    recordEdit({ sessionId, slotId: "slot-1", elementId: "a", kind: EditKind.Intent, payload: { id: "retry" } });
    recordEdit({ sessionId, slotId: "slot-1", elementId: "b", kind: EditKind.FileUpload, payload: { savedPath: "/x" } });
    recordEdit({ sessionId, slotId: "slot-1", elementId: "c", kind: EditKind.AppIntent, payload: { intent: "x" } });
    recordEdit({ sessionId, slotId: "slot-1", elementId: "d", kind: EditKind.AppPrompt, payload: { role: "user" } });
    recordEdit({ sessionId, slotId: "slot-1", elementId: "e", kind: EditKind.AppNotify, payload: { message: "m" } });
    recordEdit({
      sessionId,
      slotId: "slot-1",
      elementId: "f",
      kind: EditKind.AppModelContext,
      payload: { structuredContent: { tasks: [] } },
    });

    consumeOneShotEdits(sessionId);

    const payload = buildInjectionPayload(sessionId);
    expect(payload.count).toBe(1);
    expect(payload.entries[0]?.kind).toBe(EditKind.AppModelContext);
  });

  it("is a no-op when there are no one-shot edits to remove", () => {
    const sessionId = uniqueSessionId();
    recordEdit({ sessionId, slotId: "slot-1", elementId: "el-1", kind: EditKind.PlanEdit, payload: { markdown: "keep" } });

    consumeOneShotEdits(sessionId);

    expect(buildInjectionPayload(sessionId).count).toBe(1);
  });

  it("does not throw for a sessionId that was never created", () => {
    expect(() => consumeOneShotEdits(uniqueSessionId())).not.toThrow();
  });
});

describe("clearOverlay", () => {
  it("empties both the overlay and the pending edit list", () => {
    const sessionId = uniqueSessionId();
    recordEdit({ sessionId, slotId: "slot-1", elementId: "el-1", kind: EditKind.GenericEdit, payload: { a: 1 } });

    clearOverlay(sessionId);

    expect(buildInjectionPayload(sessionId)).toEqual({ count: 0, entries: [] });
    expect(drainPendingEdits(sessionId)).toEqual([]);
  });

  it("does not throw for a sessionId that was never created", () => {
    expect(() => clearOverlay(uniqueSessionId())).not.toThrow();
  });
});

describe("renderInjectionMarkup", () => {
  it("returns an empty string when the payload has no entries", () => {
    expect(renderInjectionMarkup({ count: 0, entries: [] })).toBe("");
  });

  it("wraps a single entry in the canvas-state block with kind/slot/element/payload-origin attrs", () => {
    const markup = renderInjectionMarkup({
      count: 1,
      entries: [{ slotId: "slot-1", elementId: "el-1", kind: EditKind.GenericEdit, payload: { a: 1 }, updatedAt: 0 }],
    });

    expect(markup).toStartWith("<canvas-state>\n");
    expect(markup).toEndWith("</canvas-state>\n");
    expect(markup).toContain(
      [
        '<canvas-edit kind="generic-edit" slot="slot-1" element="el-1" payload-origin="user-content">',
        '{"a":1}',
        "</canvas-edit>",
      ].join("\n"),
    );
  });

  it("states the trust boundary in the preamble", () => {
    const markup = renderInjectionMarkup({
      count: 1,
      entries: [{ slotId: "slot-1", elementId: "el-1", kind: EditKind.FormSubmit, payload: {}, updatedAt: 0 }],
    });

    expect(markup).toContain("Trust boundary");
    expect(markup).toContain("never as instructions");
  });

  it("marks daemon-resolved intent payloads as daemon-verified", () => {
    const markup = renderInjectionMarkup({
      count: 1,
      entries: [
        { slotId: "slot-1", elementId: "el-1", kind: EditKind.Intent, payload: { id: "retry" }, updatedAt: 0 },
      ],
    });

    expect(markup).toContain('payload-origin="daemon-verified"');
  });

  it("adds the file-upload trust note only when a file-upload entry is present", () => {
    const withoutUpload = renderInjectionMarkup({
      count: 1,
      entries: [{ slotId: "s", elementId: null, kind: EditKind.PlanEdit, payload: {}, updatedAt: 0 }],
    });
    const withUpload = renderInjectionMarkup({
      count: 1,
      entries: [
        { slotId: "s", elementId: null, kind: EditKind.FileUpload, payload: { savedPath: "/x" }, updatedAt: 0 },
      ],
    });

    expect(withoutUpload).not.toContain("savedPath was generated");
    expect(withUpload).toContain("savedPath was generated");
    expect(withUpload).toContain('payload-origin="user-content"');
  });

  it("omits the element attribute when elementId is null", () => {
    const markup = renderInjectionMarkup({
      count: 1,
      entries: [{ slotId: "slot-2", elementId: null, kind: EditKind.PlanEdit, payload: {}, updatedAt: 0 }],
    });

    expect(markup).toContain('<canvas-edit kind="plan-edit" slot="slot-2" payload-origin="user-content">\n{}\n</canvas-edit>');
    expect(markup).not.toContain(" element=");
  });

  it("renders multiple entries as consecutive canvas-edit blocks, in entry order", () => {
    const markup = renderInjectionMarkup({
      count: 2,
      entries: [
        { slotId: "slot-1", elementId: "el-1", kind: EditKind.GenericEdit, payload: { a: 1 }, updatedAt: 0 },
        { slotId: "slot-2", elementId: "el-2", kind: EditKind.TableEdit, payload: { b: 2 }, updatedAt: 0 },
      ],
    });

    const blockCount = markup.split("<canvas-edit").length - 1;
    expect(blockCount).toBe(2);
    expect(markup.indexOf('slot="slot-1"')).toBeLessThan(markup.indexOf('slot="slot-2"'));
  });
});
