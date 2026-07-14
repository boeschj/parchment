#!/usr/bin/env bun
// Live data engine demo: boots the daemon, renders a dashboard slot, binds
// two file-tail sources to it, then appends synthetic log lines forever.
// Open the printed URL and the chart moves within seconds — zero LLM calls.
//
//   bun run scripts/demo-live.ts
//   CANVAS_PORT=7808 bun run scripts/demo-live.ts   (spare-port daemon)

import { appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canvasSessionUrl,
  ensureDaemonAlive,
  pushSlot,
  putLiveSources,
} from "../src/daemon/canvas-client.ts";
import { SlotKind, SlotOrigin, type JsonRenderSpec } from "../src/shared/types.ts";

const DEMO_SESSION_ID = "live-demo";
const DEMO_SLOT_ID = "slot_live_demo";
const APPEND_INTERVAL_MS = 250;
const WINDOW_POINTS = 240;

// Exported so src/daemon/spec-validation.test.ts holds it to the same validator
// the MCP tools use — a shipped example that our own validator rejects is a bug.
export const demoSpec: JsonRenderSpec = {
  root: "page",
  state: { series: [], latest: 0 },
  elements: {
    page: {
      type: "Stack",
      props: { gap: "lg" },
      children: ["heading", "kpis", "trend"],
    },
    heading: { type: "Heading", props: { text: "Live demo — synthetic request rate", level: "h1" }, children: [] },
    kpis: { type: "Grid", props: { columns: 3 }, children: ["current", "spark"] },
    current: {
      type: "Metric",
      props: { label: "Current rps", value: { $template: "${/latest}" }, detail: "streaming via file-tail" },
      children: [],
    },
    spark: {
      type: "Card",
      props: { title: "Trend" },
      children: ["sparkline"],
    },
    sparkline: {
      type: "Sparkline",
      props: { data: { $state: "/series" }, y: "rps", width: 220, height: 48 },
      children: [],
    },
    trend: {
      type: "Chart",
      props: {
        kind: "line",
        title: "Requests per second",
        x: "t",
        y: ["rps", "errors"],
        xScale: "time",
        height: 320,
        data: { $state: "/series" },
      },
      children: [],
    },
  },
};

async function main(): Promise<void> {
  const logPath = join(tmpdir(), `parchment-live-demo-${Date.now()}.jsonl`);
  writeFileSync(logPath, "");

  await ensureDaemonAlive();
  await pushSlot({
    sessionId: DEMO_SESSION_ID,
    kind: SlotKind.Dashboard,
    title: "Live demo",
    spec: demoSpec,
    origin: SlotOrigin.SlashCommand,
    slotId: DEMO_SLOT_ID,
  });
  await putLiveSources(DEMO_SESSION_ID, DEMO_SLOT_ID, [
    {
      id: "series",
      statePath: "/series",
      kind: "file-tail",
      path: logPath,
      parser: "jsonl",
      mode: "append",
      window: WINDOW_POINTS,
    },
    {
      id: "latest",
      statePath: "/latest",
      kind: "file-tail",
      path: logPath,
      parser: "jsonl",
      pluck: "rps",
      mode: "replace",
    },
  ]);

  console.log(`Streaming synthetic log lines into ${logPath}`);
  console.log(`Watch it live: ${canvasSessionUrl(DEMO_SESSION_ID)}`);
  console.log("Ctrl+C to stop.");

  let tick = 0;
  setInterval(() => {
    tick += 1;
    const rps = Math.round(120 + 60 * Math.sin(tick / 12) + Math.random() * 20);
    const errors = Math.round(Math.max(0, 4 * Math.sin(tick / 30) + Math.random() * 3));
    appendFileSync(logPath, `${JSON.stringify({ t: Date.now(), rps, errors })}\n`);
  }, APPEND_INTERVAL_MS);
}

if (import.meta.main) {
  await main();
}
