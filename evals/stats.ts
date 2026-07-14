// Descriptive statistics and a DETERMINISTIC percentile bootstrap.
//
// WHY a seeded PRNG: a published confidence interval that moves between runs is
// indefensible — a reader cannot check it. Every interval in the report is
// produced by mulberry32 seeded with BOOTSTRAP_SEED, so re-running the report
// command on the archived runs reproduces the published bounds exactly.
//
// WHY the degenerate cases are typed rather than NaN'd: N per cell is small.
// An empty cell, a single replicate, or a zero denominator are all REAL states
// of this eval, and each one must print as "insufficient data" rather than as a
// silent NaN that a reader mistakes for a measurement.

import { BOOTSTRAP_CONFIDENCE, BOOTSTRAP_RESAMPLES } from "./config.ts";

// ---- Samples ----------------------------------------------------------------

// A statistic of zero samples does not exist. Encoding non-emptiness in the type
// makes mean/median/percentile total functions: they cannot return NaN, and no
// caller can forget the empty check.
export type NonEmptySamples = readonly [number, ...number[]];

export type SampleStatistic = (samples: NonEmptySamples) => number;

export function asNonEmptySamples(values: readonly number[]): NonEmptySamples | null {
  const [first, ...rest] = values;
  if (first === undefined) return null;
  return [first, ...rest];
}

// ---- Point statistics -------------------------------------------------------

const MEDIAN_FRACTION = 0.5;
const MIN_SAMPLES_FOR_VARIANCE = 2;
const MIN_SAMPLES_FOR_INTERVAL = 2;

export function mean(samples: NonEmptySamples): number {
  const total = samples.reduce((runningTotal, value) => runningTotal + value, 0);
  return total / samples.length;
}

export function median(samples: NonEmptySamples): number {
  return percentile(samples, MEDIAN_FRACTION);
}

// Sample standard deviation (Bessel-corrected). Null at n=1: the spread of one
// observation is not zero, it is unknown, and printing 0 would claim precision
// this eval does not have.
export function stdDev(samples: NonEmptySamples): number | null {
  if (samples.length < MIN_SAMPLES_FOR_VARIANCE) return null;

  const average = mean(samples);
  const squaredDeviations = samples.map((value) => (value - average) ** 2);
  const sumOfSquares = squaredDeviations.reduce((runningTotal, value) => runningTotal + value, 0);
  return Math.sqrt(sumOfSquares / (samples.length - 1));
}

// Linear interpolation between order statistics (the "R type 7" convention,
// which is also numpy's default), so the same fraction gives the same answer
// anyone else's tooling would give.
export function percentile(samples: NonEmptySamples, fraction: number): number {
  const sorted = [...samples].sort(ascending);
  const clampedFraction = clampToUnitInterval(fraction);
  const rank = clampedFraction * (sorted.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lowerValue = valueAt(sorted, lowerIndex);
  const upperValue = valueAt(sorted, upperIndex);
  const interpolationWeight = rank - lowerIndex;
  return lowerValue + (upperValue - lowerValue) * interpolationWeight;
}

export type SampleSummary = {
  n: number;
  mean: number;
  median: number;
  stdDev: number | null;
  min: number;
  max: number;
};

export function summarize(values: readonly number[]): SampleSummary | null {
  const samples = asNonEmptySamples(values);
  if (!samples) return null;

  const sorted = [...samples].sort(ascending);
  return {
    n: samples.length,
    mean: mean(samples),
    median: median(samples),
    stdDev: stdDev(samples),
    min: valueAt(sorted, 0),
    max: valueAt(sorted, sorted.length - 1),
  };
}

// ---- The seeded PRNG --------------------------------------------------------

// Arbitrary but FIXED. Changing this number changes every published interval,
// so it is a constant in source rather than a flag: the archive and the report
// must always agree.
export const BOOTSTRAP_SEED = 20_260_713;

// mulberry32, verbatim from the public reference implementation. The magic
// numbers below are the algorithm's own constants — naming them would not make
// them more meaningful, and changing them would make this some other, untested
// generator. Chosen because it is 6 lines, has no dependencies, and passes
// gjrand's test suite, which is far more than a bootstrap needs.
const MULBERRY32_INCREMENT = 0x6d2b79f5;
const UINT32_RANGE = 4_294_967_296;

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + MULBERRY32_INCREMENT) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

