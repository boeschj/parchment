// One headless `claude -p` attempt, for any arm.
//
// THE TOOL SURFACE IS THE EXPERIMENT'S CONTROL. Every arm must get exactly the
// tools its authoring surface needs and not one more, or a token comparison
// between arms is comparing harnesses instead of formats. Two facts, both
// learned the hard way in bench/claude-cli.ts, decide how that is enforced:
//
//   1. Under --permission-mode bypassPermissions, --allowedTools is only a
//      PRE-APPROVAL. It does not restrict. A model handed an MCP server will
//      happily call canvas_snapshot after its render, burn a turn, and fail.
//      --disallowedTools DOES restrict under bypass, so every tool an arm is
//      not granted is named explicitly. The deny list is DERIVED from the full
//      known surface (KNOWN_TOOLS minus granted), so adding a tool to the
//      catalog can never silently reopen a hole here.
//   2. --bare is not an option: it forces ANTHROPIC_API_KEY auth and fails
//      outright on an OAuth subscription login. --setting-sources "" achieves
//      the actual goal — keeping the operator's personal CLAUDE.md, memory, and
//      project settings out of the measured token counts — without breaking
//      auth. The remaining input is the fixed Claude Code harness constant,
//      which ledger.ts MEASURES rather than assumes.

import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { BlockKind, TraceEntryKind, type ContentBlock, type TraceEntry } from "@boeschj/claude-jsonl";
import { CanvasTool } from "../bench/config.ts";
import {
  CANVAS_MCP_SERVER_KEY,
  CANVAS_RENDER_TOOL,
  writeEvalCanvasMcpConfig,
} from "./mcp/config.ts";
import { locateSessionJsonl } from "../bench/session-locator.ts";
import { readTranscriptEntries } from "../bench/metrics/read-transcript.ts";
import { EvalPaths, RUN_TIMEOUT_MS } from "./config.ts";
import type { EvalDaemon } from "./daemon.ts";
import {
  AuthoringSurface,
  type Arm,
  type ArmId,
  type AuthoredArtifact,
  type EvalModel,
  type EvalScenario,
} from "./types.ts";

// ---- The tool surface -------------------------------------------------------

// Claude Code's built-in tools this eval knows about. Anything not granted to an
// arm is denied by name (see the bypassPermissions note above), so this list is
// the eval's statement of the complete surface a run could otherwise reach.
const BuiltInTool = {
  Read: "Read",
  Glob: "Glob",
  Grep: "Grep",
  Write: "Write",
  Edit: "Edit",
  Bash: "Bash",
  BashOutput: "BashOutput",
  KillShell: "KillShell",
  NotebookEdit: "NotebookEdit",
  Task: "Task",
  TodoWrite: "TodoWrite",
  WebFetch: "WebFetch",
  WebSearch: "WebSearch",
  SlashCommand: "SlashCommand",
} as const;

type BuiltInTool = (typeof BuiltInTool)[keyof typeof BuiltInTool];

// Ladder scenarios put real files on disk. A LOW-fidelity arm can only show a
// diff by pasting it, which means it must be able to READ it — denying Read
// would not measure "low fidelity costs more tokens", it would measure "we
// broke the control arm".
//
// Bash is granted for the same reason, and it is the more important half: the
// "before" side of a diff exists only in git history, so an arm without `git
// show HEAD~1:<file>` cannot obtain the content it is supposed to paste. It
// would then fail the headline scenario for lack of ACCESS rather than lack of
// EXPRESSIVENESS — a fake win for our own high-fidelity arm on the single
// number this eval exists to produce. Every arm gets the same read surface and
// the same git access; the ladder measures what an arm must EMIT, never what it
// is allowed to LOOK AT. Write is the only tool that separates the surfaces.
const READ_ONLY_TOOLS = [
  BuiltInTool.Read,
  BuiltInTool.Glob,
  BuiltInTool.Bash,
  BuiltInTool.BashOutput,
] as const;

