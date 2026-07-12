import { describe, it, expect, mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// edits.ts transitively imports sessions.ts -> session-store.ts -> state.ts,
// and state.ts computes STATE_DIR = join(homedir(), ".parchment") once, at
// module-load time. Bun's os.homedir() does NOT pick up a runtime
// `process.env.HOME = ...` assignment (only $HOME set before the process
// starts), so the only reliable way to redirect it is to mock the node:os
// module before that chain is ever imported. Bun caches modules by resolved
// path across test files, so this must happen via a dynamic import (never a
// static one, which ESM hoists ahead of the mock.module call below) — see
// slots.test.ts for the same pattern.
const fakeHome = mkdtempSync(join(tmpdir(), "parchment-edits-"));
const realOs = await import("node:os");
mock.module("node:os", () => ({ ...realOs, homedir: () => fakeHome }));

const { EditKind } = await import("../shared/types.ts");
const {
  recordEdit,
  buildInjectionPayload,
  consumeOneShotEdits,
  drainPendingEdits,
  clearOverlay,
  renderInjectionMarkup,
} = await import("./edits.ts");

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

  it("wraps a single entry in the canvas-state block with kind/slot/element attrs", () => {
    const markup = renderInjectionMarkup({
      count: 1,
      entries: [{ slotId: "slot-1", elementId: "el-1", kind: EditKind.GenericEdit, payload: { a: 1 }, updatedAt: 0 }],
    });

    expect(markup).toBe(
      [
        "<canvas-state>",
        "The user interacted with the canvas. Treat the following as authoritative",
        "current state for each item, overriding anything in your transcript:",
        "",
        '<canvas-edit kind="generic-edit" slot="slot-1" element="el-1">',
        '{"a":1}',
        "</canvas-edit>",
        "</canvas-state>",
        "",
      ].join("\n"),
    );
  });

  it("omits the element attribute when elementId is null", () => {
    const markup = renderInjectionMarkup({
      count: 1,
      entries: [{ slotId: "slot-2", elementId: null, kind: EditKind.PlanEdit, payload: {}, updatedAt: 0 }],
    });

    expect(markup).toContain('<canvas-edit kind="plan-edit" slot="slot-2">\n{}\n</canvas-edit>');
    expect(markup).not.toContain("element=");
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
