// The repair loop: attempt → materialize → browser-verify → repair → repeat.
//
// IT IS THE SAME LOOP FOR EVERY ARM. That is not a convenience, it is the
// experiment's fairness condition. The temptation in a harness written by the
// people who own one of the arms is to hand that arm a better error message —
// parchment's compiler is genuinely good at explaining what went wrong, and a
// raw-HTML arm has no compiler at all. Feeding parchment's hints to a competing
// arm (or, worse, only to ours) would measure the harness's helpfulness, not the
// format's.
//
// So a repair signal may contain exactly two things:
//   1. The arm's OWN toolchain's complaint — its compiler, its validator, its
//      bundler. An arm with no toolchain gets nothing here, which is a real
//      property of that format, not a handicap we imposed.
//   2. The FAILED RUBRIC ASSERTIONS, phrased identically for every arm. This is
//      the same information a human gets by looking at the page: "the table is
//      missing these rows". Never a hint about how to fix it.
//
// Every token of every turn counts toward the run's total (see ledger.ts). An arm
// that passes on its third attempt does not get to report its third attempt's
// cost.

import { join } from "node:path";
import { EvalPaths, MAX_REPAIR_TURNS, RUN_TIMEOUT_MS } from "./config.ts";
import type { EvalDaemon } from "./daemon.ts";
import { runArmAttempt, type ArmAttemptResult } from "./driver.ts";
import { buildAttemptRecord, buildRunRecord } from "./ledger.ts";
import {
  MaterializeOutcome,
  materializeArtifact,
  type AuthoringVocabulary,
} from "./render/materialize.ts";
import { checkAcceptance } from "./verify/index.ts";
import type {
  Arm,
  AttemptRecord,
  EvalModel,
  EvalScenario,
  RepairSignal,
  RunRecord,
} from "./types.ts";

const SCREENSHOTS_DIRNAME = "screenshots";

// The authoring turn plus its repairs.
const MAX_ATTEMPTS = MAX_REPAIR_TURNS + 1;

const TIMEOUT_ISSUE = `the attempt was killed at the ${RUN_TIMEOUT_MS / 1000}s timeout before it produced an artifact.`;
const NOTHING_AUTHORED_ISSUE =
  "the attempt finished without authoring anything: no render call and no file written.";

export type RepairLoopOptions = {
  runId: string;
  arm: Arm;
  scenario: EvalScenario;
  model: EvalModel;
  replicate: number;
  // The run's working directory: where a WrittenFile arm authors its artifact.
  cwd: string;
  daemon: EvalDaemon;
  vocabulary: AuthoringVocabulary;
  // Measured once per (arm, model) by ledger.measureSystemPromptTokens — the
  // arm's protocol cost, paid once per run as actually sent.
  systemPromptTokens: number;
};

export async function runWithRepairLoop(options: RepairLoopOptions): Promise<RunRecord> {
  const attempts: AttemptRecord[] = [];
  const messageIdsAlreadyCounted = new Set<string>();

  let resumeSessionId: string | null = null;
  let repairSignal: RepairSignal | null = null;

  for (let attemptIndex = 0; attemptIndex < MAX_ATTEMPTS; attemptIndex += 1) {
    const prompt = promptFor(options.arm, options.scenario, repairSignal);

    const attempt = await runArmAttempt({
      runId: options.runId,
      attemptIndex,
      arm: options.arm,
      scenario: options.scenario,
      model: options.model,
      prompt,
      cwd: options.cwd,
      daemon: options.daemon,
      // A repair with no memory of what it wrote is not a repair. Resuming the
      // session carries the prior turn's artifact into this turn's context — and
      // its tokens into this turn's bill.
      resumeSessionId,
      previousMessageIds: messageIdsAlreadyCounted,
    });

    const judgement = await judgeAttempt(attempt, options, attemptIndex);

    const ledgerEntry = buildAttemptRecord({
      attemptIndex,
      entries: attempt.entries,
      excludedMessageIds: messageIdsAlreadyCounted,
      wallClockMs: attempt.wallClockMs,
      reportedCostUsd: attempt.cliResult?.totalCostUsd ?? 0,
      artifact: attempt.artifact,
      accepted: judgement.accepted,
      failureReasons: judgement.failureReasons,
    });

    attempts.push(ledgerEntry.record);
    for (const messageId of ledgerEntry.messageIds) messageIdsAlreadyCounted.add(messageId);

    if (judgement.accepted) break;

    resumeSessionId = attempt.sessionId;
    repairSignal = judgement.repairSignal;
  }

  return buildRunRecord({
    runId: options.runId,
    armId: options.arm.id,
    scenarioId: options.scenario.id,
    model: options.model,
    replicate: options.replicate,
    attempts,
    systemPromptTokens: options.systemPromptTokens,
    archivePath: runDirOf(options.runId),
  });
}

