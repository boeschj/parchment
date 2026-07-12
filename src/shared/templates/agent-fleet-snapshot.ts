import { SessionStatus, SlotKind } from "../types.ts";
import { MetricTrend } from "../catalog/extensions/Metric.ts";
import { ChartKind } from "../catalog/extensions/Chart.ts";
import { CalloutTone } from "../catalog/extensions/Callout.ts";
import type { StarterTemplate } from "./types.ts";

// "Agent fleet snapshot" — a frozen example of the flagship dashboard shape:
// what every concurrent Claude Code session is doing, its token burn, and
// the fleet's token curve. A live version of this (streamed via a
// registered data source) is the north-star demo for the daemon; this
// starter template is the static composition to build that from.
export const agentFleetSnapshotTemplate: StarterTemplate = {
  name: "agent-fleet-snapshot",
  title: "Agent fleet snapshot",
  kind: SlotKind.Dashboard,
  spec: {
    root: "page",
    elements: {
      page: {
        type: "Stack",
        props: { gap: "lg" },
        children: ["title", "kpis", "sessions", "chart", "note"],
      },
      title: {
        type: "Heading",
        props: { text: "Agent fleet — live snapshot", level: "h1" },
        children: [],
      },
      kpis: {
        type: "Grid",
        props: { columns: 4, gap: "md" },
        children: ["m-active", "m-tokens", "m-avg-cost", "m-longest"],
      },
      "m-active": {
        type: "Metric",
        props: { label: "Active sessions", value: "5", detail: "3 working, 2 idle" },
        children: [],
      },
      "m-tokens": {
        type: "Metric",
        props: { label: "Tokens today", value: "2.4M", delta: "+340K", trend: MetricTrend.Up },
        children: [],
      },
      "m-avg-cost": {
        type: "Metric",
        props: { label: "Avg session cost", value: "$1.86", detail: "across today's sessions" },
        children: [],
      },
      "m-longest": {
        type: "Metric",
        props: { label: "Longest running", value: "2h 14m", detail: "trace-explorer rearchitecture" },
        children: [],
      },
      sessions: {
        type: "DataTable",
        props: {
          caption: "Sessions",
          columns: [
            { key: "session", header: "Session" },
            { key: "status", header: "Status" },
            { key: "cwd", header: "Working dir" },
            { key: "tokens", header: "Tokens", type: "number", align: "right" },
            { key: "cost", header: "Cost", align: "right" },
          ],
          rows: [
            { session: "a2d20b9", status: SessionStatus.Working, cwd: "~/code/parchment", tokens: 812_000, cost: "$0.94" },
            { session: "f61c8e2", status: SessionStatus.Working, cwd: "~/code/trace-explorer", tokens: 1_240_000, cost: "$2.31" },
            { session: "9b3a041", status: SessionStatus.Working, cwd: "~/code/api-gateway", tokens: 340_000, cost: "$0.41" },
            { session: "d70e5c8", status: SessionStatus.Complete, cwd: "~/code/parchment", tokens: 210_000, cost: "$0.28" },
            { session: "1c4f9a6", status: SessionStatus.Blocked, cwd: "~/code/docs-site", tokens: 96_000, cost: "$0.11" },
          ],
        },
        children: [],
      },
      chart: {
        type: "Chart",
        props: {
          kind: ChartKind.Area,
          title: "Token usage — last 6 hours",
          x: "time",
          y: ["input", "output"],
          height: 280,
          data: [
            { time: "09:00", input: 120_000, output: 40_000 },
            { time: "10:00", input: 180_000, output: 62_000 },
            { time: "11:00", input: 260_000, output: 88_000 },
            { time: "12:00", input: 210_000, output: 74_000 },
            { time: "13:00", input: 340_000, output: 121_000 },
            { time: "14:00", input: 410_000, output: 148_000 },
          ],
        },
        children: [],
      },
      note: {
        type: "Callout",
        props: {
          tone: CalloutTone.Info,
          title: "Fleet note",
          body: "docs-site has been blocked for 40 minutes waiting on a permission prompt — worth a nudge if nobody's watching that terminal.",
        },
        children: [],
      },
    },
  },
};
