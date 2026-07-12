import { describe, it, expect } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFleetScanner, FleetSessionStatus } from "./claude-sessions.ts";

const SCAN_OPTIONS = { sinceHours: 24, limit: 25 };

type FixtureLine = Record<string, unknown>;

function assistantLine(overrides: {
  messageId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  timestamp?: string;
}): FixtureLine {
  return {
    type: "assistant",
    uuid: `uuid-${overrides.messageId}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    cwd: "/Users/dev/projects/parchment",
    gitBranch: "live-engine",
    message: {
      id: overrides.messageId,
      model: overrides.model,
      content: [{ type: "text", text: "working on it" }],
      usage: {
        input_tokens: overrides.inputTokens,
        output_tokens: overrides.outputTokens,
        cache_read_input_tokens: overrides.cacheReadTokens ?? 0,
        cache_creation_input_tokens: overrides.cacheWriteTokens ?? 0,
      },
    },
  };
}

function humanTurnLine(text: string): FixtureLine {
  return {
    type: "user",
    uuid: `uuid-user-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    origin: { kind: "human" },
    message: { content: text },
  };
}

function toolResultLine(): FixtureLine {
  return {
    type: "user",
    uuid: `uuid-tool-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    origin: { kind: "synthetic" },
    message: { content: [{ type: "tool_result", tool_use_id: "tu_1", content: "ok" }] },
  };
}

function aiTitleLine(title: string): FixtureLine {
  return { type: "ai-title", aiTitle: title };
}

function sidechainAssistantLine(): FixtureLine {
  return {
    ...assistantLine({ messageId: "msg-side-1", model: "claude-haiku-4-5", inputTokens: 10, outputTokens: 5 }),
    isSidechain: true,
  };
}

function writeSessionFile(projectDir: string, sessionId: string, lines: FixtureLine[]): string {
  const path = join(projectDir, `${sessionId}.jsonl`);
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return path;
}

function fixtureProjectsDir(): { projectsDir: string; projectDir: string } {
  const projectsDir = mkdtempSync(join(tmpdir(), "fleet-scan-"));
  const projectDir = join(projectsDir, "-Users-dev-projects-parchment");
  mkdirSync(projectDir);
  return { projectsDir, projectDir };
}

describe("createFleetScanner", () => {
  it("aggregates turns, deduped token usage, cost, and title per session", () => {
    const { projectsDir, projectDir } = fixtureProjectsDir();
    writeSessionFile(projectDir, "session-main", [
      aiTitleLine("Fix flaky tests"),
      humanTurnLine("please fix the tests"),
      // Two lines for one message (multi-block): usage must count ONCE.
      assistantLine({ messageId: "msg-1", model: "claude-sonnet-4-5", inputTokens: 1000, outputTokens: 500 }),
      assistantLine({ messageId: "msg-1", model: "claude-sonnet-4-5", inputTokens: 1000, outputTokens: 500 }),
      toolResultLine(),
      humanTurnLine("now run them"),
      assistantLine({
        messageId: "msg-2",
        model: "claude-sonnet-4-5",
        inputTokens: 2000,
        outputTokens: 1500,
        cacheReadTokens: 50_000,
        cacheWriteTokens: 10_000,
      }),
    ]);

    const snapshot = createFleetScanner(projectsDir).scan(SCAN_OPTIONS);

    expect(snapshot.sessions).toHaveLength(1);
    const session = snapshot.sessions[0];
    if (!session) throw new Error("expected a session");
    expect(session.sessionId).toBe("session-main");
    expect(session.project).toBe("parchment");
    expect(session.title).toBe("Fix flaky tests");
    expect(session.turns).toBe(2);
    expect(session.lastPrompt).toBe("now run them");
    expect(session.tokensIn).toBe(3000);
    expect(session.tokensOut).toBe(2000);
    expect(session.cacheRead).toBe(50_000);
    expect(session.cacheWrite).toBe(10_000);
    expect(session.model).toBe("sonnet-4-5");
    expect(session.gitBranch).toBe("live-engine");
    expect(session.status).toBe(FleetSessionStatus.Active);
    expect(session.isSubagent).toBe(false);
    expect(session.costUsd).toBeGreaterThan(0);
    expect(snapshot.costNote).toContain("estimate");
  });

  it("marks sidechain files as subagents and sums fleet totals", () => {
    const { projectsDir, projectDir } = fixtureProjectsDir();
    writeSessionFile(projectDir, "session-main", [
      humanTurnLine("main work"),
      assistantLine({ messageId: "msg-a", model: "claude-sonnet-4-5", inputTokens: 100, outputTokens: 50 }),
    ]);
    writeSessionFile(projectDir, "agent-sidekick", [sidechainAssistantLine()]);

    const snapshot = createFleetScanner(projectsDir).scan(SCAN_OPTIONS);

    expect(snapshot.totals.sessions).toBe(2);
    expect(snapshot.totals.turns).toBe(1);
    const subagent = snapshot.sessions.find((session) => session.sessionId === "agent-sidekick");
    expect(subagent?.isSubagent).toBe(true);
  });

  it("tail-parses on subsequent scans instead of re-reading the file", () => {
    const { projectsDir, projectDir } = fixtureProjectsDir();
    const path = writeSessionFile(projectDir, "session-inc", [
      humanTurnLine("start"),
      assistantLine({ messageId: "msg-1", model: "claude-sonnet-4-5", inputTokens: 100, outputTokens: 100 }),
    ]);

    const scanner = createFleetScanner(projectsDir);
    const first = scanner.scan(SCAN_OPTIONS);
    expect(first.sessions[0]?.tokensOut).toBe(100);

    appendFileSync(
      path,
      `${JSON.stringify(assistantLine({ messageId: "msg-2", model: "claude-sonnet-4-5", inputTokens: 100, outputTokens: 250 }))}\n`,
    );
    const second = scanner.scan(SCAN_OPTIONS);
    expect(second.sessions[0]?.tokensOut).toBe(350);
    expect(second.sessions[0]?.turns).toBe(1);
  });

  it("ignores files idle for longer than sinceHours", () => {
    const { projectsDir, projectDir } = fixtureProjectsDir();
    const path = writeSessionFile(projectDir, "session-old", [humanTurnLine("ancient work")]);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(path, twoHoursAgo, twoHoursAgo);

    const snapshot = createFleetScanner(projectsDir).scan({ sinceHours: 1, limit: 25 });

    expect(snapshot.sessions).toHaveLength(0);
    expect(snapshot.totals.sessions).toBe(0);
  });

  it("caps the listed sessions at limit but totals everything recent", () => {
    const { projectsDir, projectDir } = fixtureProjectsDir();
    for (const index of [1, 2, 3]) {
      writeSessionFile(projectDir, `session-${index}`, [humanTurnLine(`work ${index}`)]);
    }

    const snapshot = createFleetScanner(projectsDir).scan({ sinceHours: 24, limit: 2 });

    expect(snapshot.sessions).toHaveLength(2);
    expect(snapshot.totals.sessions).toBe(3);
  });
});