// The eval's OWN canvas server (evals/mcp) is what the arm is wired to — it is
// the daemon parchment will have once the markup and hydration branches land.
// The tool name it exposes is the real one, so the model's surface is unchanged.
const CANVAS_TOOL_GRANTS = [CANVAS_RENDER_TOOL, ...READ_ONLY_TOOLS] as const;
const WRITTEN_FILE_GRANTS = [BuiltInTool.Write, ...READ_ONLY_TOOLS] as const;

const KNOWN_TOOLS: readonly string[] = [...Object.values(BuiltInTool), ...Object.values(CanvasTool)];

const GRANTS_BY_SURFACE = {
  [AuthoringSurface.CanvasTool]: CANVAS_TOOL_GRANTS,
  [AuthoringSurface.WrittenFile]: WRITTEN_FILE_GRANTS,
} as const satisfies Record<AuthoringSurface, readonly string[]>;

// ---- Retry policy -----------------------------------------------------------

// A subscription rate-limits. A model failing the task does not. Conflating the
// two is how an eval lies: retrying a genuine failure inflates the pass rate,
// and not retrying a 429 turns an infrastructure hiccup into a reported loss.
export const FailureKind = {
  None: "none",
  // The subscription said no. Wait a long time, retry, and RECORD that it happened.
  RateLimited: "rate-limited",
  // The CLI itself fell over (launch failure, network, 5xx, overloaded).
  Transient: "transient",
  // The model produced a bad artifact, refused, or ran out of turns. This is
  // DATA. Retrying it would be fabricating a result.
  TaskFailure: "task-failure",
} as const;

export type FailureKind = (typeof FailureKind)[keyof typeof FailureKind];

const RATE_LIMIT_PATTERNS = [
  /rate[_ -]?limit/i,
  /usage limit reached/i,
  /\b429\b/,
  /too many requests/i,
  /quota/i,
] as const;

const TRANSIENT_PATTERNS = [
  /overloaded/i,
  /\b5\d\d\b/,
  /internal server error/i,
  /service unavailable/i,
  /econnreset|etimedout|enotfound|socket hang up/i,
  /fetch failed|network error/i,
] as const;

const MAX_TRANSIENT_RETRIES = 4;
const TRANSIENT_BACKOFF_BASE_MS = 2_000;
const RATE_LIMIT_BACKOFF_BASE_MS = 60_000;
const BACKOFF_FACTOR = 2;
const MAX_BACKOFF_MS = 600_000;

// ---- Archiving --------------------------------------------------------------

const ATTEMPTS_ARCHIVE_FILENAME = "attempts.jsonl";
const ARCHIVE_RECORD_KIND = "eval-attempt";

// ---- Public surface ---------------------------------------------------------

export type ClaudeCliResult = {
  isError: boolean;
  numTurns: number;
  totalCostUsd: number;
  durationMs: number;
  sessionId: string;
  resultText: string;
};

export type RetryRecord = {
  retryIndex: number;
  kind: FailureKind;
  detail: string;
  waitedMs: number;
};

export type ArmAttemptOptions = {
  runId: string;
  // 0 is the authoring turn; 1..MAX_REPAIR_TURNS are repairs.
  attemptIndex: number;
  arm: Arm;
  scenario: EvalScenario;
  model: EvalModel;
  prompt: string;
  // The run's working directory. WrittenFile arms author into it.
  cwd: string;
  // Required for AuthoringSurface.CanvasTool; ignored otherwise.
  daemon: EvalDaemon | null;
  // Set on a repair turn: continue the prior turn's session so the model can
  // see what it wrote. A repair with no memory of the artifact is not a repair.
  resumeSessionId: string | null;
  // Assistant messages already attributed to earlier attempts. A resumed
  // session appends to ONE transcript file, so without this the repair turn
  // would re-read the authoring turn's tool calls as its own.
  previousMessageIds: ReadonlySet<string>;
};

