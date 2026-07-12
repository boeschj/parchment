import { test, expect, mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// sessions.ts transitively imports session-store.ts -> state.ts, and state.ts
// computes STATE_DIR = join(homedir(), ".parchment") once, at module-load
// time. Bun caches modules by resolved path across every test file in a
// `bun test` run — a static, unmocked import here (as this file previously
// had) evaluates state.ts against the REAL homedir() before any other test
// file's own mock.module call can take effect, silently pinning STATE_DIR to
// the user's real ~/.parchment for every other daemon test in the same run.
// The dynamic-import-after-mock pattern (see slots.test.ts / edits.test.ts)
// avoids that: this file's own fake home wins only if it mocks and imports
// before anything else does, which every daemon test file must now do.
const fakeHome = mkdtempSync(join(tmpdir(), "clawd-canvas-sessions-"));
const realOs = await import("node:os");
mock.module("node:os", () => ({ ...realOs, homedir: () => fakeHome }));

const { activateSession, getSession } = await import("./sessions.ts");

// Regression coverage for the /clear misattribution fix. /api/sessions/active
// filters candidate sessions by cwd and then picks the highest lastPing, so a
// session started by /clear only wins if activation (1) stamps its cwd and
// (2) gives it a fresh lastPing. Both invariants are asserted here.

test("activateSession stamps the session cwd so cwd-scoped resolution can include it", () => {
  const session = activateSession("test-activate-cwd-0001", "/proj/x");
  expect(session.cwd).toBe("/proj/x");
  expect(getSession("test-activate-cwd-0001")?.cwd).toBe("/proj/x");
});

test("re-activating with a cwd fills in a previously empty cwd", () => {
  const sessionId = "test-activate-cwd-0002";
  activateSession(sessionId, "");
  expect(getSession(sessionId)?.cwd).toBe("");
  activateSession(sessionId, "/proj/y");
  expect(getSession(sessionId)?.cwd).toBe("/proj/y");
});

test("a later activation outranks an earlier same-cwd one by lastPing", async () => {
  const olderSessionId = "test-clear-older-0003";
  const newerSessionId = "test-clear-newer-0003";
  activateSession(olderSessionId, "/proj/z");
  await Bun.sleep(2);
  activateSession(newerSessionId, "/proj/z");

  const olderPing = getSession(olderSessionId)!.lastPing;
  const newerPing = getSession(newerSessionId)!.lastPing;
  expect(newerPing).toBeGreaterThan(olderPing);
});
