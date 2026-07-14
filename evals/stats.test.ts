import { describe, expect, test } from "bun:test";
import {
  asNonEmptySamples,
  bootstrapConfidenceInterval,
  bootstrapRatio,
  createSeededRandom,
  DEFAULT_BOOTSTRAP_OPTIONS,
  EstimateStatus,
  InsufficientDataReason,
  mean,
  median,
  percentile,
  stdDev,
  summarize,
  type IntervalEstimate,
  type NonEmptySamples,
} from "./stats.ts";

// The tests below assert against hand-computable answers and against the known
// mean of a synthetic population — never against "whatever the code printed".

function nonEmpty(values: readonly number[]): NonEmptySamples {
  const samples = asNonEmptySamples(values);
  if (!samples) throw new Error("test fixture must not be empty");
  return samples;
}

function expectOk(estimate: IntervalEstimate) {
  if (estimate.status !== EstimateStatus.Ok) {
    throw new Error(`expected an interval, got insufficient-data: ${estimate.reason}`);
  }
  return estimate;
}

describe("point statistics", () => {
  test("mean and median of a hand-computable sample", () => {
    expect(mean(nonEmpty([3, 1, 2]))).toBe(2);
    expect(median(nonEmpty([3, 1, 2]))).toBe(2);
    expect(median(nonEmpty([1, 2, 3, 4]))).toBe(2.5);
  });

  test("stdDev is Bessel-corrected and undefined for a single observation", () => {
    // Deviations from 5: -2,-1,0,1,2 -> sum of squares 10 -> 10/4 = 2.5 -> sqrt.
    expect(stdDev(nonEmpty([3, 4, 5, 6, 7]))).toBeCloseTo(Math.sqrt(2.5), 10);
    expect(stdDev(nonEmpty([42]))).toBeNull();
  });

  test("percentile interpolates between order statistics", () => {
    const samples = nonEmpty([10, 20, 30, 40]);
    expect(percentile(samples, 0)).toBe(10);
    expect(percentile(samples, 1)).toBe(40);
    // rank = 0.5 * 3 = 1.5 -> halfway between 20 and 30.
    expect(percentile(samples, 0.5)).toBe(25);
  });

  test("summarize returns null for an empty sample rather than zeros", () => {
    expect(summarize([])).toBeNull();
    expect(summarize([5, 5])).toEqual({ n: 2, mean: 5, median: 5, stdDev: 0, min: 5, max: 5 });
  });
});

describe("seeded PRNG", () => {
  test("same seed replays the same stream", () => {
    const first = createSeededRandom(DEFAULT_BOOTSTRAP_OPTIONS.seed);
    const second = createSeededRandom(DEFAULT_BOOTSTRAP_OPTIONS.seed);
    const firstDraws = [first(), first(), first()];
    const secondDraws = [second(), second(), second()];
    expect(firstDraws).toEqual(secondDraws);
  });

  test("draws land inside the unit interval", () => {
    const random = createSeededRandom(1);
    const draws = Array.from({ length: 1_000 }, () => random());
    expect(draws.every((draw) => draw >= 0 && draw < 1)).toBe(true);
  });
});

describe("bootstrapConfidenceInterval", () => {
  test("brackets the known mean of a synthetic population", () => {
    // A population whose mean is exactly 100, sampled 40 times.
    const populationMean = 100;
    const samples = Array.from({ length: 40 }, (_unused, index) => {
      const offsetFromMean = (index % 9) - 4;
      return populationMean + offsetFromMean * 5;
    });

    const estimate = expectOk(bootstrapConfidenceInterval(samples, mean));

    expect(estimate.lowerBound).toBeLessThanOrEqual(populationMean);
    expect(estimate.upperBound).toBeGreaterThanOrEqual(populationMean);
    expect(estimate.point).toBeCloseTo(mean(nonEmpty(samples)), 10);
    expect(estimate.lowerBound).toBeLessThan(estimate.upperBound);
    expect(estimate.confidence).toBe(DEFAULT_BOOTSTRAP_OPTIONS.confidence);
  });

  test("is reproducible: the same input yields byte-identical bounds", () => {
    const samples = [12, 19, 31, 44, 58, 61];
    const first = expectOk(bootstrapConfidenceInterval(samples, mean));
    const second = expectOk(bootstrapConfidenceInterval(samples, mean));
    expect(first.lowerBound).toBe(second.lowerBound);
    expect(first.upperBound).toBe(second.upperBound);
  });

  test("all-identical samples give a zero-width interval, not NaN", () => {
    const estimate = expectOk(bootstrapConfidenceInterval([7, 7, 7, 7], mean));
    expect(estimate.point).toBe(7);
    expect(estimate.lowerBound).toBe(7);
    expect(estimate.upperBound).toBe(7);
  });

  test("guards n<2 with an explicit insufficient-data result", () => {
    const empty = bootstrapConfidenceInterval([], mean);
    const single = bootstrapConfidenceInterval([42], mean);
    expect(empty).toEqual({
      status: EstimateStatus.InsufficientData,
      reason: InsufficientDataReason.NoSamples,
    });
    expect(single).toEqual({
      status: EstimateStatus.InsufficientData,
      reason: InsufficientDataReason.SingleSample,
    });
  });
});

describe("bootstrapRatio", () => {
  test("recovers a known ratio on synthetic data", () => {
    // Mean 1000 over mean 100: the true ratio is exactly 10x.
    const expensiveArm = [900, 1000, 1100, 1000, 1000, 1000];
    const cheapArm = [90, 100, 110, 100, 100, 100];

    const estimate = expectOk(bootstrapRatio(expensiveArm, cheapArm));

    expect(estimate.point).toBeCloseTo(10, 6);
    expect(estimate.lowerBound).toBeLessThanOrEqual(10);
    expect(estimate.upperBound).toBeGreaterThanOrEqual(10);
    expect(estimate.resamples).toBe(DEFAULT_BOOTSTRAP_OPTIONS.resamples);
  });

  test("a ratio of identical arms brackets 1.0 — the shape of a null result", () => {
    const realVocabulary = [500, 520, 480, 510, 490, 500];
    const scrambledVocabulary = [505, 495, 515, 485, 500, 500];

    const estimate = expectOk(bootstrapRatio(scrambledVocabulary, realVocabulary));

    expect(estimate.lowerBound).toBeLessThanOrEqual(1);
    expect(estimate.upperBound).toBeGreaterThanOrEqual(1);
  });

  test("a zero denominator is refused, not divided by", () => {
    const estimate = bootstrapRatio([10, 20], [0, 0]);
    expect(estimate).toEqual({
      status: EstimateStatus.InsufficientData,
      reason: InsufficientDataReason.ZeroDenominator,
    });
  });

  test("guards n<2 on either side", () => {
    expect(bootstrapRatio([10], [1, 2])).toEqual({
      status: EstimateStatus.InsufficientData,
      reason: InsufficientDataReason.SingleSample,
    });
    expect(bootstrapRatio([10, 20], [])).toEqual({
      status: EstimateStatus.InsufficientData,
      reason: InsufficientDataReason.NoSamples,
    });
  });
});
