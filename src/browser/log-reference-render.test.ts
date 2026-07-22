// BROWSER-REAL. The proof that `<LogStream file="app.log" match="ERROR"
// groupBy="10m"/>` — twelve tokens, for a log the model has never opened —
// paints a chart whose buckets and counts are the file's real contents.
//
// The old grammar took groupBy="hour|day|week", so a ten-minute question could
// not use the reference path and had to paste six aggregated data points. A
// reference only pays when
// it can express the question. So the assertions below are not "a chart
// rendered" — they are the file's ground truth, counted independently from the
// bytes on disk and then read back out of the painted DOM:
//
//   Six ten-minute buckets, 9 ERROR lines, and a peak of 3 at 09:30.
//
// If the daemon's aggregation drifts, these numbers stop matching the file and
// this test fails. Note it drives dist/browser — the bundle the daemon serves.
// Run `pnpm build:browser` after touching src/browser or it judges stale code.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { compileMarkup } from "../daemon/markup/index.ts";
import { prepareSpec } from "../daemon/spec-validation.ts";

const PREFERRED_PORT = 7828;
const TOKEN_HEADER = "x-canvas-token";
const DAEMON_ENTRY = join(import.meta.dir, "..", "daemon", "server.ts");
const BROWSER_BUNDLE = join(import.meta.dir, "..", "..", "dist", "browser", "index.html");
const FIXTURE_LOG = join(import.meta.dir, "fixtures", "app.log");
const LOG_NAME = "app.log";
const BUCKET_MINUTES = 10;
const HEALTH_POLL_ATTEMPTS = 60;
const HEALTH_POLL_INTERVAL_MS = 100;
const BOOT_TIMEOUT_MS = 60_000;
const DRIVE_TIMEOUT_MS = 60_000;

// What a model writes. There is no data here, no bucket list, no count — and
// there cannot be: it has not read app.log. `x` and `y` are absent too, because
// which key is the axis and which are the series are facts about the file.
const ERROR_CHART_MARKUP = `<LogStream file="${LOG_NAME}" match="ERROR" groupBy="10m" kind="bar" title="Errors per 10 minutes"/>`;

const LEVEL_CHART_MARKUP = `<LogStream file="${LOG_NAME}" groupBy="10m" pattern="\\s(?<level>ERROR|WARN)\\s" series="level" kind="bar"/>`;

const LINE_CHART_MARKUP = `<LogStream file="${LOG_NAME}" match="ERROR" groupBy="10m"/>`;

type Daemon = { baseUrl: string; token: string; cwd: string; stop: () => Promise<void> };

let daemon: Daemon;
let browser: Browser;

beforeAll(async () => {
  if (!existsSync(BROWSER_BUNDLE)) {
    throw new Error(`no built browser bundle at ${BROWSER_BUNDLE} — run \`pnpm build:browser\` first.`);
  }
  daemon = await startScratchDaemon();
  browser = await chromium.launch();
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
  await browser?.close();
  await daemon?.stop();
});

describe("<LogStream groupBy=…/> in a real browser", () => {
  test("paints one bar per ten-minute bucket, carrying the log's real ERROR counts", async () => {
    const truth = countErrorsPerBucket(readFileSync(FIXTURE_LOG, "utf8"));
    // Pin the fixture's ground truth so either side drifting fails loudly.
    expect(truth.map((bucket) => bucket.label)).toEqual([
      "09:00",
      "09:10",
      "09:20",
      "09:30",
      "09:40",
      "09:50",
    ]);
    expect(truth.map((bucket) => bucket.errors)).toEqual([0, 1, 2, 3, 2, 1]);

    const page = await renderAndOpen("log-reference", ERROR_CHART_MARKUP);

    // The x axis the model never wrote: one tick per bucket the FILE spans,
    // including 09:00, where there is traffic but no error at all.
    expect(await axisTickLabels(page)).toEqual(truth.map((bucket) => bucket.label));

    // And the bars carry the file's real counts—the peak of 3 at 09:30
    // included, and 9 errors across the hour.
    const plotted = await barValueLabels(page);
    expect(plotted).toEqual(truth.map((bucket) => String(bucket.errors)));
    expect(sum(plotted.map(Number))).toBe(9);

    await page.close();
  }, DRIVE_TIMEOUT_MS);

  // The other half of "expressive enough to reach for": ERROR and WARN as two
  // series, from one named-capture pattern — the same `pattern` grammar the
  // file-tail live source already speaks.
  test("splits into one series per captured level, named from the file's own values", async () => {
    const page = await renderAndOpen("log-reference-series", LEVEL_CHART_MARKUP);

    // The legend is the set of levels the DAEMON found in the file.
    expect(await legendLabels(page)).toEqual(["ERROR", "WARN"]);

    // Two series interleaved per bucket: ERROR then WARN, bucket by bucket.
    // 9 ERROR and 6 WARN lines, which is exactly what the fixture holds.
    const plotted = (await barValueLabels(page)).map(Number);
    expect(sum(plotted)).toBe(9 + 6);

    await page.close();
  }, DRIVE_TIMEOUT_MS);

  // The default shape: a line over time, one dot per bucket. Six dots, because
  // the log spans six ten-minute buckets — the count the old grammar could not
  // produce at all.
  test("defaults to a line with one point per bucket, and paints no console error", async () => {
    const consoleErrors: string[] = [];
    const page = await browser.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await renderMarkup("log-reference-line", LINE_CHART_MARKUP);
    await page.goto(`${daemon.baseUrl}/?session=log-reference-line`);
    await page.locator(".recharts-line-dot").first().waitFor({ state: "attached" });

    expect(await page.locator(".recharts-line-dot").count()).toBe(6);
    expect(await axisTickLabels(page)).toContain("09:30");
    expect(consoleErrors).toEqual([]);

    await page.close();
  }, DRIVE_TIMEOUT_MS);
});

