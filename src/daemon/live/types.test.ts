import { describe, it, expect } from "bun:test";
import {
  DEFAULT_FLEET_SESSION_LIMIT,
  DEFAULT_FLEET_SINCE_HOURS,
  DEFAULT_WINDOW_POINTS,
  LiveApplyMode,
  LiveSourceKind,
  MAX_WINDOW_POINTS,
  normalizeLiveSource,
  TailLineParser,
  type LiveSourceInput,
} from "./types.ts";

function baseInput(overrides: Partial<LiveSourceInput>): LiveSourceInput {
  return {
    id: "src",
    statePath: "/series",
    kind: LiveSourceKind.FileTail,
    ...overrides,
  };
}

describe("normalizeLiveSource file-tail", () => {
  it("defaults to jsonl parser, append mode, and the standard window", () => {
    const result = normalizeLiveSource(baseInput({ path: "/tmp/x.log" }));
    if (!result.ok) throw new Error(result.error);
    expect(result.config).toMatchObject({
      kind: LiveSourceKind.FileTail,
      parser: TailLineParser.Jsonl,
      mode: LiveApplyMode.Append,
      window: DEFAULT_WINDOW_POINTS,
    });
  });

  it("rejects a missing path", () => {
    const result = normalizeLiveSource(baseInput({}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("path");
  });

  it("rejects regex parser without a pattern, and uncompilable patterns", () => {
    const noPattern = normalizeLiveSource(
      baseInput({ path: "/tmp/x.log", parser: TailLineParser.Regex }),
    );
    expect(noPattern.ok).toBe(false);

    const badPattern = normalizeLiveSource(
      baseInput({ path: "/tmp/x.log", parser: TailLineParser.Regex, pattern: "([" }),
    );
    expect(badPattern.ok).toBe(false);
  });

  it("caps window at the maximum", () => {
    const result = normalizeLiveSource(baseInput({ path: "/tmp/x.log", window: 999_999 }));
    if (!result.ok) throw new Error(result.error);
    expect(result.config).toMatchObject({ window: MAX_WINDOW_POINTS });
  });
});

describe("normalizeLiveSource polls", () => {
  it("floors command-poll cadence at one second and defaults to replace", () => {
    const result = normalizeLiveSource(
      baseInput({ kind: LiveSourceKind.CommandPoll, command: "echo 1", intervalSeconds: 0.05 }),
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.config).toMatchObject({ intervalMs: 1000, mode: LiveApplyMode.Replace });
  });

  it("rejects command-poll without a command", () => {
    expect(normalizeLiveSource(baseInput({ kind: LiveSourceKind.CommandPoll })).ok).toBe(false);
  });

  it("rejects non-http urls", () => {
    const result = normalizeLiveSource(
      baseInput({ kind: LiveSourceKind.HttpPoll, url: "file:///etc/passwd" }),
    );
    expect(result.ok).toBe(false);
  });

  it("accepts an https url", () => {
    const result = normalizeLiveSource(
      baseInput({ kind: LiveSourceKind.HttpPoll, url: "https://example.test/metrics" }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("normalizeLiveSource claude-sessions", () => {
  it("applies fleet defaults and floors the cadence at two seconds", () => {
    const result = normalizeLiveSource(
      baseInput({ kind: LiveSourceKind.ClaudeSessions, intervalSeconds: 1 }),
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.config).toMatchObject({
      intervalMs: 2000,
      sinceHours: DEFAULT_FLEET_SINCE_HOURS,
      limit: DEFAULT_FLEET_SESSION_LIMIT,
    });
  });
});
