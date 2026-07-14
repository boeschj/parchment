// The browser driver. Opens an artifact in real headless Chromium, waits for it
// to FINISH painting, screenshots it, and reduces it to DomFacts with the shared
// in-page probe (bench/acceptance/dom-probe.ts).
//
// The single most important property of this file is the waiting. Charts animate
// in, mermaid lays out asynchronously, and a canvas paints after its first
// frame — so a probe fired too early sees an empty chart and scores a real
// rendering as a failure. A flaky false-negative here would silently corrupt
// every number the eval produces, and it would look exactly like a product bug.
// waitForSettledPageFacts is therefore not a sleep: it polls the very facts we
// are about to score, and only accepts them once they have stopped changing.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import {
  extractPageDomFacts,
  observeFormRejection,
  type PageDomFacts,
} from "../../bench/acceptance/dom-probe.ts";
import {
  ArtifactKind,
  ContentRoot,
  type Artifact,
  type DomFacts,
  type FormValidationFacts,
} from "../../bench/acceptance/types.ts";

const VIEWPORT = { width: 1440, height: 1000 } as const;

const NAVIGATION_TIMEOUT_MS = 20_000;
const NETWORK_IDLE_TIMEOUT_MS = 10_000;
const CONTENT_ROOT_TIMEOUT_MS = 15_000;

const SETTLE_TIMEOUT_MS = 15_000;
const SETTLE_POLL_INTERVAL_MS = 250;
const SETTLE_STABLE_POLLS_REQUIRED = 3;

const SCREENSHOT_EXTENSION = ".png";

const FIELD_FILL_TIMEOUT_MS = 5_000;
const SUBMIT_CLICK_TIMEOUT_MS = 5_000;
// After submit, a page that renders its own validation messages needs a beat to
// paint them. Native constraint failures are instantaneous, so this only matters
// for the arms that complain in the DOM.
const VALIDATION_PAINT_MS = 600;

const FIELD_NOT_FOUND_INDEX = -1;

// The interaction a FormValidation assertion requires: type nonsense into these
// fields, press this button, and see whether the form refuses. Absent for every
// other scenario, in which case DomFacts.formValidation stays null.
export type InvalidSubmitRequest = {
  invalidFills: { label: string; value: string }[];
  submitButtonText: string;
};

export type ProbeOptions = {
  screenshotDir: string;
  screenshotName: string;
  invalidSubmit?: InvalidSubmitRequest;
};

export type ProbedArtifact = {
  facts: DomFacts;
  screenshotPath: string;
};

// One chromium process for a whole matrix (~100 runs), one fresh context per
// artifact: no per-probe process spawn, and no storage/cache/console bleed
// between runs.
let launchedBrowser: Promise<Browser> | null = null;

export function openBrowser(): Promise<Browser> {
  if (launchedBrowser === null) {
    launchedBrowser = chromium.launch({ headless: true });
  }
  return launchedBrowser;
}

export async function closeBrowser(): Promise<void> {
  if (launchedBrowser === null) return;

  const browser = await launchedBrowser;
  launchedBrowser = null;
  await browser.close();
}

export async function probeArtifact(artifact: Artifact, options: ProbeOptions): Promise<ProbedArtifact> {
  const browser = await openBrowser();
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  // console.error and uncaught exceptions never reach the DOM, so the in-page
  // probe is blind to them. They are the driver's job, and they must be
  // subscribed before the first navigation or a load-time crash is missed.
  const consoleErrors = subscribeToConsoleErrors(page);
  const contentRootSelector = contentRootFor(artifact);

  try {
    await page.goto(urlFor(artifact), { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
    await waitForNetworkIdle(page);
    await waitForContentRoot(page, contentRootSelector);

    const pageFacts = await waitForSettledPageFacts(page, contentRootSelector);
    // Screenshot BEFORE the invalid-submit interaction: the evidence image must
    // show the artifact as the model rendered it, not as our own typing left it.
    const screenshotPath = await saveFullPageScreenshot(page, options);
    const formValidation = await attemptInvalidSubmit(page, contentRootSelector, pageFacts, options.invalidSubmit);

    return {
      facts: { ...pageFacts, consoleErrors: [...consoleErrors], formValidation },
      screenshotPath,
    };
  } finally {
    await context.close();
  }
}

function urlFor(artifact: Artifact): string {
  if (artifact.kind === ArtifactKind.HtmlFile) return pathToFileURL(artifact.filePath).href;
  return artifact.canvasUrl;
}

// The only arm-specific knob in the whole checking path, and it exists to make
// the rubric STRICTER for parchment: scoping to the slot's content section
// denies the app's own frame (left rail, session switcher, slot title) the
// chance to satisfy a text assertion without any data being rendered.
function contentRootFor(artifact: Artifact): string {
  if (artifact.kind === ArtifactKind.HtmlFile) return ContentRoot.HtmlBody;
  return ContentRoot.ParchmentSlot;
}

function subscribeToConsoleErrors(page: Page): string[] {
  const consoleErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(`uncaught: ${error.message}`);
  });

  return consoleErrors;
}

