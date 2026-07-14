// A throwaway probe answering ONE question before we spend a single run:
// does a real DiffViewer put the changed code lines into the DOM where the
// browser rubric can see them?
//
// DiffViewer is Monaco-backed, and Monaco VIRTUALIZES: it only mounts the lines
// currently scrolled into view. If our two pinned code strings live below the
// fold, the rubric would fail parchment's own arm for a rendering artifact
// rather than a real defect — and we would have published a loss that isn't
// real. Better to find that out now, for free, than after the pilot.

import { mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { chromium } from "playwright";
import { FIXTURE_FACTS, FIXTURE_PATHS } from "./fixtures/index.ts";
import { extractPageDomFacts, CONTENT_ROOT_MISSING } from "../bench/acceptance/dom-probe.ts";
import { ContentRoot } from "../bench/acceptance/types.ts";
import { startBenchDaemon } from "../bench/daemon-harness.ts";
import { EvalPaths, DAEMON_PORT } from "./config.ts";

const SESSION_ID = "derisk-diffviewer";
const SETTLE_MS = 4_000;

function readFileAtRevision(revision: string): string {
  return execFileSync("git", ["show", `${revision}:${FIXTURE_FACTS.gitDiff.filePath}`], {
    cwd: FIXTURE_PATHS.gitRepo,
    encoding: "utf8",
  });
}

async function main(): Promise<void> {
  const before = readFileAtRevision("HEAD~1");
  const after = readFileAtRevision("HEAD");

  const daemon = await startBenchDaemon({ port: DAEMON_PORT });
  console.log(`daemon up at ${daemon.baseUrl} (scratch HOME: ${daemon.homeDir})`);

  const spec = {
    root: "diff",
    elements: {
      diff: {
        type: "DiffViewer",
        props: { file: FIXTURE_FACTS.gitDiff.filePath, before, after },
        children: [],
      },
    },
  };

  const pushResponse = await fetch(`${daemon.baseUrl}/api/sessions/${SESSION_ID}/slots`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-canvas-token": daemon.token },
    body: JSON.stringify({ kind: "render", title: "derisk", cwd: FIXTURE_PATHS.gitRepo, spec }),
  });
  console.log("push status:", pushResponse.status, (await pushResponse.text()).slice(0, 200));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto(`${daemon.baseUrl}/?session=${SESSION_ID}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(SETTLE_MS);

  const facts = await page.evaluate(extractPageDomFacts, ContentRoot.ParchmentSlot);
  if (facts === CONTENT_ROOT_MISSING || typeof facts === "string") {
    console.log("CONTENT ROOT MISSING — the slot never painted");
    await browser.close();
    await daemon.stop();
    return;
  }

  const screenshotDir = join(EvalPaths.root, ".scratch");
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: join(screenshotDir, "derisk-diffviewer.png"), fullPage: true });

  const addedLineVisible = facts.visibleText.includes(FIXTURE_FACTS.gitDiff.addedCodeLine);
  const removedLineVisible = facts.visibleText.includes(FIXTURE_FACTS.gitDiff.removedCodeLine);
  const filePathVisible = facts.visibleText.includes(FIXTURE_FACTS.gitDiff.filePath);

  console.log("--- VERDICT ---");
  console.log("visibleTextLength :", facts.visibleTextLength);
  console.log("contentHeightPx   :", facts.contentHeightPx);
  console.log("file path visible :", filePathVisible);
  console.log("ADDED line visible:", addedLineVisible, `(${FIXTURE_FACTS.gitDiff.addedCodeLine})`);
  console.log("REMOVED line vis. :", removedLineVisible, `(${FIXTURE_FACTS.gitDiff.removedCodeLine})`);
  console.log("consoleErrors     :", consoleErrors.slice(0, 5));
  console.log("errorBoundaryTexts:", facts.errorBoundaryTexts);
  console.log("visibleText head  :", facts.visibleText.slice(0, 300));

  await browser.close();
  await daemon.stop();
}

await main();
