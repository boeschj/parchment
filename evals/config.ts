// Fixed knobs for the eval. Anything a hostile reader would want to check —
// prices, model ids, ports, limits — is here rather than scattered.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EvalModel } from "./types.ts";

const evalsDir = dirname(fileURLToPath(import.meta.url));

export const EvalPaths = {
  root: evalsDir,
  fixtures: join(evalsDir, "fixtures"),
  results: join(evalsDir, "results"),
  // Scratch HOME for the bench daemon, so a run can never read or write the
  // operator's real ~/.parchment.
  scratchHome: join(evalsDir, ".scratch", "home"),
  runs: join(evalsDir, ".scratch", "runs"),
} as const;

// The bench daemon lives well away from the operator's real daemon on 7801.
export const DAEMON_PORT = 7830;

// Published per-million-token prices, used to convert token counts into the
// cost column. Output is the expensive half — that is the whole point of
// leading every table with it.
export const ModelPricing = {
  [EvalModel.Haiku]: { inputPerMillionUsd: 1, outputPerMillionUsd: 5 },
  [EvalModel.Sonnet]: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  [EvalModel.Opus]: { inputPerMillionUsd: 5, outputPerMillionUsd: 25 },
} as const satisfies Record<EvalModel, { inputPerMillionUsd: number; outputPerMillionUsd: number }>;

// A cached input token bills at ~10% of a fresh one. Reported separately rather
// than folded in: a real user pays the cache write once and then reads cheaply,
// so both the cold and the warm number are true, and both are published.
export const CACHE_READ_PRICE_MULTIPLIER = 0.1;

// How many times a failed artifact may be sent back with its own error signal.
// Every token spent inside the loop counts toward the objective function.
export const MAX_REPAIR_TURNS = 3;

// A run that has not produced a render by here is a failure, not a hang.
export const RUN_TIMEOUT_MS = 240_000;

// Runs are paced rather than parallelised: this drives a subscription, and a
// rate-limit backoff mid-matrix would silently skew wall-clock numbers.
export const DELAY_BETWEEN_RUNS_MS = 1_500;

// Resamples for the bootstrap confidence intervals. N per cell is small enough
// that a bare mean would be indefensible.
export const BOOTSTRAP_RESAMPLES = 10_000;
export const BOOTSTRAP_CONFIDENCE = 0.95;