// ---- waiting ----

// A page that holds a websocket or an open EventSource (parchment's canvas does)
// may never reach network idle. That is not a failure: the settle loop below is
// the real guarantee, so a timeout here just means "stop waiting for the network
// and start watching the DOM".
async function waitForNetworkIdle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => undefined);
}

async function waitForContentRoot(page: Page, contentRootSelector: string): Promise<void> {
  const contentRoot = await page
    .waitForSelector(contentRootSelector, { state: "attached", timeout: CONTENT_ROOT_TIMEOUT_MS })
    .catch(() => null);
  if (contentRoot) return;

  throw missingContentRootError(contentRootSelector);
}

// Poll the facts we are about to score until they stop changing. Requiring
// SETTLE_STABLE_POLLS_REQUIRED consecutive identical readings — not one — means
// a chart that paints its axes first and its bars a frame later cannot be
// mistaken for a finished page.
//
// hasPaintedSomething is the second half of the guard: an empty root is
// trivially "stable", so a page that renders nothing would settle instantly on
// its own blankness. We keep waiting instead, and if it is still blank at the
// deadline we return the blank facts and let the rubric fail it on its own
// evidence. The driver never decides an artifact is bad — it only decides when
// the page is done.
async function waitForSettledPageFacts(page: Page, contentRootSelector: string): Promise<PageDomFacts> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;

  let latestFacts = await readPageFacts(page, contentRootSelector);
  let previousFingerprint = fingerprintOf(latestFacts);
  let consecutiveStablePolls = 0;

  while (Date.now() < deadline) {
    await page.waitForTimeout(SETTLE_POLL_INTERVAL_MS);
    latestFacts = await readPageFacts(page, contentRootSelector);

    const currentFingerprint = fingerprintOf(latestFacts);
    const isUnchanged = currentFingerprint === previousFingerprint;
    const isSettled = isUnchanged && hasPaintedSomething(latestFacts);

    if (isSettled) {
      consecutiveStablePolls += 1;
    } else {
      consecutiveStablePolls = 0;
    }
    if (consecutiveStablePolls >= SETTLE_STABLE_POLLS_REQUIRED) return latestFacts;

    previousFingerprint = currentFingerprint;
  }

  return latestFacts;
}

// Everything the rubric can read, reduced to one comparable string. Heights are
// rounded because a sub-pixel animation must not be able to keep the page
// "changing" forever.
function fingerprintOf(facts: PageDomFacts): string {
  const chartShapes = facts.svgs.map(
    (svg) => `${svg.dataPointCount}:${svg.textLabels.length}:${Math.round(svg.heightPx)}`,
  );
  const tableShapes = facts.tables.map((table) => `${table.dataRowCount}:${table.rows.length}`);

  return [
    facts.visibleTextLength,
    Math.round(facts.contentHeightPx),
    chartShapes.join(","),
    tableShapes.join(","),
    facts.inputs.length,
    facts.buttonTexts.length,
    facts.errorBoundaryTexts.length,
  ].join("|");
}

function hasPaintedSomething(facts: PageDomFacts): boolean {
  return (
    facts.visibleTextLength > 0 ||
    facts.svgs.length > 0 ||
    facts.tables.length > 0 ||
    facts.inputs.length > 0
  );
}

