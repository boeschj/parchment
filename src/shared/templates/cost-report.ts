import { SlotKind } from "../types.ts";
import { MetricTone, MetricTrend } from "../catalog/extensions/Metric.ts";
import { ChartKind } from "../catalog/extensions/Chart.ts";
import { CalloutTone } from "../catalog/extensions/Callout.ts";
import type { StarterTemplate } from "./types.ts";

// "Cost report" — the spend shape: headline numbers, the daily burn curve by
// model, a per-project breakdown, and a concrete optimization callout. Ties
// into the token/cost-tracking demand signal — the same numbers a live
// fleet/cost dashboard would stream in, frozen as a worked example here.
export const costReportTemplate: StarterTemplate = {
  name: "cost-report",
  title: "Cost report",
  kind: SlotKind.Dashboard,
  spec: {
    root: "page",
    elements: {
      page: {
        type: "Stack",
        props: { gap: "lg" },
        children: ["title", "kpis", "chart", "breakdown", "tip"],
      },
      title: {
        type: "Heading",
        props: { text: "Claude Code usage & cost — last 30 days", level: "h1" },
        children: [],
      },
      kpis: {
        type: "Grid",
        props: { columns: 4, gap: "md" },
        children: ["m-total", "m-sessions", "m-topmodel", "m-projected"],
      },
      "m-total": {
        type: "Metric",
        props: {
          label: "Total spend",
          value: "$284.60",
          delta: "+18%",
          trend: MetricTrend.Up,
          tone: MetricTone.Warning,
          detail: "vs. $241.20 prior 30 days",
        },
        children: [],
      },
      "m-sessions": {
        type: "Metric",
        props: { label: "Sessions", value: "142", detail: "18 active this week" },
        children: [],
      },
      "m-topmodel": {
        type: "Metric",
        props: { label: "Top model", value: "Opus", detail: "62% of spend" },
        children: [],
      },
      "m-projected": {
        type: "Metric",
        props: {
          label: "Projected (30d)",
          value: "$310",
          trend: MetricTrend.Up,
          tone: MetricTone.Warning,
          detail: "at current burn rate",
        },
        children: [],
      },
      chart: {
        type: "Chart",
        props: {
          kind: ChartKind.Line,
          title: "Daily spend by model",
          x: "day",
          y: ["opus", "sonnet", "haiku"],
          height: 320,
          data: [
            { day: "Jun 13", opus: 6.8, sonnet: 2.1, haiku: 0.3 },
            { day: "Jun 14", opus: 8.4, sonnet: 1.8, haiku: 0.2 },
            { day: "Jun 15", opus: 5.2, sonnet: 2.6, haiku: 0.4 },
            { day: "Jun 16", opus: 11.1, sonnet: 3.0, haiku: 0.3 },
            { day: "Jun 17", opus: 9.6, sonnet: 2.4, haiku: 0.5 },
            { day: "Jun 18", opus: 7.3, sonnet: 2.0, haiku: 0.3 },
            { day: "Jun 19", opus: 10.8, sonnet: 3.3, haiku: 0.4 },
            { day: "Jun 20", opus: 12.4, sonnet: 2.9, haiku: 0.3 },
            { day: "Jun 21", opus: 9.1, sonnet: 2.2, haiku: 0.2 },
            { day: "Jun 22", opus: 13.6, sonnet: 3.5, haiku: 0.5 },
          ],
        },
        children: [],
      },
      breakdown: {
        type: "DataTable",
        props: {
          caption: "Spend by project (last 30 days)",
          exportable: true,
          columns: [
            { key: "project", header: "Project" },
            { key: "sessions", header: "Sessions", type: "number", align: "right" },
            { key: "tokens", header: "Tokens", type: "number", align: "right" },
            { key: "cost", header: "Cost", align: "right" },
          ],
          rows: [
            { project: "trace-explorer (worktree)", sessions: 38, tokens: 18_400_000, cost: "$116.80" },
            { project: "parchment", sessions: 51, tokens: 12_100_000, cost: "$74.20" },
            { project: "clawd-canvas", sessions: 29, tokens: 9_600_000, cost: "$58.30" },
            { project: "internal-tools", sessions: 24, tokens: 5_200_000, cost: "$35.30" },
          ],
        },
        children: [],
      },
      tip: {
        type: "Callout",
        props: {
          tone: CalloutTone.Tip,
          title: "Optimization",
          body: "trace-explorer is 41% of spend and mostly Opus on read-heavy exploration passes. Switching its research subagents to Sonnet would save an estimated $60/mo with little quality loss.",
        },
        children: [],
      },
    },
  },
};
