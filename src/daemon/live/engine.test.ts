import { describe, it, expect, mock } from "bun:test";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SlotKind, SlotOrigin, type JsonRenderSpec, type WsEvent } from "../../shared/types.ts";
import type { WebSocketSubscriber } from "../sessions.ts";
import {
  LiveApplyMode,
  LiveSourceKind,
  TailLineParser,
  type FileTailSourceConfig,
} from "./types.ts";

// Same homedir redirection as slots.test.ts: state.ts resolves ~/.parchment at
// module load, so node:os must be mocked before the daemon modules load.
const fakeHome = mkdtempSync(join(tmpdir(), "parchment-live-"));
const realOs = await import("node:os");
mock.module("node:os", () => ({ ...realOs, homedir: () => fakeHome }));

const { upsertSlot, removeSlot } = await import("../slots.ts");
const { ensureSession } = await import("../sessions.ts");
const { loadPersistedLiveSources } = await import("../session-store.ts");
const { setSlotLiveSources, stopSlotLiveSources, listSessionLiveSources, stopAllLiveSources } =
  await import("./engine.ts");

const WAIT_TIMEOUT_MS = 4000;
const WAIT_POLL_MS = 25;

async function waitFor(what: string, predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > WAIT_TIMEOUT_MS) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await Bun.sleep(WAIT_POLL_MS);
  }
}

function uniqueSessionId(): string {
  return `live-test-${randomUUID()}`;
}

function dashboardSpec(state: Record<string, unknown>): JsonRenderSpec {
  return {
    root: "root",
    elements: { root: { type: "Box", props: {} } },
    state,
  };
}

function createDashboard(sessionId: string, state: Record<string, unknown>) {
  return upsertSlot({
    sessionId,
    kind: SlotKind.Dashboard,
    title: "Live",
    spec: dashboardSpec(state),
    origin: SlotOrigin.McpTool,
  });
}

function fileTailConfig(
  overrides: Partial<FileTailSourceConfig> & { path: string },
): FileTailSourceConfig {
  return {
    kind: LiveSourceKind.FileTail,
    id: "tail",
    statePath: "/series",
    parser: TailLineParser.Jsonl,
    pattern: null,
    pluck: null,
    mode: LiveApplyMode.Append,
    window: 5,
    ...overrides,
  };
}

function subscriberRecording(frames: WsEvent[]): WebSocketSubscriber {
  return {
    sessionId: "recorder",
    send: (raw: string) => frames.push(JSON.parse(raw) as WsEvent),
  };
}

function seriesOf(sessionId: string, slotId: string): unknown[] {
  const slot = ensureSession(sessionId).slots.find((candidate) => candidate.id === slotId);
  const series = slot?.state["series"];
  return Array.isArray(series) ? series : [];
}

function timestampOf(point: unknown): number | null {
  const isRecord = typeof point === "object" && point !== null;
  if (!isRecord) return null;
  const timestamp = (point as Record<string, unknown>)["t"];
  return typeof timestamp === "number" ? timestamp : null;
}

describe("file-tail source", () => {
  it("streams only NEW lines into slot state, bounded by the window", async () => {
    const sessionId = uniqueSessionId();
    const slot = createDashboard(sessionId, { series: [] });
    const logPath = join(fakeHome, `tail-${randomUUID()}.log`);
    writeFileSync(logPath, '{"t":1,"value":-1}\n');

    const frames: WsEvent[] = [];
    ensureSession(sessionId).subscribers.add(subscriberRecording(frames));

    setSlotLiveSources(sessionId, slot.id, [fileTailConfig({ path: logPath })]);
    try {
      appendFileSync(logPath, '{"t":2,"value":20}\n{"t":3,"value":30}\n');
      await waitFor("first two points", () => seriesOf(sessionId, slot.id).length === 2);

      const preexistingLineLeaked = seriesOf(sessionId, slot.id).some(
        (point) => timestampOf(point) === 1,
      );
      expect(preexistingLineLeaked).toBe(false);

      const burst = Array.from({ length: 8 }, (_, i) => `{"t":${10 + i},"value":${i}}`).join("\n");
      appendFileSync(logPath, `${burst}\n`);
      await waitFor(
        "window trim",
        () =>
          seriesOf(sessionId, slot.id).length === 5 &&
          timestampOf(seriesOf(sessionId, slot.id)[4]) === 17,
      );

      const stateFrames = frames.filter((frame) => frame.kind === "slot-state");
      expect(stateFrames.length).toBeGreaterThan(0);
    } finally {
      stopSlotLiveSources(sessionId, slot.id);
    }
  });

  it("supports replace mode with a pluck into each parsed line", async () => {
    const sessionId = uniqueSessionId();
    const slot = createDashboard(sessionId, { latest: 0 });
    const logPath = join(fakeHome, `latest-${randomUUID()}.log`);
    writeFileSync(logPath, "");

    setSlotLiveSources(sessionId, slot.id, [
      fileTailConfig({
        path: logPath,
        id: "latest",
        statePath: "/latest",
        pluck: "value",
        mode: LiveApplyMode.Replace,
      }),
    ]);
    try {
      appendFileSync(logPath, '{"value":7}\n{"value":9}\n');
      await waitFor("replace value", () => {
        const slotNow = ensureSession(sessionId).slots.find((c) => c.id === slot.id);
        return slotNow?.state["latest"] === 9;
      });
    } finally {
      stopSlotLiveSources(sessionId, slot.id);
    }
  });
});

