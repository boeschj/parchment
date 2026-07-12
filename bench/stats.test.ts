import { describe, expect, test } from "bun:test";
import { computeStats } from "./stats.ts";

describe("computeStats", () => {
  test("computes mean/median/min/max for an odd-length sample", () => {
    const stats = computeStats([3, 1, 2]);
    expect(stats).toEqual({ n: 3, mean: 2, median: 2, min: 1, max: 3 });
  });

  test("averages the two middle values for an even-length sample", () => {
    const stats = computeStats([1, 2, 3, 4]);
    expect(stats.median).toBe(2.5);
  });

  test("returns all zeros for an empty sample rather than dividing by zero", () => {
    expect(computeStats([])).toEqual({ n: 0, mean: 0, median: 0, min: 0, max: 0 });
  });
});
