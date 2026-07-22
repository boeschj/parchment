import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { routeInstruction, routeVisual } from "./route.ts";
import { RouteStage, VisualRoute, type RouteDecision, type RouteInput } from "./types.ts";

const HookMode = {
  UserPrompt: "user-prompt",
  PostTool: "post-tool",
  Stop: "stop",
} as const;

type HookMode = (typeof HookMode)[keyof typeof HookMode];
type HookEvent = Record<string, unknown>;

const mode = Bun.argv[2] as HookMode | undefined;
if (!mode || !Object.values(HookMode).includes(mode)) process.exit(0);

const rawInput = await Bun.stdin.text();
if (rawInput.trim().length === 0) process.exit(0);

let event: HookEvent;
try {
  event = JSON.parse(rawInput) as HookEvent;
} catch {
  process.exit(0);
}

const sessionId = stringField(event, "session_id") ?? "default";
const sessionDir = routeSessionDirectory(sessionId);
mkdirSync(sessionDir, { recursive: true });

if (mode === HookMode.UserPrompt) {
  const turnId = stringField(event, "prompt_id") ?? `turn-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const routeDir = routeDirectory(sessionDir, turnId);
  mkdirSync(routeDir, { recursive: true });
  const input: RouteInput = {
    stage: RouteStage.Prompt,
    userPrompt: stringField(event, "prompt") ?? "",
  };
  const decision = routeVisual(input);
  persistJson(join(routeDir, "decision.json"), {
    recordedAt: Date.now(),
    input,
    decision,
  });
  persistJson(join(sessionDir, "active.json"), { turnId, startedAt: Date.now() });
  emitAdditionalContext("UserPromptSubmit", decision);
  process.exit(0);
}

const turnId = stringField(event, "prompt_id") ?? readActiveTurnId(sessionDir) ?? "orphan";
const routeDir = routeDirectory(sessionDir, turnId);
mkdirSync(routeDir, { recursive: true });

if (mode === HookMode.PostTool) {
  const toolName = stringField(event, "tool_name") ?? "";
  const toolUseId = stringField(event, "tool_use_id") ?? `tool_${Date.now()}`;
  const priorPrompt = readPriorPrompt(routeDir);
  const input: RouteInput = {
    stage: RouteStage.Tool,
    ...(priorPrompt !== null ? { userPrompt: priorPrompt } : {}),
    toolName,
    ...(event.tool_input !== undefined ? { toolInput: event.tool_input } : {}),
    ...(event.tool_response !== undefined ? { toolResult: event.tool_response } : {}),
  };
  const decision = routeVisual(input);
  const toolsDir = join(routeDir, "tools");
  mkdirSync(toolsDir, { recursive: true });
  persistJson(join(toolsDir, `${safeSegment(toolUseId)}.json`), {
    recordedAt: Date.now(),
    toolName,
    successful: toolCallSucceeded(event.tool_response),
    parchmentCreation: parchmentCreationKind(toolName),
    decision,
  });
  if (parchmentCreationKind(toolName) === null) emitAdditionalContext("PostToolUse", decision);
  process.exit(0);
}

const prior = readDecisionRecord(routeDir);
const responseInput: RouteInput = {
  stage: RouteStage.Response,
  ...(prior?.input.userPrompt !== undefined ? { userPrompt: prior.input.userPrompt } : {}),
  assistantResponse: stringField(event, "last_assistant_message") ?? "",
};
const responseDecision = routeVisual(responseInput);
const toolRecords = readToolRecords(join(routeDir, "tools"));
const effectiveExpected = effectiveExpectedDecision(prior?.decision ?? null, toolRecords);
persistJson(join(routeDir, "outcome.json"), {
  recordedAt: Date.now(),
  expected: effectiveExpected.decision,
  expectedSource: effectiveExpected.source,
  responseDecision,
  fulfillment: evaluateFulfillment(effectiveExpected.decision, toolRecords),
  tools: toolRecords,
});

// Stop output is intentionally empty. additionalContext or decision:block
// would force another model call; this phase records evidence only.

function emitAdditionalContext(
  hookEventName: "UserPromptSubmit" | "PostToolUse",
  decision: RouteDecision,
): void {
  if (!shouldInject(decision)) return;
  const strongestRule = [...decision.evidence].sort((left, right) => right.weight - left.weight)[0]?.signal ?? "fallback";
  const attributes = [
    `route="${escapeAttribute(decision.route)}"`,
    `strategy="${escapeAttribute(decision.strategy)}"`,
    `confidence="${decision.confidence.toFixed(2)}"`,
    `rule="${escapeAttribute(strongestRule)}"`,
    ...(decision.preset ? [`preset="${escapeAttribute(decision.preset)}"`] : []),
    ...(decision.viewer ? [`viewer="${escapeAttribute(decision.viewer)}"`] : []),
  ].join(" ");
  const context = `<parchment-route source="deterministic" ${attributes}>Deterministic presentation classification: ${decision.route}. Authoring policy: ${routeInstruction(decision)} The user's explicit output-format instruction remains authoritative.</parchment-route>`;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName,
      additionalContext: context,
    },
  }));
}