describe("command-poll source", () => {
  it("runs immediately and applies parsed stdout", async () => {
    const sessionId = uniqueSessionId();
    const slot = createDashboard(sessionId, { answer: 0 });

    setSlotLiveSources(sessionId, slot.id, [
      {
        kind: LiveSourceKind.CommandPoll,
        id: "answer",
        statePath: "/answer",
        command: "printf 42",
        pluck: null,
        intervalMs: 60_000,
        mode: LiveApplyMode.Replace,
        window: 5,
      },
    ]);
    try {
      await waitFor("command output applied", () => {
        const slotNow = ensureSession(sessionId).slots.find((c) => c.id === slot.id);
        return slotNow?.state["answer"] === 42;
      });
    } finally {
      stopSlotLiveSources(sessionId, slot.id);
    }
  });
});

describe("reference-refresh source", () => {
  it("re-hydrates a watched file into slot state and restamps its provenance", async () => {
    const sessionId = uniqueSessionId();
    const slot = createDashboard(sessionId, { hydrated: {}, hydratedMeta: {} });
    const watchedPath = join(fakeHome, `watched-${randomUUID()}.ts`);
    writeFileSync(watchedPath, "const version = 1;\n");

    setSlotLiveSources(sessionId, slot.id, [
      {
        kind: LiveSourceKind.ReferenceRefresh,
        id: "snippet__code",
        statePath: "/hydrated/snippet__code",
        metaStatePath: "/hydratedMeta/snippet__code",
        watchPath: watchedPath,
        target: { kind: "file", absPath: watchedPath, lines: null },
      },
    ]);
    try {
      const hydratedCode = (): unknown => {
        const current = ensureSession(sessionId).slots.find((c) => c.id === slot.id);
        const hydrated = current?.state["hydrated"];
        return isRecord(hydrated) ? hydrated["snippet__code"] : undefined;
      };
      const hydratedMode = (): unknown => {
        const current = ensureSession(sessionId).slots.find((c) => c.id === slot.id);
        const meta = current?.state["hydratedMeta"];
        const entry = isRecord(meta) ? meta["snippet__code"] : undefined;
        return isRecord(entry) ? entry["mode"] : undefined;
      };

      await waitFor("initial hydration", () => hydratedCode() === "const version = 1;\n");
      expect(hydratedMode()).toBe("live");

      writeFileSync(watchedPath, "const version = 2;\nconst added = true;\n");
      await waitFor("refresh after edit", () =>
        String(hydratedCode() ?? "").includes("added = true"),
      );
    } finally {
      stopSlotLiveSources(sessionId, slot.id);
    }
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("source lifecycle", () => {
  it("replaces a slot's sources wholesale and persists the bindings", () => {
    const sessionId = uniqueSessionId();
    const slot = createDashboard(sessionId, {});
    const logPath = join(fakeHome, `lifecycle-${randomUUID()}.log`);
    writeFileSync(logPath, "");

    setSlotLiveSources(sessionId, slot.id, [fileTailConfig({ path: logPath })]);
    expect(listSessionLiveSources(sessionId)).toHaveLength(1);
    expect(Object.keys(loadPersistedLiveSources(sessionId).slots)).toEqual([slot.id]);

    setSlotLiveSources(sessionId, slot.id, [
      fileTailConfig({ path: logPath, id: "a", statePath: "/a" }),
      fileTailConfig({ path: logPath, id: "b", statePath: "/b" }),
    ]);
    const ids = listSessionLiveSources(sessionId).map((view) => view.config.id);
    expect(ids.sort()).toEqual(["a", "b"]);

    setSlotLiveSources(sessionId, slot.id, []);
    expect(listSessionLiveSources(sessionId)).toHaveLength(0);
    expect(loadPersistedLiveSources(sessionId).slots).toEqual({});
  });

  it("stops a slot's sources when the slot is removed", () => {
    const sessionId = uniqueSessionId();
    const slot = createDashboard(sessionId, {});
    const logPath = join(fakeHome, `close-${randomUUID()}.log`);
    writeFileSync(logPath, "");

    setSlotLiveSources(sessionId, slot.id, [fileTailConfig({ path: logPath })]);
    expect(listSessionLiveSources(sessionId)).toHaveLength(1);

    removeSlot(sessionId, slot.id);
    expect(listSessionLiveSources(sessionId)).toHaveLength(0);
    expect(loadPersistedLiveSources(sessionId).slots).toEqual({});
  });

  it("stopAllLiveSources clears every running source", () => {
    const sessionId = uniqueSessionId();
    const slot = createDashboard(sessionId, {});
    const logPath = join(fakeHome, `all-${randomUUID()}.log`);
    writeFileSync(logPath, "");

    setSlotLiveSources(sessionId, slot.id, [fileTailConfig({ path: logPath })]);
    stopAllLiveSources();
    expect(listSessionLiveSources(sessionId)).toHaveLength(0);
  });
});
