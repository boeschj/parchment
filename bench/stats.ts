// Small, dependency-free descriptive statistics — every report table needs
// exactly mean/median/min/max/N, and nothing fancier.

export type Stats = {
  n: number;
  mean: number;
  median: number;
  min: number;
  max: number;
};

export function computeStats(values: number[]): Stats {
  if (values.length === 0) return { n: 0, mean: 0, median: 0, min: 0, max: 0 };

  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: values.length,
    mean: sum(values) / values.length,
    median: medianOf(sorted),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function medianOf(sortedValues: number[]): number {
  const midpoint = Math.floor(sortedValues.length / 2);
  const isEvenLength = sortedValues.length % 2 === 0;
  if (!isEvenLength) return sortedValues[midpoint] ?? 0;

  const lower = sortedValues[midpoint - 1] ?? 0;
  const upper = sortedValues[midpoint] ?? 0;
  return (lower + upper) / 2;
}
