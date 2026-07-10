import { test, expect } from "bun:test";
import { activateSession, getSession } from "./sessions.ts";

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