function shouldInject(decision: RouteDecision): boolean {
  if (decision.route !== VisualRoute.Transcript) return decision.confidence >= 0.65;
  return decision.evidence.some((item) => item.signal === "explicit-negative" || item.signal === "implementation-work");
}

type PersistedDecision = {
  input: RouteInput;
  decision: RouteDecision;
};

type ToolRecord = {
  recordedAt: number;
  toolName: string;
  successful: boolean;
  parchmentCreation: string | null;
  decision: RouteDecision;
};

function readDecisionRecord(dir: string): PersistedDecision | null {
  const path = join(dir, "decision.json");
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PersistedDecision;
    if (!parsed.input || !parsed.decision) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readPriorPrompt(dir: string): string | null {
  return readDecisionRecord(dir)?.input.userPrompt ?? null;
}

function readToolRecords(dir: string): ToolRecord[] {
  if (!existsSync(dir)) return [];
  const records: ToolRecord[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), "utf8")) as ToolRecord;
      if (typeof parsed.toolName === "string" && typeof parsed.recordedAt === "number" && parsed.decision) records.push(parsed);
    } catch {
      // A concurrently written or interrupted observation is ignored; each
      // tool gets its own file, so one bad record cannot corrupt the turn.
    }
  }
  return records.sort((left, right) => left.recordedAt - right.recordedAt);
}

function effectiveExpectedDecision(
  promptDecision: RouteDecision | null,
  tools: ToolRecord[],
): { decision: RouteDecision | null; source: string } {
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const tool = tools[index];
    if (tool?.successful && tool.parchmentCreation === null && tool.decision.shouldPresent) {
      return { decision: tool.decision, source: `tool:${tool.toolName}` };
    }
  }
  return {
    decision: promptDecision,
    source: promptDecision === null ? "none" : "prompt",
  };
}

function evaluateFulfillment(expected: RouteDecision | null, tools: ToolRecord[]): Record<string, unknown> {
  if (!expected) return { status: "unobserved", reason: "no prompt decision was recorded" };
  const successfulParchmentTools = tools.filter((tool) => tool.successful && tool.parchmentCreation !== null);
  if (expected.route === VisualRoute.Transcript) {
    return successfulParchmentTools.length === 0
      ? { status: "pass", reason: "no extra visual surface was created" }
      : { status: "fail", reason: "a visual surface was created despite a transcript route" };
  }
  const expectedCreation = expectedCreationFor(expected);
  if (expectedCreation === null) {
    return { status: "unverified", reason: `route ${expected.route} has no observable Parchment creation tool yet` };
  }
  const matched = successfulParchmentTools.some((tool) => tool.parchmentCreation === expectedCreation);
  return matched
    ? { status: "pass", reason: `observed successful ${expectedCreation}` }
    : { status: "fail", reason: `expected ${expectedCreation}, but no successful matching tool call was observed` };
}

function expectedCreationFor(decision: RouteDecision): string | null {
  const route = decision.route;
  if (route === VisualRoute.McpApp) return "canvas_app";
  if (route === VisualRoute.File && decision.strategy === "generate") return null;
  const renderRoutes: ReadonlySet<RouteDecision["route"]> = new Set([
    VisualRoute.Markdown,
    VisualRoute.Mermaid,
    VisualRoute.File,
    VisualRoute.Component,
  ]);
  if (renderRoutes.has(route)) return "canvas_render";
  return null;
}

function parchmentCreationKind(toolName: string): string | null {
  const normalized = toolName.toLowerCase();
  for (const name of ["canvas_render", "canvas_app", "canvas_plan", "canvas_patch"]) {
    if (normalized.includes(name)) return name;
  }
  return null;
}

function toolCallSucceeded(value: unknown): boolean {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.isError === true || record.ok === false || record.success === false || record.error !== undefined) return false;
  }
  if (typeof value === "string" && /^\s*(?:error|failed)\b/i.test(value)) return false;
  return true;
}

function routeSessionDirectory(sessionId: string): string {
  const stateRoot = process.env.PARCHMENT_STATE_DIR ?? join(homedir(), ".parchment");
  return join(stateRoot, "sessions", safeSegment(sessionId), "routes");
}

function routeDirectory(sessionDir: string, turnId: string): string {
  return join(sessionDir, safeSegment(turnId));
}

function readActiveTurnId(sessionDir: string): string | null {
  const path = join(sessionDir, "active.json");
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return typeof value.turnId === "string" ? value.turnId : null;
  } catch {
    return null;
  }
}

function persistJson(path: string, value: unknown): void {
  const temporaryPath = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value, null, 2));
  renameSync(temporaryPath, path);
}

function stringField(record: HookEvent, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180) || "default";
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