export type ArmAttemptResult = {
  sessionId: string;
  transcriptPath: string | null;
  entries: readonly TraceEntry[];
  // null when the CLI never produced a parseable result (killed at the timeout,
  // or it died before writing stdout).
  cliResult: ClaudeCliResult | null;
  artifact: AuthoredArtifact | null;
  // The assistant message that carried the render tool call. THE HEADLINE METRIC
  // is that message's output tokens (ledger.ts): the cost of EMITTING the
  // artifact, isolated from the cost of exploring the repo to build it.
  authoringMessageId: string | null;
  // A model that rendered twice in one attempt is attributed to its LAST render —
  // the artifact the user would be looking at. The count is kept so a chatty
  // render loop cannot hide inside a single "authoring" number.
  renderCallCount: number;
  wallClockMs: number;
  timedOut: boolean;
  failureKind: FailureKind;
  retries: readonly RetryRecord[];
  argv: readonly string[];
  archivePath: string;
};

export async function runArmAttempt(options: ArmAttemptOptions): Promise<ArmAttemptResult> {
  const sessionId = options.resumeSessionId ?? randomUUID();
  const attemptDir = attemptDirFor(options);
  mkdirSync(attemptDir, { recursive: true });
  mkdirSync(options.cwd, { recursive: true });

  const argv = buildClaudeArgv({
    surface: options.arm.surface,
    armId: options.arm.id,
    systemPrompt: options.arm.systemPrompt,
    prompt: options.prompt,
    model: options.model,
    sessionId,
    resumeSessionId: options.resumeSessionId,
    daemon: options.daemon,
    mcpConfigDir: attemptDir,
  });
  const { invocation, retries } = await invokeWithBackoff(argv, options.cwd);

  const cliResult = parseCliResult(invocation.stdout);
  const transcriptSessionId = cliResult?.sessionId ?? sessionId;
  const transcript = readTranscriptSafely(transcriptSessionId);
  const authoring = extractAuthoredArtifact({
    entries: transcript.entries,
    surface: options.arm.surface,
    cwd: options.cwd,
    previousMessageIds: options.previousMessageIds,
  });

  const result: ArmAttemptResult = {
    sessionId: transcriptSessionId,
    transcriptPath: transcript.path,
    entries: transcript.entries,
    cliResult,
    artifact: authoring.artifact,
    authoringMessageId: authoring.authoringMessageId,
    renderCallCount: authoring.renderCallCount,
    wallClockMs: invocation.wallClockMs,
    timedOut: invocation.timedOut,
    failureKind: invocation.failureKind,
    retries,
    argv,
    archivePath: join(attemptDir, ATTEMPTS_ARCHIVE_FILENAME),
  };

  archiveAttempt(options, result, invocation);
  return result;
}

// ---- argv -------------------------------------------------------------------

// The argv is built from the SURFACE, never from the arm. Two arms on the same
// surface get byte-identical tool flags and therefore pay the same harness
// constant — which is what lets ledger.ts measure that constant once per surface
// with a probe that has no arm attached at all.
export type ClaudeArgvInput = {
  surface: AuthoringSurface;
  // The eval's canvas server must know which authoring vocabulary the document
  // will arrive in (scrambled aliases? terse structural keys?), so the arm id
  // travels with the --mcp-config rather than being guessed from the bytes.
  armId: ArmId;
  // Appended verbatim via --append-system-prompt. Empty for the harness probe.
  systemPrompt: string;
  prompt: string;
  model: EvalModel;
  sessionId: string;
  resumeSessionId: string | null;
  daemon: EvalDaemon | null;
  // Where this invocation's generated --mcp-config is written.
  mcpConfigDir: string;
};

