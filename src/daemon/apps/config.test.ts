import { describe, it, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseAppsConfig,
  buildStdioEnv,
  isStdioAppServer,
  saveAppServerTo,
  loadAppsConfigFrom,
} from "./config.ts";

// Round-trip tests use the explicit-path variants against a temp file — the
// bun-test node:os homedir mock is unreliable across multi-file runs and has
// leaked test writes into the real ~/.parchment before.
const tempConfigDir = mkdtempSync(join(tmpdir(), "parchment-apps-config-"));
const tempConfigFile = join(tempConfigDir, "apps.json");

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
  it("saves and reloads a server by name", () => {
    saveAppServerTo(tempConfigFile, "roundtrip", {
      command: "bun",
      args: ["server.ts"],
      env: {},
      inheritEnv: [],
    });

    const reloaded = loadAppsConfigFrom(tempConfigFile);
    const server = reloaded.servers["roundtrip"];
    expect(server).toBeDefined();
    expect(isStdioAppServer(server!)).toBe(true);
  });

  it("preserves existing entries when saving another server", () => {
    saveAppServerTo(tempConfigFile, "second", { url: "http://localhost:3100/mcp" });

    const reloaded = loadAppsConfigFrom(tempConfigFile);
    expect(Object.keys(reloaded.servers).sort()).toEqual(["roundtrip", "second"]);
  });

  it("rejects invalid registration payloads", () => {
    expect(() => saveAppServerTo(tempConfigFile, "broken", { nope: true })).toThrow(
      'invalid app server config for "broken"',
    );
  });

  it("returns an empty config for a missing file", () => {
    expect(loadAppsConfigFrom(join(tempConfigDir, "absent.json"))).toEqual({ servers: {} });
  });
});
