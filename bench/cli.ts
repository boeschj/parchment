#!/usr/bin/env bun
// Entry point for the benchmark harness.
//
//   bun run bench/cli.ts run --scenario status-dashboard --arms parchment,html --models haiku --reps 2
//
// Boots an isolated bench daemon (only if the parchment arm is requested),
// runs every (scenario × arm × model × repetition) combination through
// runner.ts, archives each run's raw JSONL + metrics, and writes an
// aggregated report.md. See bench/README.md for full usage and cost guidance.

import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startBenchDaemon } from "./daemon-harness.ts";
import { BENCH_RESULTS_DIR, BENCH_RUNS_DIR, DEFAULT_BENCH_PORT, DEFAULT_REPETITIONS } from "./config.ts";
import { runOneRep } from "./runner.ts";
import { saveRawRunRecord, writeReport } from "./report.ts";
import { findScenario, SCENARIOS } from "./scenarios/index.ts";
import { Arm, isParchmentArm, Model, type RunRecord } from "./types.ts";

type RunCommandOptions = {
  scenarioIds: string[];
  arms: Arm[];
  models: Model[];
  repetitions: number;
  daemonPort: number;
};

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (command === "run") {
    await runCommand(parseRunArgs(rest));
    return;
  }

  if (command === "report") {
    reportCommand(rest);
    return;
  }

  printUsage();
  process.exitCode = command === undefined ? 0 : 1;
}

// Rebuilds report.md for an existing results directory from its raw/*.json
// run records — no daemon, no claude -p, zero cost. Lets a report-format
// improvement (like the Spread section) be applied to already-paid-for runs.
function reportCommand(args: string[]): void {
  const flags = parseFlags(args);
  const resultsDir = flags.get("dir");
  if (!resultsDir) throw new Error("usage: bun run bench/cli.ts report --dir bench/results/<timestamp>");

  const records = readRawRunRecords(resultsDir);
  if (records.length === 0) throw new Error(`no raw run records found under ${resultsDir}/raw`);

  const reportPath = writeReport(records, resultsDir, {
    generatedAt: new Date().toISOString(),
    claudeVersions: [...new Set(records.map((record) => record.claudeVersion))],
    scenarioTitlesById: scenarioTitlesForRecords(records),
  });
  process.stderr.write(`[bench] rebuilt ${reportPath} from ${records.length} raw record(s)\n`);
}

function readRawRunRecords(resultsDir: string): RunRecord[] {
  const rawDir = join(resultsDir, "raw");
  const rawFilenames = readdirSync(rawDir).filter((filename) => filename.endsWith(".json"));
  const records = rawFilenames.map(
    (filename) => JSON.parse(readFileSync(join(rawDir, filename), "utf8")) as RunRecord,
  );
  return records.sort(byScenarioArmModelRep);
}

function byScenarioArmModelRep(a: RunRecord, b: RunRecord): number {
  const keyOf = (record: RunRecord): string => `${record.scenarioId}:${record.arm}:${record.model}`;
  const keyCompare = keyOf(a).localeCompare(keyOf(b));
  if (keyCompare !== 0) return keyCompare;
  return a.repetition - b.repetition;
}

function scenarioTitlesForRecords(records: RunRecord[]): Map<string, string> {
  const titles = new Map<string, string>();
  for (const record of records) {
    const known = SCENARIOS.find((scenario) => scenario.id === record.scenarioId);
    titles.set(record.scenarioId, known?.title ?? record.scenarioId);
  }
  return titles;
}

