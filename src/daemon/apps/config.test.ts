import { describe, it, expect, mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// config.ts derives APPS_CONFIG_FILE from STATE_DIR (homedir-based, computed
// at module load), so node:os must be mocked before the import chain runs —
// same pattern as edits.test.ts / slots.test.ts.
const fakeHome = mkdtempSync(join(tmpdir(), "clawd-canvas-apps-config-"));
const realOs = await import("node:os");
mock.module("node:os", () => ({ ...realOs, homedir: () => fakeHome }));

const {
  parseAppsConfig,
  buildStdioEnv,
  isStdioAppServer,
  saveAppServer,
  resolveAppServer,
  listAppServerNames,
} = await import("./config.ts");

describe("parseAppsConfig", () => {
  it("parses a stdio server with defaults for args/env/inheritEnv", () => {
    const config = parseAppsConfig(
      JSON.stringify({ servers: { hello: { command: "bun" } } }),
    );

    const hello = config.servers["hello"];
    expect(hello).toEqual({ command: "bun", args: [], env: {}, inheritEnv: [] });
  });

  it("parses an http server", () => {
    const config = parseAppsConfig(
      JSON.stringify({ servers: { remote: { url: "http://localhost:3100/mcp" } } }),
    );

    expect(config.servers["remote"]).toEqual({ url: "http://localhost:3100/mcp" });
  });

  it("defaults to an empty server map", () => {
    expect(parseAppsConfig("{}")).toEqual({ servers: {} });
  });

  it("rejects invalid JSON with a readable error", () => {
    expect(() => parseAppsConfig("{nope")).toThrow("not valid JSON");
  });

  it("rejects a server with neither command nor url", () => {
    expect(() =>
      parseAppsConfig(JSON.stringify({ servers: { broken: { args: ["x"] } } })),
    ).toThrow("invalid apps.json");
  });

  it("rejects an empty command", () => {
    expect(() =>
      parseAppsConfig(JSON.stringify({ servers: { broken: { command: "" } } })),
    ).toThrow("invalid apps.json");
  });

  it("rejects a non-url url", () => {
    expect(() =>
      parseAppsConfig(JSON.stringify({ servers: { broken: { url: "not a url" } } })),
    ).toThrow("invalid apps.json");
  });

  it("rejects unknown keys so typos surface instead of being ignored", () => {
    expect(() =>
      parseAppsConfig(JSON.stringify({ servers: { broken: { command: "bun", cmd: "typo" } } })),
    ).toThrow("invalid apps.json");
  });

  it("rejects non-string env values", () => {
    expect(() =>
      parseAppsConfig(
        JSON.stringify({ servers: { broken: { command: "bun", env: { PORT: 3000 } } } }),
      ),
    ).toThrow("invalid apps.json");
  });
});

describe("buildStdioEnv", () => {
  it("forwards only the safe base vars plus the configured allowlist", () => {
    process.env.PARCHMENT_TEST_SECRET = "should-not-leak";
    process.env.PARCHMENT_TEST_ALLOWED = "forwarded";

    const env = buildStdioEnv({
      command: "bun",
      args: [],
      env: {},
      inheritEnv: ["PARCHMENT_TEST_ALLOWED"],
    });

    expect(env.PARCHMENT_TEST_ALLOWED).toBe("forwarded");
    expect(env.PARCHMENT_TEST_SECRET).toBeUndefined();
    expect(env.PATH).toBe(process.env.PATH as string);
  });

  it("lets literal env values override inherited ones", () => {
    const env = buildStdioEnv({
      command: "bun",
      args: [],
      env: { HOME: "/custom/home" },
      inheritEnv: [],
    });

    expect(env.HOME).toBe("/custom/home");
  });

  it("skips allowlisted names that are unset in the daemon environment", () => {
    const env = buildStdioEnv({
      command: "bun",
      args: [],
      env: {},
      inheritEnv: ["PARCHMENT_DEFINITELY_UNSET_VAR"],
    });

    expect("PARCHMENT_DEFINITELY_UNSET_VAR" in env).toBe(false);
  });
});

describe("apps.json round-trip", () => {
  it("saves and resolves a server by name", () => {
    saveAppServer("roundtrip", { command: "bun", args: ["server.ts"], env: {}, inheritEnv: [] });

    const resolved = resolveAppServer("roundtrip");
    expect(resolved).not.toBeNull();
    expect(isStdioAppServer(resolved!)).toBe(true);
    expect(listAppServerNames()).toContain("roundtrip");
  });

  it("returns null for unknown server names", () => {
    expect(resolveAppServer("never-configured")).toBeNull();
  });
});
