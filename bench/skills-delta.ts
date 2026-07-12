#!/usr/bin/env bun
// Skills-delta appendix: what do the canvas-tools + canvas-spec skills add
// over bare MCP tool descriptions?
//
//   bun run bench/skills-delta.ts
//
// Every other run in this harness passes --setting-sources "", so plugin
// skills are NEVER loaded by default (see bench/README.md) — the main suite's
// status-dashboard/parchment/haiku group is already the "no skills" control.
// This script re-runs that exact scenario/arm/model with the two SKILL.md
// cores appended to the system prompt via --append-system-prompt, so the
// difference between this report and the main suite's is attributable to the
// skills' content alone (same prompt, same tool, same model, same daemon
// isolation). Only the SKILL.md files themselves are appended, not their
// references/*.md — those are progressively disclosed and not loaded by
// default even with the plugin installed.

import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BENCH_RESULTS_DIR, BENCH_RUNS_DIR, DEFAULT_BENCH_PORT, REPO_ROOT } from "./config.ts";
import { startBenchDaemon } from "./daemon-harness.ts";
import { runOneRep } from "./runner.ts";
import { saveRawRunRecord, writeReport } from "./report.ts";
import { statusDashboardScenario } from "./scenarios/status-dashboard.ts";
import { Arm, Model, type RunRecord } from "./types.ts";

const REPETITIONS = 2;
const SKILL_PATHS = [
  join(REPO_ROOT, "skills", "canvas-tools", "SKILL.md"),
  join(REPO_ROOT, "skills", "canvas-spec", "SKILL.md"),
];

async function main(): Promise<void> {
  const appendSystemPrompt = readSkillCores();
  const timestamp = timestampForDirName();
  const resultsDir = join(BENCH_RESULTS_DIR, `${timestamp}-skills-delta`);
  const runsRootDir = join(BENCH_RUNS_DIR, `${timestamp}-skills-delta`);
  mkdirSync(resultsDir, { recursive: true });
  mkdirSync(runsRootDir, { recursive: true });

  const daemon = await startBenchDaemon({ port: DEFAULT_BENCH_PORT });
  const records: RunRecord[] = [];
  try {
    for (let repetition = 1; repetition <= REPETITIONS; repetition += 1) {
      process.stderr.write(`[skills-delta] status-dashboard / parchment / haiku (+skills) / rep ${repetition}/${REPETITIONS}...\n`);
      const record = await runOneRep({
        scenario: statusDashboardScenario,
        arm: Arm.Parchment,
        model: Model.Haiku,
        repetition,
        runsRootDir,
        daemon,
        appendSystemPrompt,
      });
      records.push(record);
      saveRawRunRecord(resultsDir, record);
      process.stderr.write(`[skills-delta]   -> ${record.validation.passed ? "PASS" : "FAIL"} ($${record.claudeResult.totalCostUsd.toFixed(4)})\n`);
    }
  } finally {
    await daemon.stop();
  }

  const reportPath = writeReport(records, resultsDir, {
    generatedAt: new Date().toISOString(),
    claudeVersions: [...new Set(records.map((record) => record.claudeVersion))],
    scenarioTitlesById: new Map([[statusDashboardScenario.id, `${statusDashboardScenario.title} (+canvas-tools/canvas-spec skills)`]]),
  });
  process.stderr.write(`[skills-delta] wrote ${reportPath}\n`);
  process.stderr.write(
    `[skills-delta] compare against the main suite's status-dashboard/parchment/haiku group (no skills, ` +
      `--setting-sources "" strips plugin loading by default) for the delta.\n`,
  );
}

function readSkillCores(): string {
  return SKILL_PATHS.map((path) => readFileSync(path, "utf8")).join("\n\n---\n\n");
}

function timestampForDirName(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

await main();