export function buildClaudeArgv(input: ClaudeArgvInput): string[] {
  return [
    "-p",
    input.prompt,
    "--model",
    input.model,
    ...buildSessionArgs(input),
    "--output-format",
    "json",
    // The operator's personal CLAUDE.md and settings must never reach the
    // measured token counts: a real user starts from a clean install.
    "--setting-sources",
    "",
    "--permission-mode",
    "bypassPermissions",
    // No MCP server the run did not explicitly ask for, on either surface, so
    // the harness constant is identical across arms.
    "--strict-mcp-config",
    ...buildSystemPromptArgs(input),
    ...buildSurfaceArgs(input),
  ];
}

function buildSessionArgs(input: ClaudeArgvInput): string[] {
  if (input.resumeSessionId !== null) return ["--resume", input.resumeSessionId];
  return ["--session-id", input.sessionId];
}

// The harness probe measures what Claude Code costs with NO arm attached, so it
// passes no flag at all rather than an empty one.
function buildSystemPromptArgs(input: ClaudeArgvInput): string[] {
  if (input.systemPrompt.length === 0) return [];
  return ["--append-system-prompt", input.systemPrompt];
}

function buildSurfaceArgs(input: ClaudeArgvInput): string[] {
  const granted = GRANTS_BY_SURFACE[input.surface];
  const denied = deniedToolsFor(granted);
  const grantedBuiltIns = granted.filter(isBuiltInTool);

  return [
    ...buildMcpArgs(input),
    "--tools",
    grantedBuiltIns.join(","),
    "--allowedTools",
    granted.join(","),
    "--disallowedTools",
    denied.join(","),
  ];
}

function buildMcpArgs(input: ClaudeArgvInput): string[] {
  if (input.surface !== AuthoringSurface.CanvasTool) return [];

  if (input.daemon === null) {
    throw new Error(
      `the ${AuthoringSurface.CanvasTool} surface needs a running eval daemon to point its --mcp-config at ` +
        `(see evals/daemon.ts).`,
    );
  }
  // CANVAS_SESSION_ID pins the MCP server to THIS attempt's session, and HOME
  // points it at the eval daemon's scratch state dir — never the operator's.
  const mcpConfigPath = writeEvalCanvasMcpConfig({
    runDir: input.mcpConfigDir,
    sessionId: input.sessionId,
    armId: input.armId,
    daemonHomeDir: input.daemon.homeDir,
  });
  return ["--mcp-config", mcpConfigPath];
}

function deniedToolsFor(granted: readonly string[]): string[] {
  const grantedSet = new Set<string>(granted);
  return KNOWN_TOOLS.filter((tool) => !grantedSet.has(tool));
}

function isBuiltInTool(tool: string): boolean {
  const builtIns: readonly string[] = Object.values(BuiltInTool);
  return builtIns.includes(tool);
}

// The MCP server key the canvas tools are registered under, surfaced so the
// report can state exactly which server an arm was wired to.
export const CANVAS_SERVER_KEY = CANVAS_MCP_SERVER_KEY;

// ---- The harness probe --------------------------------------------------------

// ledger.ts's measurement of the fixed Claude Code overhead. It goes through the
// SAME argv builder as a real attempt — a probe with a hand-rolled command line
// would measure a harness nobody runs.
export type ClaudeProbeOptions = {
  surface: AuthoringSurface;
  // Only reaches the --mcp-config's env: the canvas tool SCHEMA (which is what a
  // probe measures) is identical for every arm.
  armId: ArmId;
  model: EvalModel;
  systemPrompt: string;
  prompt: string;
  daemon: EvalDaemon | null;
  probeDir: string;
};

export type ClaudeProbeResult = {
  sessionId: string;
  transcriptPath: string | null;
  entries: readonly TraceEntry[];
  cliResult: ClaudeCliResult | null;
  argv: readonly string[];
};

