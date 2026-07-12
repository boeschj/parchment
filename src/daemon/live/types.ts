// Live data source model. One schema serves three layers: the canvas_live
// MCP tool (zod inputSchema), the daemon's PUT /live route (revalidation),
// and the engine (normalized, JSON-serializable configs persisted to disk).

import * as z from "zod/v4";

export const LiveSourceKind = {
  FileTail: "file-tail",
  CommandPoll: "command-poll",
  HttpPoll: "http-poll",
  ClaudeSessions: "claude-sessions",
} as const;

export type LiveSourceKind = (typeof LiveSourceKind)[keyof typeof LiveSourceKind];

export const TailLineParser = {
  Jsonl: "jsonl",
  Regex: "regex",
  Number: "number",
} as const;

export type TailLineParser = (typeof TailLineParser)[keyof typeof TailLineParser];

export const LiveApplyMode = {
  Append: "append",
  Replace: "replace",
} as const;

export type LiveApplyMode = (typeof LiveApplyMode)[keyof typeof LiveApplyMode];

export const MIN_POLL_INTERVAL_SECONDS = 1;
export const MIN_CLAUDE_SESSIONS_INTERVAL_SECONDS = 2;
export const DEFAULT_POLL_INTERVAL_SECONDS = 5;
export const DEFAULT_WINDOW_POINTS = 300;
export const MAX_WINDOW_POINTS = 5000;
export const DEFAULT_FLEET_SINCE_HOURS = 24;
export const DEFAULT_FLEET_SESSION_LIMIT = 25;
export const MAX_FLEET_SESSION_LIMIT = 200;

const MS_PER_SECOND = 1000;

