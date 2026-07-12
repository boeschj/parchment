// Built-in fleet + cost data source: scans ~/.claude/projects/*/*.jsonl and
// aggregates per-session status, turns, token usage, and estimated cost. The
// scanner keeps a per-file cursor so each poll parses only appended lines —
// a corpus totalling 100MB+ is paid for once, then tailed.

import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
  parseTraceEntry,
  TraceEntryKind,
  SessionMetaField,
  UserOrigin,
  type TraceEntry,
} from "@boeschj/claude-jsonl";
import { applySourceValue } from "./apply.ts";
import { estimateCostUsd, type ModelTokenTotals } from "./pricing.ts";
import type { SlotStatePump } from "./pump.ts";
import { consumeAppendedLines, FRESH_TAIL_CURSOR, type TailCursor } from "./tail-reader.ts";
import { LiveApplyMode, type ClaudeSessionsSourceConfig } from "./types.ts";

export const FleetSessionStatus = {
  Active: "active",
  Idle: "idle",
} as const;

export type FleetSessionStatus = (typeof FleetSessionStatus)[keyof typeof FleetSessionStatus];

const ACTIVE_WITHIN_MS = 2 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;
const COST_DECIMALS = 4;
const SEEN_MESSAGE_ID_MEMORY = 256;
const SYNTHETIC_MODEL = "<synthetic>";
const LAST_PROMPT_MAX_CHARS = 80;

export const FLEET_COST_NOTE = "costUsd is an estimate from a static local price table";

export type FleetSession = {
  sessionId: string;
  project: string;
  title: string;
  lastPrompt: string;
  status: FleetSessionStatus;
  isSubagent: boolean;
  model: string;
  turns: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  lastActivityAt: number;
  gitBranch: string | null;
};