export async function runClaudeProbe(options: ClaudeProbeOptions): Promise<ClaudeProbeResult> {
  const sessionId = randomUUID();
  mkdirSync(options.probeDir, { recursive: true });

  const argv = buildClaudeArgv({
    surface: options.surface,
    armId: options.armId,
    systemPrompt: options.systemPrompt,
    prompt: options.prompt,
    model: options.model,
    sessionId,
    resumeSessionId: null,
    daemon: options.daemon,
    mcpConfigDir: options.probeDir,
  });

  const { invocation } = await invokeWithBackoff(argv, options.probeDir);
  const cliResult = parseCliResult(invocation.stdout);
  const transcript = readTranscriptSafely(cliResult?.sessionId ?? sessionId);

  return {
    sessionId,
    transcriptPath: transcript.path,
    entries: transcript.entries,
    cliResult,
    argv,
  };
}

// ---- Invocation -------------------------------------------------------------

type Invocation = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  wallClockMs: number;
  timedOut: boolean;
  failureKind: FailureKind;
};

async function invokeWithBackoff(
  argv: readonly string[],
  cwd: string,
): Promise<{ invocation: Invocation; retries: RetryRecord[] }> {
  const retries: RetryRecord[] = [];

  for (let retryIndex = 0; retryIndex <= MAX_TRANSIENT_RETRIES; retryIndex += 1) {
    const invocation = await invokeClaude(argv, cwd);
    if (!isRetryable(invocation.failureKind)) return { invocation, retries };

    const isLastTry = retryIndex === MAX_TRANSIENT_RETRIES;
    if (isLastTry) return { invocation, retries };

    const waitedMs = backoffDelayMs(invocation.failureKind, retryIndex);
    retries.push({
      retryIndex,
      kind: invocation.failureKind,
      detail: failureDetailOf(invocation),
      waitedMs,
    });
    await Bun.sleep(waitedMs);
  }

  throw new Error("unreachable: the retry loop always returns on its last iteration");
}

function isRetryable(failureKind: FailureKind): boolean {
  return failureKind === FailureKind.RateLimited || failureKind === FailureKind.Transient;
}

function backoffDelayMs(failureKind: FailureKind, retryIndex: number): number {
  const base =
    failureKind === FailureKind.RateLimited ? RATE_LIMIT_BACKOFF_BASE_MS : TRANSIENT_BACKOFF_BASE_MS;
  const exponential = base * BACKOFF_FACTOR ** retryIndex;
  return Math.min(exponential, MAX_BACKOFF_MS);
}

function failureDetailOf(invocation: Invocation): string {
  const stderrTail = invocation.stderr.trim().slice(-400);
  if (stderrTail.length > 0) return stderrTail;
  return invocation.stdout.trim().slice(-400);
}

// A run that has not finished by RUN_TIMEOUT_MS is killed and recorded as a
// failure. It is never retried and never silently passed: a hung run that we
// quietly re-rolled would be an unreported selection effect on the results.
async function invokeClaude(argv: readonly string[], cwd: string): Promise<Invocation> {
  const startedAt = Date.now();

  const claudeProcess = Bun.spawn({
    cmd: ["claude", ...argv],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    claudeProcess.kill("SIGKILL");
  }, RUN_TIMEOUT_MS);

  const [stdout, stderr] = await Promise.all([
    new Response(claudeProcess.stdout).text(),
    new Response(claudeProcess.stderr).text(),
  ]);
  const exitCode = await claudeProcess.exited;
  clearTimeout(timeoutTimer);

  return {
    stdout,
    stderr,
    exitCode,
    wallClockMs: Date.now() - startedAt,
    timedOut,
    failureKind: classifyFailure({ stdout, stderr, exitCode, timedOut }),
  };
}

type FailureSignals = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

