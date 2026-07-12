import { file } from "bun";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const UI_DIR = join(import.meta.dir, "..", "..", "dist", "browser");

// Set by the SessionStart first-run builder (hooks/session-start.sh). Present
// only while the initial `bun install && bun run build:browser` is in flight,
// so it distinguishes "still building" from "build never ran / failed".
const BUILD_LOCK_DIR = join(homedir(), ".parchment", "first-run-build.lock");

// Optional user theme. Devs override any design token by dropping a file here;
// it's linked last in index.html so its :root redefinitions win with no rebuild.
// Absent file → empty stylesheet (the app falls back to theme-default.css).
const USER_THEME_PATH = join(homedir(), ".parchment", "theme.css");
const CSS_HEADERS = { "content-type": "text/css; charset=utf-8" } as const;

export async function serveUserTheme(): Promise<Response> {
  const handle = file(USER_THEME_PATH);
  if (await handle.exists()) {
    return new Response(handle, { headers: CSS_HEADERS });
  }
  return new Response("", { headers: CSS_HEADERS });
}

export async function serveStatic(pathname: string): Promise<Response> {
  const safePath = pathname.replace(/^\/+/, "").replace(/\.\.+/g, "");
  const target = safePath === "" || safePath === "ui" ? "index.html" : safePath;
  const handle = file(join(UI_DIR, target));
  if (await handle.exists()) {
    return new Response(handle);
  }

  // SPA fallback: serve index.html for any unknown path so the React router
  // can resolve client-side.
  const indexHandle = file(join(UI_DIR, "index.html"));
  if (await indexHandle.exists()) {
    return new Response(indexHandle);
  }

  // The bundle isn't built yet (cold first-run install, or a build that
  // failed). A raw JSON error in the browser reads as a crash; serve a
  // self-refreshing status page that swaps itself for the real UI the moment
  // the build lands.
  return bundleNotReadyPage();
}

function bundleNotReadyPage(): Response {
  const isBuilding = existsSync(BUILD_LOCK_DIR);
  const heading = isBuilding ? "Building the canvas…" : "The canvas isn’t built yet";
  const detail = isBuilding
    ? "First run installs dependencies and builds the browser bundle — about a minute on a cold cache. This page refreshes on its own; leave it open."
    : "The browser bundle is missing. Start a Claude Code session to trigger the build, or run <code>bun run build:browser</code> in the parchment plugin directory. This page refreshes on its own.";

  return new Response(bundleNotReadyHtml(heading, detail), {
    // 503 is the honest status (temporarily unavailable) and keeps proxies from
    // caching the placeholder, while the HTML still renders in the browser.
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "2",
    },
  });
}

const REFRESH_SECONDS = 2;

function bundleNotReadyHtml(heading: string, detail: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="refresh" content="${REFRESH_SECONDS}" />
<title>parchment</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    background: #0d0d0f; color: #e6e6ea;
    font: 14px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .card {
    max-width: 30rem; padding: 2.5rem; text-align: center;
  }
  .spinner {
    width: 28px; height: 28px; margin: 0 auto 1.5rem;
    border: 2px solid rgba(255,255,255,0.12);
    border-top-color: #cea500; border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  h1 { font-size: 1.05rem; font-weight: 600; margin: 0 0 0.75rem; }
  p { margin: 0; color: #a9a9b2; font-size: 0.9rem; }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85em; color: #e6e6ea;
    background: rgba(255,255,255,0.06); padding: 0.1em 0.4em; border-radius: 4px;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="spinner" aria-hidden="true"></div>
    <h1>${heading}</h1>
    <p>${detail}</p>
  </div>
</body>
</html>`;
}