// ---- The normal quantile (needed by the Wilson interval) ---------------------

// Acklam's rational approximation of the inverse standard normal CDF, verbatim
// from the published coefficients. Absolute error < 1.15e-9 across the open
// interval — orders of magnitude finer than anything this eval can resolve.
//
// WHY it is here at all: a proportion (did the model reach for the reference
// component?) needs a z, and JavaScript has no erf. Rolling our own series would
// be a worse-tested version of this.
const ACKLAM_A = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
  -3.066479806614716e1, 2.506628277459239,
] as const;
const ACKLAM_B = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
  -1.328068155288572e1,
] as const;
const ACKLAM_C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
  4.374664141464968, 2.938163982698783,
] as const;
const ACKLAM_D = [
  7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416,
] as const;
const ACKLAM_LOWER_BREAKPOINT = 0.02425;

export function standardNormalQuantile(probability: number): number {
  const isOutsideTheOpenUnitInterval = probability <= 0 || probability >= 1;
  if (isOutsideTheOpenUnitInterval) {
    throw new RangeError(`the normal quantile is undefined at p=${probability}`);
  }

  const upperBreakpoint = 1 - ACKLAM_LOWER_BREAKPOINT;

  if (probability < ACKLAM_LOWER_BREAKPOINT) {
    return acklamLowerTail(probability);
  }
  if (probability > upperBreakpoint) {
    return -acklamLowerTail(1 - probability);
  }
  return acklamCentral(probability);
}

function acklamCentral(probability: number): number {
  const centred = probability - 0.5;
  const squared = centred * centred;

  const numerator =
    ((((valueAt(ACKLAM_A, 0) * squared + valueAt(ACKLAM_A, 1)) * squared + valueAt(ACKLAM_A, 2)) *
      squared +
      valueAt(ACKLAM_A, 3)) *
      squared +
      valueAt(ACKLAM_A, 4)) *
      squared +
    valueAt(ACKLAM_A, 5);
  const denominator =
    ((((valueAt(ACKLAM_B, 0) * squared + valueAt(ACKLAM_B, 1)) * squared + valueAt(ACKLAM_B, 2)) *
      squared +
      valueAt(ACKLAM_B, 3)) *
      squared +
      valueAt(ACKLAM_B, 4)) *
      squared +
    1;

  return (centred * numerator) / denominator;
}

function acklamLowerTail(probability: number): number {
  const tail = Math.sqrt(-2 * Math.log(probability));

  const numerator =
    ((((valueAt(ACKLAM_C, 0) * tail + valueAt(ACKLAM_C, 1)) * tail + valueAt(ACKLAM_C, 2)) * tail +
      valueAt(ACKLAM_C, 3)) *
      tail +
      valueAt(ACKLAM_C, 4)) *
      tail +
    valueAt(ACKLAM_C, 5);
  const denominator =
    (((valueAt(ACKLAM_D, 0) * tail + valueAt(ACKLAM_D, 1)) * tail + valueAt(ACKLAM_D, 2)) * tail +
      valueAt(ACKLAM_D, 3)) *
      tail +
    1;

  return numerator / denominator;
}

// ---- Interval estimates -----------------------------------------------------

export const EstimateStatus = {
  Ok: "ok",
  InsufficientData: "insufficient-data",
} as const;

export type EstimateStatus = (typeof EstimateStatus)[keyof typeof EstimateStatus];

export const InsufficientDataReason = {
  NoSamples: "no-samples",
  SingleSample: "single-sample",
  ZeroDenominator: "zero-denominator",
} as const;

export type InsufficientDataReason =
  (typeof InsufficientDataReason)[keyof typeof InsufficientDataReason];

