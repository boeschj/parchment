// The browser driver. Opens an artifact — a file:// page or a daemon canvas URL
// — in real headless Chromium, waits for it to settle, screenshots it, and
// reduces it to DomFacts with the shared in-page probe.
//
// WHY PLAYWRIGHT, not the gstack `browse` binary:
//   1. Reproducibility. A hostile reader must be able to re-run this rubric.
//      Playwright is a pinned devDependency (`pnpm install && npx playwright
//      install chromium`); `browse` is a personal tool on one operator's
//      machine that a third party cannot obtain. A benchmark nobody else can
//      execute is not evidence.
//   2. console.error and uncaught exceptions are first-class page events here.
//      Shelling out per command cannot observe an error that fired during load.
//   3. One browser, one isolated context per run: no state bleed between runs,
//      and no per-assertion process spawn (the matrix is ~100 runs).
// Chromium 1228 is the revision playwright 1.61 pins; it was already in the
// local ms-playwright cache, so this added zero download to the harness.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { CONTENT_ROOT_MISSING, extractPageDomFacts, observeFormRejection, type PageDomFacts } from "./dom-probe.ts";
import { ArtifactKind, ContentRoot, type Artifact, type DomFacts, type FormValidationFacts } from "./types.ts";

const VIEWPORT = { width: 1440, height: 1000 } as const;
const SETTLE_POLL_INTERVAL_MS = 250;
const SETTLE_MAX_WAIT_MS = 12_000;
const SETTLE_STABLE_POLLS = 2;
const CONTENT_ROOT_TIMEOUT_MS = 15_000;
const VALIDATION_RENDER_WAIT_MS = 700;

// Scenarios that assert validation ask the driver to actually drive the form.
export type FormInteraction = {
  invalidFills: { label: string; value: string }[];
  submitButtonText: string;
};

export type AcceptanceBrowser = {
  probe: (artifact: Artifact, screenshotPath: string, formInteraction?: FormInteraction) => Promise<DomFacts>;
  close: () => Promise<void>;
};

// One chromium process for a whole matrix; one fresh context per artifact so no
// run can see another's storage, cache, or console.
export async function createAcceptanceBrowser(): Promise<AcceptanceBrowser> {
  const browser: Browser = await chromium.launch();

  const probe = async (
    artifact: Artifact,
    screenshotPath: string,
    formInteraction?: FormInteraction,
  ): Promise<DomFacts> => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(`uncaught: ${error.message}`));

    try {
      await page.goto(urlFor(artifact), { waitUntil: "load", timeout: CONTENT_ROOT_TIMEOUT_MS });
      const contentRoot = contentRootFor(artifact);
      await page.waitForSelector(contentRoot, { timeout: CONTENT_ROOT_TIMEOUT_MS, state: "attached" });
      const pageFacts = await waitForSettledFacts(page, contentRoot);

      // Screenshot the pristine render, before any interaction dirties it: this
      // image is the artifact a human reviewer rates.
      await screenshotContentRoot(page, contentRoot, screenshotPath);

      const formValidation = formInteraction
        ? await attemptInvalidSubmit(page, contentRoot, pageFacts, formInteraction)
        : null;

      return { ...pageFacts, consoleErrors, formValidation };
    } finally {
      await context.close();
    }
  };

  return { probe, close: () => browser.close() };
}

// Type nonsense into the form, press submit, and record how the page refused —
// natively, with aria-invalid, or with a message. Identical for both arms: it
// only ever touches labels, roles, and standard DOM validity.
async function attemptInvalidSubmit(
  page: Page,
  contentRootSelector: string,
  factsBeforeSubmit: PageDomFacts,
  interaction: FormInteraction,
): Promise<FormValidationFacts> {
  const root = page.locator(contentRootSelector);
  const fields = root.locator("input, textarea, select");

  const filledFields = interaction.invalidFills.map((fill) => ({
    label: fill.label,
    fieldIndex: factsBeforeSubmit.inputs.findIndex((input) =>
      input.labelText.toLowerCase().includes(fill.label.toLowerCase()),
    ),
  }));

  // A form that accepted the bad input submits and navigates away (file:// GET),
  // detaching the page mid-observation. That is not a harness error — it is the
  // page accepting invalid input, which is exactly what this assertion exists to
  // catch. Report every field as un-refused and let the rubric fail it.
  const acceptedEverything: FormValidationFacts = {
    fields: filledFields.map((filled) => ({
      label: filled.label,
      found: filled.fieldIndex !== -1,
      nativeInvalid: false,
      ariaInvalid: false,
      messaged: false,
    })),
    errorMessages: [],
  };

  try {
    for (const filled of filledFields) {
      // A missing field is already a FormInputs failure; nothing to type into.
      if (filled.fieldIndex === -1) continue;
      const value = interaction.invalidFills.find((fill) => fill.label === filled.label)?.value ?? "";
      await fields.nth(filled.fieldIndex).fill(value);
    }

    await page.getByRole("button", { name: interaction.submitButtonText }).first().click({ timeout: 3_000 });
    await page.waitForTimeout(VALIDATION_RENDER_WAIT_MS);

    return await page.evaluate(observeFormRejection, {
      contentRootSelector,
      textBeforeSubmit: factsBeforeSubmit.visibleText,
      filledFields,
    });
  } catch {
    return acceptedEverything;
  }
}

