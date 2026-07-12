// Static price table for the fleet scanner's cost ESTIMATES. Claude Code does
// not persist billed cost, so this is reconstruction, not accounting — every
// consumer must label these numbers estimated. Prices are USD per million
// tokens; cache pricing follows Anthropic's standard multipliers of the input
// rate (reads 0.1x, 5-minute writes 1.25x).

type ModelPricing = {
  matches: string;
  inputPerMTok: number;
  outputPerMTok: number;
};

// First substring match wins, so specific ids stay above family fallbacks.
const MODEL_PRICING: readonly ModelPricing[] = [
  { matches: "opus-4-5", inputPerMTok: 5, outputPerMTok: 25 },
  { matches: "opus", inputPerMTok: 15, outputPerMTok: 75 },
  { matches: "sonnet", inputPerMTok: 3, outputPerMTok: 15 },
  { matches: "haiku-3", inputPerMTok: 0.8, outputPerMTok: 4 },
  { matches: "haiku", inputPerMTok: 1, outputPerMTok: 5 },
  { matches: "fable", inputPerMTok: 5, outputPerMTok: 25 },
] as const;

const UNKNOWN_MODEL_PRICING: ModelPricing = {
  matches: "",
  inputPerMTok: 3,
  outputPerMTok: 15,
};

const CACHE_READ_INPUT_MULTIPLIER = 0.1;
const CACHE_WRITE_INPUT_MULTIPLIER = 1.25;
const TOKENS_PER_MTOK = 1_000_000;

export type ModelTokenTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export function estimateCostUsd(model: string, totals: ModelTokenTotals): number {
  const pricing = pricingForModel(model);
  const inputCost = (totals.inputTokens / TOKENS_PER_MTOK) * pricing.inputPerMTok;
  const outputCost = (totals.outputTokens / TOKENS_PER_MTOK) * pricing.outputPerMTok;
  const cacheReadCost =
    (totals.cacheReadTokens / TOKENS_PER_MTOK) * pricing.inputPerMTok * CACHE_READ_INPUT_MULTIPLIER;
  const cacheWriteCost =
    (totals.cacheWriteTokens / TOKENS_PER_MTOK) * pricing.inputPerMTok * CACHE_WRITE_INPUT_MULTIPLIER;
  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

function pricingForModel(model: string): ModelPricing {
  const normalized = model.toLowerCase();
  const matched = MODEL_PRICING.find((candidate) => normalized.includes(candidate.matches));
  return matched ?? UNKNOWN_MODEL_PRICING;
}