export type FleetTotals = {
  sessions: number;
  active: number;
  turns: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

export type FleetSnapshot = {
  sessions: FleetSession[];
  totals: FleetTotals;
  scannedAt: number;
  costNote: string;
};

export type FleetScanOptions = {
  sinceHours: number;
  limit: number;
};

export type FleetScanner = {
  scan: (options: FleetScanOptions) => FleetSnapshot;
};

type SessionAggregate = {
  sessionId: string;
  projectDirName: string;
  cwd: string | null;
  gitBranch: string | null;
  aiTitle: string | null;
  customTitle: string | null;
  lastPrompt: string | null;
  turns: number;
  isSubagent: boolean;
  modelTokens: Map<string, ModelTokenTotals>;
  seenMessageIds: Set<string>;
  lastEntryTimestampMs: number | null;
};

type TrackedFile = {
  cursor: TailCursor;
  mtimeMs: number;
  aggregate: SessionAggregate;
};

export function createFleetScanner(projectsDir: string): FleetScanner {
  const trackedFiles = new Map<string, TrackedFile>();

  function scan(options: FleetScanOptions): FleetSnapshot {
    const scannedAt = Date.now();
    const cutoffMs = scannedAt - options.sinceHours * MS_PER_HOUR;
    ingestNewData(trackedFiles, projectsDir, cutoffMs);
    return buildSnapshot(trackedFiles, cutoffMs, options.limit, scannedAt);
  }

  return { scan };
}

// The engine-facing source. All claude-sessions sources share one scanner so
// two fleet dashboards never double-parse the corpus.
export function startClaudeSessionsSource(
  config: ClaudeSessionsSourceConfig,
  pump: SlotStatePump,
): () => void {
  const scanner = sharedScanner();
  const scanOptions: FleetScanOptions = { sinceHours: config.sinceHours, limit: config.limit };

  function pollOnce(): void {
    const snapshot = scanner.scan(scanOptions);
    applySourceValue(
      pump,
      {
        statePath: config.statePath,
        pluck: null,
        mode: LiveApplyMode.Replace,
        window: 0,
      },
      snapshot,
    );
  }

  pollOnce();
  const timer = setInterval(pollOnce, config.intervalMs);
  return () => clearInterval(timer);
}

let defaultScanner: FleetScanner | null = null;

function sharedScanner(): FleetScanner {
  if (!defaultScanner) {
    defaultScanner = createFleetScanner(join(homedir(), ".claude", "projects"));
  }
  return defaultScanner;
}

// ---------------------------------------------------------------------------
// Incremental ingest
// ---------------------------------------------------------------------------

function ingestNewData(
  trackedFiles: Map<string, TrackedFile>,
  projectsDir: string,
  cutoffMs: number,
): void {
  for (const sessionFile of listSessionFiles(projectsDir)) {
    const stats = statSafely(sessionFile.path);
    if (!stats) continue;

    const alreadyTracked = trackedFiles.has(sessionFile.path);
    const staleAtFirstSight = !alreadyTracked && stats.mtimeMs < cutoffMs;
    if (staleAtFirstSight) continue;

    const tracked =
      trackedFiles.get(sessionFile.path) ??
      freshTrackedFile(sessionFile.sessionId, sessionFile.projectDirName);
    trackedFiles.set(sessionFile.path, tracked);
    tracked.mtimeMs = stats.mtimeMs;

    if (stats.size === tracked.cursor.offset) continue;
    tracked.cursor = consumeAppendedLines({
      path: sessionFile.path,
      cursor: tracked.cursor,
      onLine: (line) => ingestLine(tracked.aggregate, line),
    });
  }
}

type SessionFile = { path: string; sessionId: string; projectDirName: string };

function listSessionFiles(projectsDir: string): SessionFile[] {
  const files: SessionFile[] = [];
  for (const projectDirName of listDirectories(projectsDir)) {
    const projectPath = join(projectsDir, projectDirName);
    for (const fileName of listFiles(projectPath)) {
      if (!fileName.endsWith(".jsonl")) continue;
      files.push({
        path: join(projectPath, fileName),
        sessionId: fileName.replace(/\.jsonl$/, ""),
        projectDirName,
      });
    }
  }
  return files;
}

function listDirectories(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function listFiles(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function statSafely(path: string): { size: number; mtimeMs: number } | null {
  try {
    const stats = statSync(path);
    return { size: stats.size, mtimeMs: stats.mtimeMs };
  } catch {
    return null;
  }
}

function freshTrackedFile(sessionId: string, projectDirName: string): TrackedFile {
  return {
    cursor: FRESH_TAIL_CURSOR,
    mtimeMs: 0,
    aggregate: {
      sessionId,
      projectDirName,
      cwd: null,
      gitBranch: null,
      aiTitle: null,
      customTitle: null,
      lastPrompt: null,
      turns: 0,
      isSubagent: false,
      modelTokens: new Map(),
      seenMessageIds: new Set(),
      lastEntryTimestampMs: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Per-line aggregation
// ---------------------------------------------------------------------------

function ingestLine(aggregate: SessionAggregate, line: string): void {
  const raw = parseJsonRecord(line);
  if (!raw) return;
  updateAggregate(aggregate, parseTraceEntry(raw));
}

function parseJsonRecord(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line);
    const isRecord = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
    return isRecord ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function updateAggregate(aggregate: SessionAggregate, entry: TraceEntry): void {
  rememberEnvelope(aggregate, entry);

  if (entry.kind === TraceEntryKind.Assistant) {
    recordAssistantUsage(aggregate, entry);
    return;
  }
  if (entry.kind === TraceEntryKind.User) {
    if (entry.origin === UserOrigin.Human) {
      aggregate.turns += 1;
      if (entry.text.length > 0) aggregate.lastPrompt = entry.text;
    }
    return;
  }
  if (entry.kind === TraceEntryKind.SessionMeta) {
    if (entry.field === SessionMetaField.AiTitle) aggregate.aiTitle = entry.value;
    if (entry.field === SessionMetaField.CustomTitle) aggregate.customTitle = entry.value;
    // last-prompt meta lines require @boeschj/claude-jsonl ≥0.1.1 (0.1.0 read
    // the wrong raw key and always yielded ""); the human-turn fallback above
    // keeps the field useful either way.
    if (entry.field === SessionMetaField.LastPrompt && entry.value.length > 0) {
      aggregate.lastPrompt = entry.value;
    }
  }
}

function rememberEnvelope(aggregate: SessionAggregate, entry: TraceEntry): void {
  const { envelope } = entry;
  if (envelope.cwd) aggregate.cwd = envelope.cwd;
  if (envelope.gitBranch) aggregate.gitBranch = envelope.gitBranch;
  if (envelope.isSidechain) aggregate.isSubagent = true;
  if (envelope.timestampMs !== null) aggregate.lastEntryTimestampMs = envelope.timestampMs;
}

// Usage repeats on every JSONL line of a multi-block message; count each
// messageId once. Message lines arrive consecutively, so a small bounded
// memory of recent ids is enough for exact dedupe.
function recordAssistantUsage(
  aggregate: SessionAggregate,
  entry: Extract<TraceEntry, { kind: typeof TraceEntryKind.Assistant }>,
): void {
  if (!entry.usage || entry.isSynthetic || entry.model === SYNTHETIC_MODEL) return;
  if (entry.messageId !== null && !rememberMessageId(aggregate, entry.messageId)) return;

  const totals = aggregate.modelTokens.get(entry.model) ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  totals.inputTokens += entry.usage.inputTokens;
  totals.outputTokens += entry.usage.outputTokens;
  totals.cacheReadTokens += entry.usage.cacheReadTokens;
  totals.cacheWriteTokens += entry.usage.cacheCreationTokens;
  aggregate.modelTokens.set(entry.model, totals);
}

function rememberMessageId(aggregate: SessionAggregate, messageId: string): boolean {
  if (aggregate.seenMessageIds.has(messageId)) return false;
  aggregate.seenMessageIds.add(messageId);
  if (aggregate.seenMessageIds.size > SEEN_MESSAGE_ID_MEMORY) {
    const oldest = aggregate.seenMessageIds.values().next().value;
    if (oldest !== undefined) aggregate.seenMessageIds.delete(oldest);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

function buildSnapshot(
  trackedFiles: Map<string, TrackedFile>,
  cutoffMs: number,
  limit: number,
  scannedAt: number,
): FleetSnapshot {
  const recentSessions = Array.from(trackedFiles.values())
    .filter((tracked) => tracked.mtimeMs >= cutoffMs)
    .map((tracked) => toFleetSession(tracked, scannedAt))
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);

  const listed = recentSessions.slice(0, limit);
  return {
    sessions: listed,
    totals: totalsOf(recentSessions),
    scannedAt,
    costNote: FLEET_COST_NOTE,
  };
}

function toFleetSession(tracked: TrackedFile, scannedAt: number): FleetSession {
  const { aggregate } = tracked;
  const lastActivityAt = Math.max(tracked.mtimeMs, aggregate.lastEntryTimestampMs ?? 0);
  const isActive = scannedAt - lastActivityAt <= ACTIVE_WITHIN_MS;
  const tokens = sumTokens(aggregate.modelTokens);

  return {
    sessionId: aggregate.sessionId,
    project: projectLabelOf(aggregate),
    title: aggregate.customTitle ?? aggregate.aiTitle ?? "",
    lastPrompt: truncatePrompt(aggregate.lastPrompt ?? ""),
    status: isActive ? FleetSessionStatus.Active : FleetSessionStatus.Idle,
    isSubagent: aggregate.isSubagent,
    model: dominantModelOf(aggregate.modelTokens),
    turns: aggregate.turns,
    tokensIn: tokens.inputTokens,
    tokensOut: tokens.outputTokens,
    cacheRead: tokens.cacheReadTokens,
    cacheWrite: tokens.cacheWriteTokens,
    costUsd: roundCost(sessionCostUsd(aggregate.modelTokens)),
    lastActivityAt,
    gitBranch: aggregate.gitBranch,
  };
}

function projectLabelOf(aggregate: SessionAggregate): string {
  if (aggregate.cwd) return basename(aggregate.cwd);
  return aggregate.projectDirName;
}

function truncatePrompt(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  if (collapsed.length <= LAST_PROMPT_MAX_CHARS) return collapsed;
  return `${collapsed.slice(0, LAST_PROMPT_MAX_CHARS).trimEnd()}…`;
}

function dominantModelOf(modelTokens: Map<string, ModelTokenTotals>): string {
  let dominant = "";
  let dominantOutput = -1;
  for (const [model, totals] of modelTokens) {
    if (totals.outputTokens > dominantOutput) {
      dominant = model;
      dominantOutput = totals.outputTokens;
    }
  }
  return shortModelName(dominant);
}

// "claude-sonnet-4-5-20250929" → "sonnet-4-5": the vendor prefix and date
// suffix are noise in a fleet table cell.
function shortModelName(model: string): string {
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

function sumTokens(modelTokens: Map<string, ModelTokenTotals>): ModelTokenTotals {
  const summed: ModelTokenTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  for (const totals of modelTokens.values()) {
    summed.inputTokens += totals.inputTokens;
    summed.outputTokens += totals.outputTokens;
    summed.cacheReadTokens += totals.cacheReadTokens;
    summed.cacheWriteTokens += totals.cacheWriteTokens;
  }
  return summed;
}

function sessionCostUsd(modelTokens: Map<string, ModelTokenTotals>): number {
  let cost = 0;
  for (const [model, totals] of modelTokens) {
    cost += estimateCostUsd(model, totals);
  }
  return cost;
}

function totalsOf(sessions: FleetSession[]): FleetTotals {
  const totals: FleetTotals = {
    sessions: sessions.length,
    active: 0,
    turns: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  };
  for (const session of sessions) {
    if (session.status === FleetSessionStatus.Active) totals.active += 1;
    totals.turns += session.turns;
    totals.tokensIn += session.tokensIn;
    totals.tokensOut += session.tokensOut;
    totals.costUsd += session.costUsd;
  }
  totals.costUsd = roundCost(totals.costUsd);
  return totals;
}

function roundCost(costUsd: number): number {
  const factor = 10 ** COST_DECIMALS;
  return Math.round(costUsd * factor) / factor;
}