// The one refusal shape, shared by every estimator here: a bootstrap and a
// Wilson interval fail for the same reasons, and a caller should be able to
// handle that failure once.
export type InsufficientData = {
  status: typeof EstimateStatus.InsufficientData;
  reason: InsufficientDataReason;
};

export type IntervalEstimate =
  | {
      status: typeof EstimateStatus.Ok;
      point: number;
      lowerBound: number;
      upperBound: number;
      confidence: number;
      // Resamples actually used to form the interval. Equal to the requested
      // count except in bootstrapRatio, where a resample whose denominator came
      // out zero has no ratio and is dropped — visibly, by this number.
      resamples: number;
      seed: number;
    }
  | InsufficientData;

export type BootstrapOptions = {
  resamples: number;
  confidence: number;
  seed: number;
};

export const DEFAULT_BOOTSTRAP_OPTIONS: BootstrapOptions = {
  resamples: BOOTSTRAP_RESAMPLES,
  confidence: BOOTSTRAP_CONFIDENCE,
  seed: BOOTSTRAP_SEED,
};

export const BOOTSTRAP_METHOD_DESCRIPTION =
  "Percentile bootstrap: the sample is resampled with replacement, the statistic is " +
  "recomputed on each resample, and the interval is the empirical [alpha/2, 1-alpha/2] " +
  "quantiles of those resampled statistics (R type-7 interpolation). Resampling is driven " +
  "by mulberry32 seeded with a fixed constant, so every published bound reproduces exactly.";

export function bootstrapConfidenceInterval(
  values: readonly number[],
  statistic: SampleStatistic,
  options: BootstrapOptions = DEFAULT_BOOTSTRAP_OPTIONS,
): IntervalEstimate {
  const samples = asNonEmptySamples(values);
  if (!samples) return insufficientData(InsufficientDataReason.NoSamples);
  if (samples.length < MIN_SAMPLES_FOR_INTERVAL) {
    return insufficientData(InsufficientDataReason.SingleSample);
  }

  const random = createSeededRandom(options.seed);
  const resampledStatistics: number[] = [];
  for (let resample = 0; resample < options.resamples; resample += 1) {
    resampledStatistics.push(statistic(resampleWithReplacement(samples, random)));
  }

  return toPercentileInterval(statistic(samples), resampledStatistics, options);
}

// The interval for meanA / meanB. This is how "10-150x" becomes an honest range
// instead of a bare point estimate: both arms are resampled independently and
// the ratio is recomputed on every pair of resamples.
export function bootstrapRatio(
  numeratorValues: readonly number[],
  denominatorValues: readonly number[],
  options: BootstrapOptions = DEFAULT_BOOTSTRAP_OPTIONS,
): IntervalEstimate {
  const numerator = asNonEmptySamples(numeratorValues);
  const denominator = asNonEmptySamples(denominatorValues);
  if (!numerator || !denominator) return insufficientData(InsufficientDataReason.NoSamples);

  const hasEnoughSamples =
    numerator.length >= MIN_SAMPLES_FOR_INTERVAL && denominator.length >= MIN_SAMPLES_FOR_INTERVAL;
  if (!hasEnoughSamples) return insufficientData(InsufficientDataReason.SingleSample);

  const denominatorMean = mean(denominator);
  if (denominatorMean === 0) return insufficientData(InsufficientDataReason.ZeroDenominator);

  const random = createSeededRandom(options.seed);
  const resampledRatios: number[] = [];
  for (let resample = 0; resample < options.resamples; resample += 1) {
    const numeratorMean = mean(resampleWithReplacement(numerator, random));
    const resampledDenominatorMean = mean(resampleWithReplacement(denominator, random));
    if (resampledDenominatorMean === 0) continue;
    resampledRatios.push(numeratorMean / resampledDenominatorMean);
  }

  const pointEstimate = mean(numerator) / denominatorMean;
  const usableRatios = asNonEmptySamples(resampledRatios);
  if (!usableRatios || usableRatios.length < MIN_SAMPLES_FOR_INTERVAL) {
    return insufficientData(InsufficientDataReason.ZeroDenominator);
  }

  return toPercentileInterval(pointEstimate, resampledRatios, options);
}

