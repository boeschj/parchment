// BROWSER-REAL. The proof that `<DataTable src="results.csv"/>` — one attribute,
// no columns, for a file the model has never opened — paints the real table.
//
// A unit test cannot make this claim. prepareSpec passing and hydrateSpec
// emitting the right props are two facts about JSON; the fact that matters is
// that a header derived by the daemon, bound through the "/hydrated" namespace,
// and resolved by json-render in the browser, arrives in the <th> cells with the
// file's real rows underneath. Only a rendered page shows that, and this is the
// flagship form of the fidelity ladder: if it renders empty, the reference is
// worthless and the model has to paste 50 rows of CSV instead.
//
// Note this drives dist/browser — the bundle the daemon actually serves. Run
// `pnpm build:browser` after touching src/browser or this test judges stale code.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { compileMarkup } from "../daemon/markup/index.ts";
import { prepareSpec } from "../daemon/spec-validation.ts";
import { parseCsv } from "../daemon/hydrate/csv.ts";

const PREFERRED_PORT = 7827;
const TOKEN_HEADER = "x-canvas-token";
const DAEMON_ENTRY = join(import.meta.dir, "..", "daemon", "server.ts");
const BROWSER_BUNDLE = join(import.meta.dir, "..", "..", "dist", "browser", "index.html");
const FIXTURE_CSV = join(import.meta.dir, "..", "..", "evals", "fixtures", "data", "results.csv");
const CSV_NAME = "results.csv";
const HEALTH_POLL_ATTEMPTS = 60;
const HEALTH_POLL_INTERVAL_MS = 100;
const BOOT_TIMEOUT_MS = 60_000;
const DRIVE_TIMEOUT_MS = 60_000;

// What a model writes: the file's name, and nothing about its shape. There is no
// `columns` here and there cannot be one — the model has not read results.csv.
const TABLE_MARKUP = `<DataTable src="${CSV_NAME}" caption="Benchmark runs"/>`;

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

describe("<DataTable src=…csv/> in a real browser", () => {
  test("paints the CSV's real header cells and its real rows", async () => {
    const csv = parseCsv(readFileSync(FIXTURE_CSV, "utf8"));
    const sessionId = "csv-reference";
    await renderMarkup(sessionId, TABLE_MARKUP);
    const page = await openCanvas(sessionId);

    // The header the model never wrote: every column of the file, in file order.
    expect(await headerCells(page)).toEqual(csv.columns);

    // And the rows under it are the file's rows, not a placeholder.
    expect(await bodyRowCount(page)).toBe(csv.rows.length);
    expect(await bodyRow(page, 0)).toEqual(cellsOf(csv.columns, csv.rows[0]));
    expect(await bodyRow(page, csv.rows.length - 1)).toEqual(
      cellsOf(csv.columns, csv.rows[csv.rows.length - 1]),
    );

    await page.close();
  }, DRIVE_TIMEOUT_MS);

  // The derived columns are not just names: a column whose cells parsed as
  // numbers is typed and right-aligned, which is the difference between a table
  // that sorts 1187 before 742 and one that does not.
  test("right-aligns the columns the daemon typed as numbers", async () => {
    const sessionId = "csv-reference-align";
    await renderMarkup(sessionId, TABLE_MARKUP);
    const page = await openCanvas(sessionId);

    expect(await rightAlignedHeaders(page)).toEqual(["tokens_in", "tokens_out", "latency_ms"]);

    await page.close();
  }, DRIVE_TIMEOUT_MS);
});

// ---- Harness ---------------------------------------------------------------

// The canvas_render path exactly: compile the markup, prepareSpec it, POST it.
// The daemon hydrates the $csv on arrival — which is the thing under test.
async function renderMarkup(sessionId: string, markup: string): Promise<void> {
  const compiled = compileMarkup(markup);
  if (compiled.issues.length > 0) throw new Error(`markup did not compile: ${compiled.issues.join("; ")}`);
  const { spec, issues } = prepareSpec(compiled.spec);
  if (issues.length > 0) throw new Error(`spec did not validate: ${issues.join("; ")}`);

  const response = await fetch(`${daemon.baseUrl}/api/sessions/${sessionId}/slots`, {
    method: "POST",
    headers: { "content-type": "application/json", [TOKEN_HEADER]: daemon.token },
    body: JSON.stringify({ kind: "render", title: "Benchmark runs", spec, cwd: daemon.cwd }),
  });
  if (!response.ok) throw new Error(`POST /slots failed: ${response.status} ${await response.text()}`);
}

async function openCanvas(sessionId: string): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(`${daemon.baseUrl}/?session=${sessionId}`);
  await page.locator("table thead th").first().waitFor({ state: "visible" });
  return page;
}

// textContent, not innerText: the table styles its headers uppercase, and the
// question here is what the CELL SAYS, not what CSS made of it.
function headerCells(page: Page): Promise<string[]> {
  return textOf(page, "table thead th");
}

function bodyRowCount(page: Page): Promise<number> {
  return page.locator("table tbody tr").count();
}

function bodyRow(page: Page, rowIndex: number): Promise<string[]> {
  return textOf(page, `table tbody tr:nth-of-type(${rowIndex + 1}) td`);
}

function textOf(page: Page, selector: string): Promise<string[]> {
  return page
    .locator(selector)
    .evaluateAll((cells) => cells.map((cell) => cell.textContent?.trim() ?? ""));
}

// The header text of every column the daemon marked numeric — read back off the
// rendered cells, not off the spec.
function rightAlignedHeaders(page: Page): Promise<string[]> {
  return page
    .locator("table thead th")
    .evaluateAll((cells) =>
      cells
        .filter((cell) => getComputedStyle(cell).textAlign === "right")
        .map((cell) => cell.textContent?.trim() ?? ""),
    );
}

function cellsOf(columns: string[], row: Record<string, string | number> | undefined): string[] {
  if (!row) throw new Error("fixture CSV has no such row");
  return columns.map((column) => String(row[column] ?? ""));
}

// A throwaway HOME, state dir and session cwd: this test must never see, or
// touch, the developer's real ~/.parchment or the daemon they have running. The
// CSV is copied INTO the scratch cwd because reference hydration is confined to
// the session's root.
async function startScratchDaemon(): Promise<Daemon> {
  const homeDir = mkdtempSync(join(tmpdir(), "parchment-csv-test-home-"));
  const stateDir = join(homeDir, ".parchment");
  const cwd = join(homeDir, "workspace");
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  copyFileSync(FIXTURE_CSV, join(cwd, CSV_NAME));
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

// Sibling harnesses (bench/) boot their own daemons; never fight them for a port.
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