function urlFor(artifact: Artifact): string {
  if (artifact.kind === ArtifactKind.HtmlFile) return pathToFileURL(artifact.filePath).href;
  return artifact.canvasUrl;
}

function contentRootFor(artifact: Artifact): string {
  if (artifact.kind === ArtifactKind.HtmlFile) return ContentRoot.HtmlBody;
  return ContentRoot.ParchmentSlot;
}

// Charts animate in, mermaid lays out asynchronously, and a websocket-fed
// canvas paints after its first frame. Rather than guess a sleep, poll the
// probe until the facts stop changing — then we are measuring a finished page.
async function waitForSettledFacts(page: Page, contentRootSelector: string): Promise<PageDomFacts> {
  const deadline = Date.now() + SETTLE_MAX_WAIT_MS;
  let previousFingerprint = "";
  let stablePolls = 0;
  let latest = await readPageFacts(page, contentRootSelector);

  while (Date.now() < deadline) {
    const fingerprint = fingerprintOf(latest);
    const isStable = fingerprint === previousFingerprint && hasPaintedSomething(latest);
    stablePolls = isStable ? stablePolls + 1 : 0;
    if (stablePolls >= SETTLE_STABLE_POLLS) return latest;

    previousFingerprint = fingerprint;
    await page.waitForTimeout(SETTLE_POLL_INTERVAL_MS);
    latest = await readPageFacts(page, contentRootSelector);
  }
  // Timed out still changing (or still blank): return what we last saw. A blank
  // page fails content-non-empty on its own evidence — the rubric decides, not
  // the driver.
  return latest;
}

function hasPaintedSomething(facts: PageDomFacts): boolean {
  return facts.visibleTextLength > 0 || facts.svgs.length > 0;
}

function fingerprintOf(facts: PageDomFacts): string {
  const chartShape = facts.svgs.map((svg) => svg.dataPointCount).join(",");
  const tableShape = facts.tables.map((table) => table.dataRowCount).join(",");
  return [facts.visibleTextLength, facts.contentHeightPx, chartShape, tableShape, facts.inputs.length].join("|");
}

async function readPageFacts(page: Page, contentRootSelector: string): Promise<PageDomFacts> {
  const result = await page.evaluate(extractPageDomFacts, contentRootSelector);
  if (result === CONTENT_ROOT_MISSING || typeof result === "string") {
    throw new Error(
      `content root "${contentRootSelector}" not found in the page. ` +
        `If parchment's slot container changed, this selector (bench/acceptance/types.ts ContentRoot) must be updated — ` +
        `the probe throws rather than scoring an unscoped page.`,
    );
  }
  return result;
}

// Screenshot the artifact's content root, not the whole window: for parchment
// this crops out the app frame, which keeps a later blinded visual review
// actually blind (a left rail would give the arm away instantly) and makes the
// two arms' images directly comparable.
async function screenshotContentRoot(page: Page, contentRootSelector: string, screenshotPath: string): Promise<void> {
  mkdirSync(dirname(screenshotPath), { recursive: true });
  const element = page.locator(contentRootSelector).first();
  try {
    await element.screenshot({ path: screenshotPath });
  } catch {
    // A zero-height or detached root cannot be element-screenshotted; the
    // full-page fallback still gives the reviewer (and us) the evidence.
    await page.screenshot({ path: screenshotPath, fullPage: true });
  }
}