export function classifyFailure(signals: FailureSignals): FailureKind {
  if (signals.timedOut) return FailureKind.TaskFailure;

  const cliResult = parseCliResult(signals.stdout);

  // The CLI answered cleanly. Whether the ARTIFACT is any good is the browser
  // rubric's call, not ours — this is a successful invocation either way.
  if (cliResult !== null && !cliResult.isError) return FailureKind.None;

  const complaint = cliResult === null ? `${signals.stdout}\n${signals.stderr}` : cliResult.resultText;
  if (matchesAny(complaint, RATE_LIMIT_PATTERNS)) return FailureKind.RateLimited;
  if (matchesAny(complaint, TRANSIENT_PATTERNS)) return FailureKind.Transient;

  // No parseable result and no recognizable transient signature: the CLI failed
  // to launch or died. Retrying is the honest move — nothing about the MODEL was
  // measured here.
  if (cliResult === null) return FailureKind.Transient;

  // A parsed result that reports an error we do not recognize as infrastructure
  // (a refusal, max turns, a tool the model could not call) is the model failing
  // the task. That is the finding, not a flake.
  return FailureKind.TaskFailure;
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function parseCliResult(stdout: string): ClaudeCliResult | null {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return null;

  try {
    const parsed = JSON.parse(trimmed) as {
      is_error?: boolean;
      num_turns?: number;
      total_cost_usd?: number;
      duration_ms?: number;
      session_id?: string;
      result?: unknown;
    };
    return {
      isError: parsed.is_error === true,
      numTurns: parsed.num_turns ?? 0,
      totalCostUsd: parsed.total_cost_usd ?? 0,
      durationMs: parsed.duration_ms ?? 0,
      sessionId: parsed.session_id ?? "",
      resultText: typeof parsed.result === "string" ? parsed.result : JSON.stringify(parsed.result ?? null),
    };
  } catch {
    return null;
  }
}

// ---- The transcript ---------------------------------------------------------

type TranscriptRead = { path: string | null; entries: TraceEntry[] };

// A killed or crashed run may never have opened a transcript. That is a
// failure to record, not an exception to throw — the attempt still costs a row
// in the results table.
function readTranscriptSafely(sessionId: string): TranscriptRead {
  try {
    const path = locateSessionJsonl(sessionId);
    return { path, entries: readTranscriptEntries(path) };
  } catch {
    return { path: null, entries: [] };
  }
}

// ---- The authored artifact --------------------------------------------------

type ArtifactExtraction = {
  entries: readonly TraceEntry[];
  surface: AuthoringSurface;
  cwd: string;
  previousMessageIds: ReadonlySet<string>;
};

// What the arm authored, and WHICH assistant message authored it.
//
// The authoring call is the canvas_render tool_use for a CanvasTool arm and the
// Write tool_use for a WrittenFile arm — the SAME rule for every arm, so no arm
// gets a different accounting. The model's LAST render wins: if it rendered twice
// inside one attempt, the second is what the user would be looking at.
export type AuthoringExtraction = {
  artifact: AuthoredArtifact | null;
  authoringMessageId: string | null;
  renderCallCount: number;
};

export function extractAuthoredArtifact(extraction: ArtifactExtraction): AuthoringExtraction {
  const toolUses = collectNewToolUses(extraction.entries, extraction.previousMessageIds);
  const renderCalls = toolUses.filter((toolUse) => isAuthoringCall(toolUse, extraction));

  const lastRender = renderCalls.at(-1);
  if (lastRender === undefined) {
    return { artifact: null, authoringMessageId: null, renderCallCount: 0 };
  }

  return {
    artifact: { source: authoredSourceOf(lastRender.input, extraction.surface), toolInput: lastRender.input },
    authoringMessageId: lastRender.messageId,
    renderCallCount: renderCalls.length,
  };
}

function isAuthoringCall(toolUse: ToolUse, extraction: ArtifactExtraction): boolean {
  if (extraction.surface === AuthoringSurface.CanvasTool) {
    return toolUse.toolName === CANVAS_RENDER_TOOL;
  }
  return isWriteIntoRunDir(toolUse, extraction.cwd);
}

type ToolUse = { toolName: string; toolUseId: string; messageId: string | null; input: Record<string, unknown> };

function collectNewToolUses(
  entries: readonly TraceEntry[],
  previousMessageIds: ReadonlySet<string>,
): ToolUse[] {
  const toolUses: ToolUse[] = [];

  for (const entry of entries) {
    if (entry.kind !== TraceEntryKind.Assistant) continue;
    if (entry.messageId !== null && previousMessageIds.has(entry.messageId)) continue;

    for (const block of entry.blocks) {
      if (!isToolUseBlock(block)) continue;
      toolUses.push({
        toolName: block.toolName,
        toolUseId: block.toolUseId,
        messageId: entry.messageId,
        input: block.input,
      });
    }
  }

  return toolUses;
}

function isToolUseBlock(block: ContentBlock): block is Extract<ContentBlock, { kind: typeof BlockKind.ToolUse }> {
  return block.kind === BlockKind.ToolUse;
}

// canvas_render's own input schema names the spec `spec`, but a markup arm
// authors a DOCUMENT, and which field it arrives in is the arm's business, not
// the driver's. Whatever text the model actually emitted is what we are
// counting, so the source is taken verbatim from the first field that carries
// one, and the whole tool input is archived alongside it either way.
const AUTHORED_SOURCE_FIELDS = ["markup", "source", "document", "spec"] as const;

function authoredSourceOf(toolInput: Record<string, unknown>, surface: AuthoringSurface): string {
  if (surface === AuthoringSurface.WrittenFile) {
    const content = toolInput.content;
    return typeof content === "string" ? content : "";
  }

  for (const field of AUTHORED_SOURCE_FIELDS) {
    const value = toolInput[field];
    if (typeof value === "string") return value;
    if (isPlainObject(value)) return JSON.stringify(value);
  }
  return JSON.stringify(toolInput);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWriteIntoRunDir(toolUse: ToolUse, cwd: string): boolean {
  if (toolUse.toolName !== BuiltInTool.Write) return false;

  const filePath = toolUse.input.file_path;
  if (typeof filePath !== "string") return false;

  // Models write "./dashboard.html" as readily as an absolute path; both mean
  // the same file under the run's cwd.
  const resolvedPath = resolve(cwd, filePath);
  return resolvedPath.startsWith(resolve(cwd));
}

// ---- The audit trail --------------------------------------------------------

// Every published number must be traceable to one of these lines: the exact
// prompt sent, the arm's system prompt as sent, the argv (i.e. the tool
// surface), the raw stdout, the CLI's own usage figures, and the artifact.
function archiveAttempt(
  options: ArmAttemptOptions,
  result: ArmAttemptResult,
  invocation: Invocation,
): void {
  const record = {
    kind: ARCHIVE_RECORD_KIND,
    recordedAt: new Date().toISOString(),
    runId: options.runId,
    attemptIndex: options.attemptIndex,
    armId: options.arm.id,
    fidelity: options.arm.fidelity,
    surface: options.arm.surface,
    scenarioId: options.scenario.id,
    model: options.model,
    sessionId: result.sessionId,
    resumedFrom: options.resumeSessionId,
    cwd: options.cwd,
    argv: result.argv,
    prompt: options.prompt,
    systemPrompt: options.arm.systemPrompt,
    stdout: invocation.stdout,
    stderr: invocation.stderr,
    exitCode: invocation.exitCode,
    timedOut: result.timedOut,
    failureKind: result.failureKind,
    retries: result.retries,
    wallClockMs: result.wallClockMs,
    cliResult: result.cliResult,
    transcriptPath: result.transcriptPath,
    artifact: result.artifact,
  };

  appendFileSync(result.archivePath, `${JSON.stringify(record)}\n`);
}

function attemptDirFor(options: ArmAttemptOptions): string {
  return join(EvalPaths.runs, options.runId, `attempt-${options.attemptIndex}`);
}
