import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as z from "zod/v4";
import { STATE_DIR } from "../state.ts";

// App servers are USER-CONFIGURED, never auto-installed: this file only ever
// records commands/URLs the user (or their agent, on their behalf) explicitly
// supplied. The daemon executes exactly what is written here and nothing else.
export const APPS_CONFIG_FILE = join(STATE_DIR, "apps.json");

const StdioAppServerSchema = z
  .strictObject({
    command: z.string().min(1).describe("Executable that starts the MCP app server over stdio."),
    args: z.array(z.string()).default([]),
    env: z
      .record(z.string(), z.string())
      .default({})
      .describe("Literal environment variables passed to the server process."),
    inheritEnv: z
      .array(z.string())
      .default([])
      .describe("Names of daemon environment variables forwarded to the server (allowlist)."),
  })
  .describe("Local stdio MCP app server.");

const HttpAppServerSchema = z
  .strictObject({
    url: z.url().describe("Streamable-HTTP endpoint of a remote MCP app server."),
  })
  .describe("Remote HTTP MCP app server.");

const AppServerSchema = z.union([StdioAppServerSchema, HttpAppServerSchema]);

const AppsConfigSchema = z.object({
  servers: z.record(z.string(), AppServerSchema).default({}),
});

export type StdioAppServerConfig = z.infer<typeof StdioAppServerSchema>;
export type HttpAppServerConfig = z.infer<typeof HttpAppServerSchema>;
export type AppServerConfig = z.infer<typeof AppServerSchema>;
export type AppsConfig = z.infer<typeof AppsConfigSchema>;

export function isStdioAppServer(config: AppServerConfig): config is StdioAppServerConfig {
  return "command" in config;
}

export function parseAppsConfig(raw: string): AppsConfig {
  const json = parseJsonOrThrow(raw);
  const parsed = AppsConfigSchema.safeParse(json);
  if (!parsed.success) {
    const issueLines = parsed.error.issues
      .map((issue) => `- ${issue.path.join("/") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`invalid apps.json:\n${issueLines}`);
  }
  return parsed.data;
}

// The *From/*To variants take an explicit file path so tests exercise the
// real read/write logic against a temp file — never the user's apps.json.

export function loadAppsConfigFrom(file: string): AppsConfig {
  if (!existsSync(file)) return { servers: {} };
  return parseAppsConfig(readFileSync(file, "utf8"));
}

export function loadAppsConfig(): AppsConfig {
  return loadAppsConfigFrom(APPS_CONFIG_FILE);
}

export function resolveAppServer(name: string): AppServerConfig | null {
  const config = loadAppsConfig();
  return config.servers[name] ?? null;
}

export function listAppServerNames(): string[] {
  return Object.keys(loadAppsConfig().servers);
}

// Accepts unknown so HTTP/tool boundaries can hand the payload straight in;
// the schema is the gatekeeper.
export function saveAppServerTo(file: string, name: string, server: unknown): void {
  const parsed = AppServerSchema.safeParse(server);
  if (!parsed.success) {
    const issueLines = parsed.error.issues
      .map((issue) => `- ${issue.path.join("/") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`invalid app server config for "${name}":\n${issueLines}`);
  }
  const config = loadAppsConfigFrom(file);
  config.servers[name] = parsed.data;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}

export function saveAppServer(name: string, server: unknown): void {
  saveAppServerTo(APPS_CONFIG_FILE, name, server);
}

// Environment for a stdio app server: a minimal safe base (never the full
// daemon environment), plus explicitly allowlisted inherited names, plus
// literal values from the config. Literals win.
const SAFE_BASE_ENV_VARS = ["PATH", "HOME", "USER", "SHELL", "TMPDIR", "LANG", "TERM"] as const;

export function buildStdioEnv(config: StdioAppServerConfig): Record<string, string> {
  const inheritedNames = [...SAFE_BASE_ENV_VARS, ...config.inheritEnv];
  const inherited = Object.fromEntries(
    inheritedNames
      .map((name) => [name, process.env[name]] as const)
      .filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return { ...inherited, ...config.env };
}

function parseJsonOrThrow(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    throw new Error(`apps.json is not valid JSON: ${message}`);
  }
}
