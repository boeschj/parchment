// BROWSER-REAL. The regression test for the submit bug uses a real daemon, the
// real built bundle, a real Chromium, and a real click.
//
// A unit test could not have caught this bug and cannot guard it. The failure
// was not in a function — every function did what it said. It was in the WIRING:
// the fields registered their checks with json-render's ValidationProvider, and
// the thing that runs registered checks (validateAll) had no caller on the
// submit path. Only a rendered page pressing a real button exercises that seam.
//
// Note this drives dist/browser — the bundle the daemon actually serves. Run
// `pnpm build:browser` after touching src/browser or this test judges stale code.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { prepareSpec } from "../daemon/spec-validation.ts";
import { EditKind, type JsonRenderSpec } from "../shared/types.ts";

const PREFERRED_PORT = 7826;
const TOKEN_HEADER = "x-canvas-token";
const DAEMON_ENTRY = join(import.meta.dir, "..", "daemon", "server.ts");
const BROWSER_BUNDLE = join(import.meta.dir, "..", "..", "dist", "browser", "index.html");
const HEALTH_POLL_ATTEMPTS = 60;
const HEALTH_POLL_INTERVAL_MS = 100;
const BOOT_TIMEOUT_MS = 60_000;
const DRIVE_TIMEOUT_MS = 60_000;
const ERROR_SETTLE_MS = 400;

// The spec from the bug report, written exactly the way skills/canvas-tools
// documents a validated form: bound values, `checks`, validateOn "submit", and a
// Button wired to canvas.submit. It passes prepareSpec with zero issues (asserted
// below) — which is what made the old silent no-op so dangerous.
const VALIDATED_FORM_SPEC: JsonRenderSpec = {
  root: "page",
  state: { form: { name: "", email: "" } },
  elements: {
    page: { type: "Stack", props: { gap: "md" }, children: ["nameField", "emailField", "create"] },
    nameField: {
      type: "Input",
      props: {
        label: "Name",
        name: "name",
        value: { $bindState: "/form/name" },
        checks: [{ type: "required", message: "Name is required" }],
        validateOn: "submit",
      },
      children: [],
    },
    emailField: {
      type: "Input",
      props: {
        label: "Email",
        name: "email",
        type: "email",
        value: { $bindState: "/form/email" },
        checks: [
          { type: "required", message: "Email is required" },
          { type: "email", message: "Enter a valid email" },
        ],
        validateOn: "submit",
      },
      children: [],
    },
    create: {
      type: "Button",
      props: { label: "Create" },
      on: { press: { action: "canvas.submit", params: { id: "create-ticket", payload: { $state: "/form" } } } },
      children: [],
    },
  },
};

type Daemon = { baseUrl: string; token: string; stop: () => Promise<void> };
type OverlayEntry = { kind: string; payload: Record<string, unknown> };

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

describe("canvas.submit on a validateOn:'submit' form", () => {
  test("the spec a model would write passes prepareSpec with zero issues", () => {
    const { issues } = prepareSpec(VALIDATED_FORM_SPEC);

    expect(issues).toEqual([]);
  });

  test("refuses an invalid form in the browser, and delivers no submit to the agent", async () => {
    const sessionId = "submit-refusal";
    await renderSlot(sessionId, VALIDATED_FORM_SPEC);
    const page = await openCanvas(sessionId);

    // Garbage: the required name is left empty, the email is not an email.
    await page.fill("#email", "abc");
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForTimeout(ERROR_SETTLE_MS);

    // The form refuses, and it says so under the field that failed — not in one
    // form-level banner. Both checks ran, including on the field never touched.
    expect(await fieldError(page, "name")).toBe("Name is required");
    expect(await fieldError(page, "email")).toBe("Enter a valid email");

    // And no submit reached the agent. This is the payload that used to arrive
    // in the next turn looking exactly like a valid one.
    expect(await formSubmitEdits(sessionId)).toEqual([]);

    await page.close();
  }, DRIVE_TIMEOUT_MS);

  // The control. "Refuses invalid input" is trivially satisfiable by a submit
  // button that refuses everything, which would be a worse bug than the one
  // being fixed. The same form, filled in correctly, must still deliver.
  test("delivers the form-submit edit once the same form is filled in correctly", async () => {
    const sessionId = "submit-delivery";
    await renderSlot(sessionId, VALIDATED_FORM_SPEC);
    const page = await openCanvas(sessionId);

    await page.fill("#name", "Ada");
    await page.fill("#email", "ada@example.com");
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForTimeout(ERROR_SETTLE_MS);

    expect(await fieldError(page, "name")).toBe("");
    expect(await fieldError(page, "email")).toBe("");
    expect(await formSubmitEdits(sessionId)).toEqual([
      { id: "create-ticket", payload: { name: "Ada", email: "ada@example.com" } },
    ]);

    await page.close();
  }, DRIVE_TIMEOUT_MS);
});

// ---- Harness ---------------------------------------------------------------

async function renderSlot(sessionId: string, spec: JsonRenderSpec): Promise<void> {
  // The canvas_render path: prepareSpec, then POST the prepared spec.
  const { spec: prepared, issues } = prepareSpec(spec);
  if (issues.length > 0) throw new Error(`spec did not validate: ${issues.join("; ")}`);

  const response = await fetch(`${daemon.baseUrl}/api/sessions/${sessionId}/slots`, {
    method: "POST",
    headers: { "content-type": "application/json", [TOKEN_HEADER]: daemon.token },
    body: JSON.stringify({ kind: "render", title: "New ticket", spec: prepared }),
  });
  if (!response.ok) throw new Error(`POST /slots failed: ${response.status} ${await response.text()}`);
}

async function openCanvas(sessionId: string): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(`${daemon.baseUrl}/?session=${sessionId}`);
  await page.getByRole("button", { name: "Create" }).waitFor({ state: "visible" });
  return page;
}

// The message the field itself is showing. Scoped to the field's own wrapper —
// the element the failing input lives in — so this cannot pass on a form-level
// banner or on the OTHER field's error.
async function fieldError(page: Page, fieldName: string): Promise<string> {
  const message = page.locator(`#${fieldName}`).locator("xpath=..").locator("p");
  if ((await message.count()) === 0) return "";
  return (await message.first().innerText()).trim();
}

// The submits the agent would act on next turn. Filtered to form-submit: typing
// into a bound field also mirrors its value into the overlay as a generic-edit,
// which is the canvas's continuous state sync and happens whether or not a
// submit is pressed. The submit is the COMMAND, and it is the thing that must
// not fire on an invalid form.
async function formSubmitEdits(sessionId: string): Promise<Record<string, unknown>[]> {
  const response = await fetch(`${daemon.baseUrl}/api/sessions/${sessionId}/edits`, {
    headers: { [TOKEN_HEADER]: daemon.token },
  });
  const payload = (await response.json()) as { entries: OverlayEntry[] };
  return payload.entries.filter((entry) => entry.kind === EditKind.FormSubmit).map((entry) => entry.payload);
}

// A throwaway HOME and state dir: this test must never see, or touch, the
// developer's real ~/.parchment or the daemon they have running.
async function startScratchDaemon(): Promise<Daemon> {
  const homeDir = mkdtempSync(join(tmpdir(), "parchment-form-test-home-"));
  const stateDir = join(homeDir, ".parchment");
  mkdirSync(stateDir, { recursive: true });
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

  return { baseUrl, token, stop };
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
