// Aggregates RunRecords into the publishable report.md: one summary table
// per (scenario, arm, model) group, a raw per-run table for full
// transparency, and a methodology section spelling out what's measured,
// what's controlled, and what this run does not prove.

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeStats, type Stats } from "./stats.ts";
import type { Arm, Model, RunRecord } from "./types.ts";

export type ReportMeta = {
  generatedAt: string;
  claudeVersions: string[];
  scenarioTitlesById: Map<string, string>;
};

// Shared by saveRawRunRecord (which writes these files) and
// buildRawRunsSection (which links to them) so the report's links can never
// drift from what actually landed on disk.
function runArchiveName(record: RunRecord): string {
  return `${record.scenarioId}-${record.arm}-${record.model}-rep${record.repetition}`;
}

export function saveRawRunRecord(resultsDir: string, record: RunRecord): void {
  const rawDir = join(resultsDir, "raw");
  const jsonlArchiveDir = join(resultsDir, "raw", "jsonl");
  mkdirSync(rawDir, { recursive: true });
  mkdirSync(jsonlArchiveDir, { recursive: true });

  const runName = runArchiveName(record);
  writeFileSync(join(rawDir, `${runName}.json`), JSON.stringify(record, null, 2));
  copyFileSync(record.jsonlPath, join(jsonlArchiveDir, `${runName}.jsonl`));
}

export function writeReport(records: RunRecord[], resultsDir: string, meta: ReportMeta): string {
  const reportPath = join(resultsDir, "report.md");
  writeFileSync(reportPath, buildReportMarkdown(records, meta));
  return reportPath;
}

export function buildReportMarkdown(records: RunRecord[], meta: ReportMeta): string {
  const sections = [
    buildHeader(meta),
    buildMethodologySection(),
    buildSummarySection(records, meta),
    buildSpreadSection(records, meta),
    buildRawRunsSection(records),
  ];
  return sections.join("\n\n");
}

function buildHeader(meta: ReportMeta): string {
  return [
    "# Parchment benchmark report",
    "",
    `- Generated: ${meta.generatedAt}`,
    `- Claude Code version(s) observed: ${meta.claudeVersions.join(", ") || "unknown"}`,
  ].join("\n");
}

function buildMethodologySection(): string {
  return [
    "## Methodology",
    "",
    "**What's measured:** for each (scenario, arm, model) combination, N repetitions of a single",
    "headless `claude -p` turn attempting a fixed task. Metrics are derived two ways: token/turn",
    "counts come from parsing the run's own session JSONL (`@boeschj/claude-jsonl`); pass/fail",
    "correctness comes from an independent, arm-appropriate validator — the live parchment daemon's",
    "HTTP API for the parchment arm, a regex-based structural check of the written file for the HTML arm.",
    "",
    "**What's controlled:** every run passes `--setting-sources \"\"` so a developer's personal",
    "CLAUDE.md, memory files, and project settings never inflate the measured token counts.",
    "Tool availability is scoped per arm and per scenario — the parchment arm can only call the",
    "one canvas_* tool the scenario is testing; the HTML arm can only call Write/Edit. The parchment",
    "arm runs against an isolated, disposable parchment daemon (its own HOME, its own port) — never",
    "a developer's real, interactively-used daemon.",
    "",
    "**Known limitations:**",
    "- The HTML arm has no analog to canvas_render's server-side validate-and-reject loop: an",
    "  invalid HTML artifact simply ships broken, with no structural retry signal mid-session. A",
    "  higher `passes-to-correct-render` for the parchment arm on a given scenario can mean the",
    "  tool caught and forced a fix — not that parchment is slower to a correct result.",
    "- \"First paint\" is a proxy: for parchment it's the first accepted (non-error) render tool",
    "  call; for HTML it's the first successful write of the output file. Neither confirms a human",
    "  actually looked at a rendered browser tab.",
    "- tokens-per-live-update (metric c) is not measured end-to-end here: parchment's live data",
    "  engine (file-tail/command-poll sources feeding slot state with zero LLM calls) had not",
    "  landed as of this report. See bench/scenarios/live-update-plan.ts for the interface the",
    "  moderate suite will measure against once it does.",
    "- Costs reflect this machine's model pricing and Anthropic's prompt-caching behavior at run",
    "  time; they are not a stable long-term forecast.",
  ].join("\n");
}

type GroupKey = { scenarioId: string; arm: Arm; model: Model };

function buildSummarySection(records: RunRecord[], meta: ReportMeta): string {
  const groups = groupRecords(records);
  const rows = [...groups.entries()].map(([, group]) => buildSummaryRow(group, meta));
  const header =
    "| Scenario | Arm | Model | N | Pass rate | Cost (mean $) | Prompt+completion tokens (mean) | Turns to first paint (mean) | Tokens to first paint (mean) | Render attempts (mean) |";
  const divider = "|---|---|---|---|---|---|---|---|---|---|";
  return ["## Summary (mean unless noted)", "", header, divider, ...rows].join("\n");
}