// ---- Proportions (did the model reach for the reference component?) ----------

export type ProportionEstimate =
  | {
      status: typeof EstimateStatus.Ok;
      // successes / trials. The bare rate, unsmoothed — the interval carries the
      // uncertainty, so the point estimate never has to lie about it.
      point: number;
      lowerBound: number;
      upperBound: number;
      confidence: number;
      successes: number;
      trials: number;
    }
  | InsufficientData;

// The Wilson score interval.
//
// WHY NOT the normal approximation: a ladder-climbing rate lives AT the
// boundaries — 0/3 or 3/3 — and the normal interval degenerates to [0, 0] and
// [1, 1] there, claiming certainty from three observations. Wilson does not: it
// pulls the centre off the boundary and keeps a real width, which is the honest
// answer when N is this small. It is also what any statistician reviewing this
// page would expect to see for a proportion.
export function wilsonInterval(
  successes: number,
  trials: number,
  confidence: number = BOOTSTRAP_CONFIDENCE,
): ProportionEstimate {
  if (trials <= 0) return insufficientData(InsufficientDataReason.NoSamples);
  if (successes < 0 || successes > trials) {
    throw new RangeError(`${successes} successes is impossible in ${trials} trials`);
  }

  const z = standardNormalQuantile(1 - (1 - confidence) / 2);
  const observedRate = successes / trials;
  const zSquaredOverTrials = (z * z) / trials;

  const centre = (observedRate + zSquaredOverTrials / 2) / (1 + zSquaredOverTrials);
  const spread =
    (z / (1 + zSquaredOverTrials)) *
    Math.sqrt(
      (observedRate * (1 - observedRate)) / trials + (z * z) / (4 * trials * trials),
    );

  return {
    status: EstimateStatus.Ok,
    point: observedRate,
    lowerBound: Math.max(0, centre - spread),
    upperBound: Math.min(1, centre + spread),
    confidence,
    successes,
    trials,
  };
}

export const WILSON_METHOD_DESCRIPTION =
  "Wilson score interval. A rate that sits at 0/N or N/N is exactly where the normal " +
  "approximation degenerates to zero width and claims certainty it has not earned; Wilson keeps " +
  "an honest width at the boundary, which is the regime this eval's small N lives in.";

// ---- Internals --------------------------------------------------------------

function toPercentileInterval(
  pointEstimate: number,
  resampledStatistics: readonly number[],
  options: BootstrapOptions,
): IntervalEstimate {
  const statistics = asNonEmptySamples(resampledStatistics);
  if (!statistics) return insufficientData(InsufficientDataReason.NoSamples);

  const alpha = 1 - options.confidence;
  const lowerFraction = alpha / 2;
  const upperFraction = 1 - alpha / 2;

  return {
    status: EstimateStatus.Ok,
    point: pointEstimate,
    lowerBound: percentile(statistics, lowerFraction),
    upperBound: percentile(statistics, upperFraction),
    confidence: options.confidence,
    resamples: statistics.length,
    seed: options.seed,
  };
}

function resampleWithReplacement(
  samples: NonEmptySamples,
  random: () => number,
): NonEmptySamples {
  const drawn: number[] = [];
  for (let draw = 0; draw < samples.length; draw += 1) {
    const index = Math.floor(random() * samples.length);
    drawn.push(valueAt(samples, index));
  }

  const resampled = asNonEmptySamples(drawn);
  if (!resampled) throw new Error("resampling a non-empty sample produced nothing");
  return resampled;
}

function insufficientData(reason: InsufficientDataReason): InsufficientData {
  return { status: EstimateStatus.InsufficientData, reason };
}

function valueAt(values: readonly number[], index: number): number {
  const value = values[index];
  if (value === undefined) {
    throw new RangeError(`index ${index} is out of range for ${values.length} samples`);
  }
  return value;
}

function ascending(left: number, right: number): number {
  return left - right;
}

function clampToUnitInterval(fraction: number): number {
  return Math.min(1, Math.max(0, fraction));
}
