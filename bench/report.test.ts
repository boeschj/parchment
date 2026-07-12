import { describe, expect, test } from "bun:test";
import { Arm, Model, type RunRecord } from "./types.ts";
import { buildReportMarkdown } from "./report.ts";

function fakeRecord(overrides: Partial<RunRecord>): RunRecord {
  return {
    scenarioId: "status-dashboard",
    arm: Arm.Parchment,
    model: Model.Haiku,
    repetition: 1,
    sessionId: "11111111-1111-1111-1111-111111111111",
    jsonlPath: "/tmp/does-not-matter.jsonl",
    claudeResult: {
      isError: false,
      numTurns: 2,
      totalCostUsd: 0.05,
      durationMs: 4000,
      sessionId: "11111111-1111-1111-1111-111111111111",
      resultText: "done",
    },
    transcript: {
      assistantTurnCount: 2,
      totalPromptTokens: 1000,
      totalCompletionTokens: 200,
      renderAttempts: 1,
      tokensToFirstPaint: 1200,
      turnsToFirstPaint: 1,
    },
    validation: { passed: true, reasons: [] },
    claudeVersion: "2.1.207",
    recordedAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildReportMarkdown", () => {
  test("groups runs by scenario/arm/model and reports the pass rate", () => {
    const records = [
      fakeRecord({ repetition: 1, validation: { passed: true, reasons: [] } }),
      fakeRecord({ repetition: 2, validation: { passed: false, reasons: ["missing Chart"] } }),
    ];

    const markdown = buildReportMarkdown(records, {
      generatedAt: "2026-07-12T00:00:00.000Z",
      claudeVersions: ["2.1.207"],
      scenarioTitlesById: new Map([["status-dashboard", "CI status dashboard"]]),
    });

    expect(markdown).toContain("CI status dashboard");
    expect(markdown).toContain("50%");
    expect(markdown).toContain("## Methodology");
    expect(markdown).toContain("## Raw runs");
  });

  test("reports 'never' for first paint when a run never painted", () => {
    const records = [
      fakeRecord({
        transcript: {
          assistantTurnCount: 1,
          totalPromptTokens: 400,
          totalCompletionTokens: 50,
          renderAttempts: 1,
          tokensToFirstPaint: null,
          turnsToFirstPaint: null,
        },
        validation: { passed: false, reasons: ["rejected"] },
      }),
    ];

    const markdown = buildReportMarkdown(records, {
      generatedAt: "2026-07-12T00:00:00.000Z",
      claudeVersions: ["2.1.207"],
      scenarioTitlesById: new Map(),
    });

    expect(markdown).toContain("never");
  });
});