// ---- The file's ground truth, counted from the bytes -----------------------

// Deliberately NOT the daemon's aggregator: the point of the test is to compare
// what the chart says against what the file says, so the file is read here with
// nothing but a split and a substring test.
type BucketTruth = { label: string; errors: number };

function countErrorsPerBucket(logText: string): BucketTruth[] {
  const timedLines = logText
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => ({ minuteOfHour: minuteOf(line), isError: line.includes(" ERROR ") }));

  const bucketCount = 60 / BUCKET_MINUTES;
  return Array.from({ length: bucketCount }, (_unused, index) => {
    const bucketStartMinute = index * BUCKET_MINUTES;
    const inBucket = timedLines.filter(
      (line) =>
        line.minuteOfHour >= bucketStartMinute &&
        line.minuteOfHour < bucketStartMinute + BUCKET_MINUTES,
    );
    return {
      label: `09:${String(bucketStartMinute).padStart(2, "0")}`,
      errors: inBucket.filter((line) => line.isError).length,
    };
  });
}

// "2026-05-11T09:34:12.001Z …" → 34. Every line of the fixture is in hour 09.
function minuteOf(line: string): number {
  return Number(line.slice(14, 16));
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

// ---- Reading the painted chart ---------------------------------------------

// The x-axis tick text, in axis order — what a reader sees under the bars.
// (recharts v3 paints tick labels in their own layer, not inside .recharts-xAxis.)
function axisTickLabels(page: Page): Promise<string[]> {
  return textOf(page, ".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value");
}

// recharts paints a value label above each bar (up to 12 bars). This is the
// chart SAYING its numbers, in the DOM, rather than encoding them in path
// geometry — the strongest read available without inverting a pixel scale.
function barValueLabels(page: Page): Promise<string[]> {
  return textOf(page, ".recharts-label-list text");
}

function legendLabels(page: Page): Promise<string[]> {
  return textOf(page, ".recharts-legend-item-text");
}

function textOf(page: Page, selector: string): Promise<string[]> {
  return page
    .locator(selector)
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ""));
}

// ---- Harness ---------------------------------------------------------------

async function renderAndOpen(sessionId: string, markup: string): Promise<Page> {
  await renderMarkup(sessionId, markup);
  const page = await browser.newPage();
  await page.goto(`${daemon.baseUrl}/?session=${sessionId}`);
  await page.locator(".recharts-label-list text").first().waitFor({ state: "attached" });
  return page;
}

// The canvas_render path exactly: compile the markup, prepareSpec it, POST it.
// The daemon aggregates the $log on arrival — which is the thing under test.
async function renderMarkup(sessionId: string, markup: string): Promise<void> {
  const compiled = compileMarkup(markup);
  if (compiled.issues.length > 0) throw new Error(`markup did not compile: ${compiled.issues.join("; ")}`);
  const { spec, issues } = prepareSpec(compiled.spec);
  if (issues.length > 0) throw new Error(`spec did not validate: ${issues.join("; ")}`);

  const response = await fetch(`${daemon.baseUrl}/api/sessions/${sessionId}/slots`, {
    method: "POST",
    headers: { "content-type": "application/json", [TOKEN_HEADER]: daemon.token },
    body: JSON.stringify({ kind: "render", title: "Error rate", spec, cwd: daemon.cwd }),
  });
  if (!response.ok) throw new Error(`POST /slots failed: ${response.status} ${await response.text()}`);
}

// A throwaway HOME, state dir and session cwd: this test must never see, or
// touch, the developer's real ~/.parchment or the daemon they have running. The
// log is copied INTO the scratch cwd because reference hydration is confined to
// the session's root.
async function startScratchDaemon(): Promise<Daemon> {
  const homeDir = mkdtempSync(join(tmpdir(), "parchment-log-test-home-"));
  const stateDir = join(homeDir, ".parchment");
  const cwd = join(homeDir, "workspace");
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  copyFileSync(FIXTURE_LOG, join(cwd, LOG_NAME));
  const port = await findFreePort(PREFERRED_PORT);

  const daemonProcess = Bun.spawn({
    cmd: ["bun", "run", DAEMON_ENTRY],
    env: { ...process.env, HOME: homeDir, PARCHMENT_STATE_DIR: stateDir, CANVAS_PORT: String(port) },
    stdout: "ignore",
    stderr: "ignore",
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl);
  const token = readFileSync(join(stateDir, "server.token"), "utf8").trim();

  const stop = async (): Promise<void> => {
    daemonProcess.kill();
    await daemonProcess.exited;
    rmSync(homeDir, { recursive: true, force: true });
  };

  return { baseUrl, token, cwd, stop };
}

async function waitForHealth(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < HEALTH_POLL_ATTEMPTS; attempt += 1) {
    if (await isHealthy(baseUrl)) return;
    await Bun.sleep(HEALTH_POLL_INTERVAL_MS);
  }
  throw new Error(`scratch daemon at ${baseUrl} never became healthy`);
}

async function isHealthy(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/health`);
    if (!response.ok) return false;
    const payload = (await response.json()) as { ok?: boolean };
    return payload.ok === true;
  } catch {
    return false;
  }
}

// Other browser tests may boot their own daemons; never fight them for a port.
async function findFreePort(firstPort: number): Promise<number> {
  for (let port = firstPort; port < firstPort + 40; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`no free port in [${firstPort}, ${firstPort + 40})`);
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}