function buildSummaryRow(group: RunRecord[], meta: ReportMeta): string {
  const first = group[0];
  if (!first) return "";

  const scenarioTitle = meta.scenarioTitlesById.get(first.scenarioId) ?? first.scenarioId;
  const passRate = group.filter((record) => record.validation.passed).length / group.length;
  const costStats = statsOf(group, (record) => record.claudeResult.totalCostUsd);
  const tokenStats = statsOf(
    group,
    (record) => record.transcript.totalPromptTokens + record.transcript.totalCompletionTokens,
  );
  const turnsToFirstPaintStats = statsOf(group, (record) => record.transcript.turnsToFirstPaint ?? Number.NaN);
  const tokensToFirstPaintStats = statsOf(group, (record) => record.transcript.tokensToFirstPaint ?? Number.NaN);
  const renderAttemptsStats = statsOf(group, (record) => record.transcript.renderAttempts);

  return [
    "|",
    scenarioTitle,
    "|",
    first.arm,
    "|",
    first.model,
    "|",
    String(group.length),
    "|",
    formatPercent(passRate),
    "|",
    formatDollars(costStats.mean),
    "|",
    formatNumber(tokenStats.mean),
    "|",
    formatMaybeNumber(turnsToFirstPaintStats.mean),
    "|",
    formatMaybeNumber(tokensToFirstPaintStats.mean),
    "|",
    formatNumber(renderAttemptsStats.mean),
    "|",
  ].join(" ");
}

// Full distribution per group — the summary table above reports means only,
// and per-run variance is real (2x cost swings within one arm/scenario/model
// were observed in the very first smoke run), so publishable numbers need the
// spread, not just the center.
function buildSpreadSection(records: RunRecord[], meta: ReportMeta): string {
  const groups = groupRecords(records);
  const rows = [...groups.values()].map((group) => buildSpreadRow(group, meta));
  const header =
    "| Scenario | Arm | Model | N | Cost $ (mean / median / min / max) | Tokens (mean / median / min / max) | Tokens to first paint (mean / median / min / max) |";
  const divider = "|---|---|---|---|---|---|---|";
  return ["## Spread (mean / median / min / max)", "", header, divider, ...rows].join("\n");
}

function buildSpreadRow(group: RunRecord[], meta: ReportMeta): string {
  const first = group[0];
  if (!first) return "";

  const scenarioTitle = meta.scenarioTitlesById.get(first.scenarioId) ?? first.scenarioId;
  const costStats = statsOf(group, (record) => record.claudeResult.totalCostUsd);
  const tokenStats = statsOf(
    group,
    (record) => record.transcript.totalPromptTokens + record.transcript.totalCompletionTokens,
  );
  const tokensToFirstPaintStats = statsOf(group, (record) => record.transcript.tokensToFirstPaint ?? Number.NaN);

  return [
    "|",
    scenarioTitle,
    "|",
    first.arm,
    "|",
    first.model,
    "|",
    String(group.length),
    "|",
    formatStatsSpread(costStats, formatDollars),
    "|",
    formatStatsSpread(tokenStats, formatNumber),
    "|",
    formatStatsSpread(tokensToFirstPaintStats, formatNumber),
    "|",
  ].join(" ");
}

function formatStatsSpread(stats: Stats, formatOne: (value: number) => string): string {
  if (stats.n === 0) return "never";
  return [stats.mean, stats.median, stats.min, stats.max].map(formatOne).join(" / ");
}

function buildRawRunsSection(records: RunRecord[]): string {
  const header = "| Scenario | Arm | Model | Rep | Passed | Cost $ | Tokens | Turns | JSONL |";
  const divider = "|---|---|---|---|---|---|---|---|---|";
  const rows = records.map((record) => {
    const tokens = record.transcript.totalPromptTokens + record.transcript.totalCompletionTokens;
    return [
      "|",
      record.scenarioId,
      "|",
      record.arm,
      "|",
      record.model,
      "|",
      String(record.repetition),
      "|",
      record.validation.passed ? "yes" : `no (${record.validation.reasons.join("; ")})`,
      "|",
      formatDollars(record.claudeResult.totalCostUsd),
      "|",
      String(tokens),
      "|",
      String(record.transcript.assistantTurnCount),
      "|",
      `\`raw/jsonl/${runArchiveName(record)}.jsonl\``,
      "|",
    ].join(" ");
  });
  return ["## Raw runs", "", header, divider, ...rows].join("\n");
}

function groupRecords(records: RunRecord[]): Map<string, RunRecord[]> {
  const groups = new Map<string, RunRecord[]>();
  for (const record of records) {
    const key = groupKeyOf(record);
    const existing = groups.get(key) ?? [];
    existing.push(record);
    groups.set(key, existing);
  }
  return groups;
}

function groupKeyOf(record: GroupKey): string {
  return `${record.scenarioId}::${record.arm}::${record.model}`;
}

function statsOf(group: RunRecord[], selector: (record: RunRecord) => number): Stats {
  const values = group.map(selector).filter((value) => !Number.isNaN(value));
  return computeStats(values);
}

function formatDollars(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatNumber(value: number): string {
  return value.toFixed(0);
}

function formatMaybeNumber(value: number): string {
  return Number.isNaN(value) ? "never" : value.toFixed(0);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}