async function readPageFacts(page: Page, contentRootSelector: string): Promise<PageDomFacts> {
  const facts = await page.evaluate(extractPageDomFacts, contentRootSelector);

  // The probe returns CONTENT_ROOT_MISSING (a string) rather than throwing. We
  // refuse to score a page whose content root vanished: an absent root reduces
  // to empty facts, and empty facts would quietly pass every negative assertion
  // (no console errors, no error boundary) on a page that rendered nothing.
  if (typeof facts === "string") throw missingContentRootError(contentRootSelector);

  return facts;
}

function missingContentRootError(contentRootSelector: string): Error {
  return new Error(
    `content root "${contentRootSelector}" was never found in the page, so there is nothing to score. ` +
      `Acceptance throws rather than scoring a missing root as a pass. If parchment's slot container changed, ` +
      `update ContentRoot in bench/acceptance/types.ts.`,
  );
}

// ---- validation, observed as behaviour ----

// Type nonsense into the named fields, press submit, and read back how the page
// refused. Asserting native `required`/`minlength` markup instead would score
// one technology's way of refusing bad input; asking the form to actually refuse
// is a question any technology can answer.
async function attemptInvalidSubmit(
  page: Page,
  contentRootSelector: string,
  pageFacts: PageDomFacts,
  request: InvalidSubmitRequest | undefined,
): Promise<FormValidationFacts | null> {
  if (request === undefined) return null;

  const filledFields = await fillWithInvalidValues(page, contentRootSelector, pageFacts, request.invalidFills);
  await clickSubmitButton(page, contentRootSelector, request.submitButtonText);
  await page.waitForTimeout(VALIDATION_PAINT_MS);

  return page.evaluate(observeFormRejection, {
    contentRootSelector,
    textBeforeSubmit: pageFacts.visibleText,
    filledFields,
  });
}

// The probe already resolved every input's accessible label, in the same DOM
// order playwright will find them in, so a label maps to a field by index — no
// second, divergent notion of "which input is the password one".
async function fillWithInvalidValues(
  page: Page,
  contentRootSelector: string,
  pageFacts: PageDomFacts,
  invalidFills: InvalidSubmitRequest["invalidFills"],
): Promise<{ label: string; fieldIndex: number }[]> {
  const fields = page.locator(fieldSelectorWithin(contentRootSelector));

  const filledFields = [];
  for (const fill of invalidFills) {
    const fieldIndex = pageFacts.inputs.findIndex((input) => labelMatches(input.labelText, fill.label));
    filledFields.push({ label: fill.label, fieldIndex });

    if (fieldIndex === FIELD_NOT_FOUND_INDEX) continue;

    // A field we cannot type into (a disabled or overlaid control) is not a
    // harness error: the rubric reads it back as "never refused" and fails the
    // page on that evidence.
    await fields
      .nth(fieldIndex)
      .fill(fill.value, { timeout: FIELD_FILL_TIMEOUT_MS })
      .catch(() => undefined);
  }

  return filledFields;
}

// A page with no submit button still gets its invalid input read back: it will
// have refused nothing, which is exactly what the rubric should see. The missing
// button is reported separately by the FormInputs assertion.
async function clickSubmitButton(page: Page, contentRootSelector: string, submitButtonText: string): Promise<void> {
  const submitButton = page
    .locator(contentRootSelector)
    .getByRole("button", { name: submitButtonText })
    .first();

  await submitButton.click({ timeout: SUBMIT_CLICK_TIMEOUT_MS }).catch(() => undefined);
}

function fieldSelectorWithin(contentRootSelector: string): string {
  const fieldTags = ["input", "textarea", "select"];
  return fieldTags.map((tag) => `${contentRootSelector} ${tag}`).join(", ");
}

function labelMatches(labelText: string, requiredLabel: string): boolean {
  return labelText.toLowerCase().includes(requiredLabel.toLowerCase());
}

// ---- evidence ----

async function saveFullPageScreenshot(page: Page, options: ProbeOptions): Promise<string> {
  mkdirSync(options.screenshotDir, { recursive: true });

  const screenshotPath = join(options.screenshotDir, `${options.screenshotName}${SCREENSHOT_EXTENSION}`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  return screenshotPath;
}