async function runCommand(options: RunCommandOptions): Promise<void> {
  const scenarios = options.scenarioIds.map(findScenario);
  const needsDaemon = options.arms.some(isParchmentArm);
  const daemon = needsDaemon ? await startBenchDaemon({ port: options.daemonPort }) : undefined;

  const resultsDir = join(BENCH_RESULTS_DIR, timestampForDirName());
  const runsRootDir = join(BENCH_RUNS_DIR, timestampForDirName());
  mkdirSync(resultsDir, { recursive: true });
  mkdirSync(runsRootDir, { recursive: true });

  const records: RunRecord[] = [];
  try {
    for (const scenario of scenarios) {
      for (const arm of options.arms) {
        for (const model of options.models) {
          for (let repetition = 1; repetition <= options.repetitions; repetition += 1) {
            process.stderr.write(
              `[bench] ${scenario.id} / ${arm} / ${model} / rep ${repetition}/${options.repetitions}...\n`,
            );
            const record = await runOneRep({
              scenario,
              arm,
              model,
              repetition,
              runsRootDir,
              ...(daemon ? { daemon } : {}),
            });
            records.push(record);
            saveRawRunRecord(resultsDir, record);
            process.stderr.write(
              `[bench]   -> ${record.validation.passed ? "PASS" : "FAIL"} ($${record.claudeResult.totalCostUsd.toFixed(4)})\n`,
            );
          }
        }
      }
    }
  } finally {
    if (daemon) await daemon.stop();
  }

  const reportPath = writeReport(records, resultsDir, {
    generatedAt: new Date().toISOString(),
    claudeVersions: [...new Set(records.map((record) => record.claudeVersion))],
    scenarioTitlesById: new Map(scenarios.map((scenario) => [scenario.id, scenario.title])),
  });
  process.stderr.write(`[bench] wrote ${reportPath}\n`);
}

function parseRunArgs(args: string[]): RunCommandOptions {
  const flags = parseFlags(args);
  const scenarioFlag = flags.get("scenario") ?? "all";
  const scenarioIds = scenarioFlag === "all" ? SCENARIOS.map((scenario) => scenario.id) : scenarioFlag.split(",");

  return {
    scenarioIds,
    arms: parseListFlag(flags.get("arms") ?? "parchment,html", parseArm),
    models: parseListFlag(flags.get("models") ?? "haiku", parseModel),
    repetitions: Number(flags.get("reps") ?? DEFAULT_REPETITIONS),
    daemonPort: Number(flags.get("port") ?? DEFAULT_BENCH_PORT),
  };
}

function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith("--")) continue;
    const name = arg.slice(2);
    const value = args[index + 1] ?? "";
    flags.set(name, value);
    index += 1;
  }
  return flags;
}

function parseListFlag<T>(raw: string, parseOne: (value: string) => T): T[] {
  return raw.split(",").map((value) => parseOne(value.trim()));
}

function parseArm(value: string): Arm {
  if (value === Arm.Parchment || value === Arm.ParchmentMarkup || value === Arm.Html) return value;
  throw new Error(`unknown arm "${value}" — expected "parchment", "parchment-markup", or "html"`);
}

function parseModel(value: string): Model {
  const isKnownModel = value === Model.Haiku || value === Model.Sonnet || value === Model.Opus;
  if (isKnownModel) return value;
  throw new Error(`unknown model "${value}" — expected "haiku", "sonnet", or "opus"`);
}

function timestampForDirName(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function printUsage(): void {
  process.stdout.write(
    [
      "Usage: bun run bench/cli.ts <run|report> [options]",
      "",
      "run options:",
      "  --scenario <id|all>     Scenario id from bench/scenarios/index.ts, or 'all' (default: all)",
      "  --arms <list>           Comma-separated: parchment,parchment-markup,html (default: parchment,html)",
      "  --models <list>         Comma-separated: haiku,sonnet,opus (default: haiku)",
      "  --reps <n>              Repetitions per (scenario, arm, model) (default: 3)",
      "  --port <n>              Bench daemon port (default: 7811)",
      "",
      "report options:",
      "  --dir <path>            Rebuild report.md from an existing results dir's raw/*.json (zero cost)",
      "",
    ].join("\n"),
  );
}

await main();
