#!/usr/bin/env bun
// Metric (d): time-to-first-canvas — cold vs warm daemon boot.
//
//   bun run bench/time-to-first-canvas.ts
//
// Zero LLM cost: this never spawns `claude -p`. It only times how long the
// daemon itself takes to become healthy (see daemon-harness.ts's
// waitForDaemonHealth) under two conditions:
//   - cold: a brand-new ~/.parchment (fresh mkdtemp HOME) — the daemon must
//     create its state directory, token file, and database from scratch.
//   - warm: a SECOND boot reusing the SAME HOME the cold boot just
//     initialized — state directory, token, and database already exist.
//
// Each iteration mints one fresh HOME, measures cold-then-warm against it,
// then deletes it — so iterations never share state with each other, but
// cold and warm within one iteration measure the same before/after.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BENCH_RESULTS_DIR, DEFAULT_BENCH_PORT } from "./config.ts";
import { startBenchDaemon } from "./daemon-harness.ts";
import { computeStats } from "./stats.ts";

const ITERATIONS = 5;

type BootTiming = {
  iteration: number;
  coldMs: number;
  warmMs: number;
};

async function main(): Promise<void> {
  const timings: BootTiming[] = [];
  for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
    process.stderr.write(`[time-to-first-canvas] iteration ${iteration}/${ITERATIONS}...\n`);
    timings.push(await measureOneIteration(iteration));
  }

  const resultsDir = join(BENCH_RESULTS_DIR, `${timestampForDirName()}-time-to-first-canvas`);
  mkdirSync(resultsDir, { recursive: true });
  const reportPath = join(resultsDir, "report.md");
  writeFileSync(reportPath, buildReportMarkdown(timings));
  process.stderr.write(`[time-to-first-canvas] wrote ${reportPath}\n`);
}

async function measureOneIteration(iteration: number): Promise<BootTiming> {
  const homeDir = mkdtempSync(join(tmpdir(), "parchment-bench-timing-"));
  try {
    const coldMs = await timeBoot(homeDir);
    const warmMs = await timeBoot(homeDir);
    return { iteration, coldMs, warmMs };
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
}

async function timeBoot(homeDir: string): Promise<number> {
  const startedAt = Date.now();
  const daemon = await startBenchDaemon({ port: DEFAULT_BENCH_PORT, homeDir });
  const elapsedMs = Date.now() - startedAt;
  await daemon.stop();
  return elapsedMs;
}

function buildReportMarkdown(timings: BootTiming[]): string {
  const coldStats = computeStats(timings.map((timing) => timing.coldMs));
  const warmStats = computeStats(timings.map((timing) => timing.warmMs));

  return [
    "# Metric (d): time-to-first-canvas (daemon boot, cold vs warm)",
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Iterations: ${ITERATIONS}`,
    "- Zero LLM cost — this measures daemon boot time only, never spawns `claude -p`.",
    '- "Cold": brand-new `~/.parchment` (fresh HOME, state directory/token/database all created from scratch).',
    '- "Warm": second boot against the SAME `~/.parchment` the cold boot just initialized.',
    "",
    "## Summary (ms)",
    "",
    "| | N | Mean | Median | Min | Max |",
    "|---|---|---|---|---|---|",
    `| Cold boot | ${coldStats.n} | ${coldStats.mean.toFixed(0)} | ${coldStats.median.toFixed(0)} | ${coldStats.min.toFixed(0)} | ${coldStats.max.toFixed(0)} |`,
    `| Warm boot | ${warmStats.n} | ${warmStats.mean.toFixed(0)} | ${warmStats.median.toFixed(0)} | ${warmStats.min.toFixed(0)} | ${warmStats.max.toFixed(0)} |`,
    "",
    "## Raw per-iteration timings (ms)",
    "",
    "| Iteration | Cold | Warm |",
    "|---|---|---|",
    ...timings.map((timing) => `| ${timing.iteration} | ${timing.coldMs} | ${timing.warmMs} |`),
  ].join("\n");
}

function timestampForDirName(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

await main();