function promptFor(arm: Arm, scenario: EvalScenario, repairSignal: RepairSignal | null): string {
  if (repairSignal === null) return arm.encodeTask(scenario);
  return arm.repairPrompt(repairSignal);
}

// ---- Judging one attempt ------------------------------------------------------

type Judgement = {
  accepted: boolean;
  failureReasons: readonly string[];
  // Non-null exactly when the attempt failed.
  repairSignal: RepairSignal | null;
};

async function judgeAttempt(
  attempt: ArmAttemptResult,
  options: RepairLoopOptions,
  attemptIndex: number,
): Promise<Judgement> {
  // A timeout and an empty run are FAILURES, recorded as such. Neither is retried
  // as a flake (see driver.classifyFailure) and neither is silently skipped: a run
  // that quietly vanished from the denominator would inflate every pass rate in
  // the table.
  if (attempt.timedOut) {
    return failed({ toolchainIssues: [TIMEOUT_ISSUE], missingFromPage: [] });
  }
  if (attempt.artifact === null) {
    return failed({ toolchainIssues: [NOTHING_AUTHORED_ISSUE], missingFromPage: [] });
  }

  const materialized = await materializeArtifact({
    arm: options.arm,
    artifact: attempt.artifact,
    canvasSessionId: canvasSessionIdFor(options.runId, attemptIndex),
    title: options.scenario.title,
    daemon: options.daemon,
    runDir: options.cwd,
    vocabulary: options.vocabulary,
  });

  if (materialized.outcome === MaterializeOutcome.ToolchainFailed) {
    // The arm's own compiler/validator/bundler refused its document. That is the
    // arm's error signal, and the only one it gets.
    return failed({ toolchainIssues: materialized.issues, missingFromPage: [] });
  }

  const acceptance = await checkAcceptance(materialized.artifact, options.scenario.acceptance, {
    screenshotDir: screenshotDirFor(options.runId, attemptIndex),
  });

  if (acceptance.passed) return { accepted: true, failureReasons: [], repairSignal: null };

  // The page painted, but it painted the wrong thing. The model is told WHAT is
  // missing, in the rubric's own arm-neutral words — never how to fix it.
  return failed({ toolchainIssues: [], missingFromPage: acceptance.reasons });
}

function failed(repairSignal: RepairSignal): Judgement {
  return {
    accepted: false,
    failureReasons: [...repairSignal.toolchainIssues, ...repairSignal.missingFromPage],
    repairSignal,
  };
}

// ---- Where an attempt's evidence lands ----------------------------------------

// Each attempt pushes to its OWN canvas session, so the browser opens exactly the
// artifact under test. Sharing one session would leave the previous attempt's
// slot on the page, and a rubric could pass on a render the model had already
// replaced.
function canvasSessionIdFor(runId: string, attemptIndex: number): string {
  return `${runId}-attempt-${attemptIndex}`;
}

function screenshotDirFor(runId: string, attemptIndex: number): string {
  return join(runDirOf(runId), `attempt-${attemptIndex}`, SCREENSHOTS_DIRNAME);
}

function runDirOf(runId: string): string {
  return join(EvalPaths.runs, runId);
}