export const LiveSourceInputSchema = z.object({
  id: z.string().min(1).describe("Stable source id within the slot."),
  statePath: z
    .string()
    .regex(/^\//, "statePath must be a JSON Pointer starting with /")
    .describe("JSON Pointer into slot state this source writes, e.g. '/series'."),
  kind: z.enum([
    LiveSourceKind.FileTail,
    LiveSourceKind.CommandPoll,
    LiveSourceKind.HttpPoll,
    LiveSourceKind.ClaudeSessions,
  ]),
  path: z.string().optional().describe("file-tail: absolute file path."),
  parser: z
    .enum([TailLineParser.Jsonl, TailLineParser.Regex, TailLineParser.Number])
    .optional()
    .describe("file-tail parser; regex needs pattern."),
  pattern: z.string().optional().describe("file-tail regex: JS regex, named groups."),
  command: z.string().optional().describe("command-poll: shell command."),
  url: z.string().optional().describe("http-poll: http(s) URL."),
  pluck: z.string().optional().describe("Dot path plucked from each value, e.g. 'data.cpu'."),
  intervalSeconds: z.number().optional().describe("Poll cadence seconds; default 5."),
  mode: z
    .enum([LiveApplyMode.Append, LiveApplyMode.Replace])
    .optional()
    .describe("append onto array (default file-tail) or replace path."),
  window: z.number().int().positive().optional().describe("append: keep last N points. Default 300."),
  sinceHours: z.number().positive().optional().describe("claude-sessions window hours. Default 24."),
  limit: z.number().int().positive().optional().describe("claude-sessions max sessions. Default 25."),
});

export type LiveSourceInput = z.infer<typeof LiveSourceInputSchema>;

type SourceIdentity = {
  id: string;
  statePath: string;
};

export type FileTailSourceConfig = SourceIdentity & {
  kind: typeof LiveSourceKind.FileTail;
  path: string;
  parser: TailLineParser;
  pattern: string | null;
  pluck: string | null;
  mode: LiveApplyMode;
  window: number;
};

export type CommandPollSourceConfig = SourceIdentity & {
  kind: typeof LiveSourceKind.CommandPoll;
  command: string;
  pluck: string | null;
  intervalMs: number;
  mode: LiveApplyMode;
  window: number;
};

export type HttpPollSourceConfig = SourceIdentity & {
  kind: typeof LiveSourceKind.HttpPoll;
  url: string;
  pluck: string | null;
  intervalMs: number;
  mode: LiveApplyMode;
  window: number;
};

export type ClaudeSessionsSourceConfig = SourceIdentity & {
  kind: typeof LiveSourceKind.ClaudeSessions;
  intervalMs: number;
  sinceHours: number;
  limit: number;
};

export type LiveSourceConfig =
  | FileTailSourceConfig
  | CommandPollSourceConfig
  | HttpPollSourceConfig
  | ClaudeSessionsSourceConfig;

export type NormalizeSourceResult =
  | { ok: true; config: LiveSourceConfig }
  | { ok: false; error: string };

// Sources report transient failures (bad command, unreachable URL) here so
// the engine can surface them on GET /live instead of poisoning slot state.
// null clears the previous error after a healthy run.
export type SourceErrorReporter = (message: string | null) => void;

export function normalizeLiveSource(input: LiveSourceInput): NormalizeSourceResult {
  switch (input.kind) {
    case LiveSourceKind.FileTail:
      return normalizeFileTail(input);
    case LiveSourceKind.CommandPoll:
      return normalizeCommandPoll(input);
    case LiveSourceKind.HttpPoll:
      return normalizeHttpPoll(input);
    case LiveSourceKind.ClaudeSessions:
      return normalizeClaudeSessions(input);
  }
}

function normalizeFileTail(input: LiveSourceInput): NormalizeSourceResult {
  if (!input.path) {
    return invalid(input, "file-tail requires `path`");
  }
  const parser = input.parser ?? TailLineParser.Jsonl;
  if (parser === TailLineParser.Regex && !input.pattern) {
    return invalid(input, "parser 'regex' requires `pattern` with named groups");
  }
  if (input.pattern) {
    const compileError = regexCompileError(input.pattern);
    if (compileError) return invalid(input, `invalid pattern: ${compileError}`);
  }
  return {
    ok: true,
    config: {
      kind: LiveSourceKind.FileTail,
      id: input.id,
      statePath: input.statePath,
      path: input.path,
      parser,
      pattern: input.pattern ?? null,
      pluck: input.pluck ?? null,
      mode: input.mode ?? LiveApplyMode.Append,
      window: clampWindow(input.window),
    },
  };
}

function normalizeCommandPoll(input: LiveSourceInput): NormalizeSourceResult {
  if (!input.command) {
    return invalid(input, "command-poll requires `command`");
  }
  return {
    ok: true,
    config: {
      kind: LiveSourceKind.CommandPoll,
      id: input.id,
      statePath: input.statePath,
      command: input.command,
      pluck: input.pluck ?? null,
      intervalMs: clampIntervalMs(input.intervalSeconds, MIN_POLL_INTERVAL_SECONDS),
      mode: input.mode ?? LiveApplyMode.Replace,
      window: clampWindow(input.window),
    },
  };
}

function normalizeHttpPoll(input: LiveSourceInput): NormalizeSourceResult {
  if (!input.url) {
    return invalid(input, "http-poll requires `url`");
  }
  if (!isHttpUrl(input.url)) {
    return invalid(input, "http-poll `url` must be http:// or https://");
  }
  return {
    ok: true,
    config: {
      kind: LiveSourceKind.HttpPoll,
      id: input.id,
      statePath: input.statePath,
      url: input.url,
      pluck: input.pluck ?? null,
      intervalMs: clampIntervalMs(input.intervalSeconds, MIN_POLL_INTERVAL_SECONDS),
      mode: input.mode ?? LiveApplyMode.Replace,
      window: clampWindow(input.window),
    },
  };
}

function normalizeClaudeSessions(input: LiveSourceInput): NormalizeSourceResult {
  return {
    ok: true,
    config: {
      kind: LiveSourceKind.ClaudeSessions,
      id: input.id,
      statePath: input.statePath,
      intervalMs: clampIntervalMs(input.intervalSeconds, MIN_CLAUDE_SESSIONS_INTERVAL_SECONDS),
      sinceHours: input.sinceHours ?? DEFAULT_FLEET_SINCE_HOURS,
      limit: Math.min(input.limit ?? DEFAULT_FLEET_SESSION_LIMIT, MAX_FLEET_SESSION_LIMIT),
    },
  };
}

function invalid(input: LiveSourceInput, message: string): NormalizeSourceResult {
  return { ok: false, error: `source '${input.id}': ${message}` };
}

function clampIntervalMs(intervalSeconds: number | undefined, minSeconds: number): number {
  const requested = intervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS;
  return Math.max(requested, minSeconds) * MS_PER_SECOND;
}

function clampWindow(window: number | undefined): number {
  const requested = window ?? DEFAULT_WINDOW_POINTS;
  return Math.min(requested, MAX_WINDOW_POINTS);
}

function isHttpUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function regexCompileError(pattern: string): string | null {
  try {
    new RegExp(pattern);
    return null;
  } catch (caught) {
    return caught instanceof Error ? caught.message : String(caught);
  }
}
