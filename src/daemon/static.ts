import { file } from "bun";
import { homedir } from "node:os";
import { join } from "node:path";
import { errorResponse, ErrorCode, HttpStatus } from "./security.ts";

const UI_DIR = join(import.meta.dir, "..", "..", "dist", "browser");

// Optional user theme. Devs override any design token by dropping a file here;
// it's linked last in index.html so its :root redefinitions win with no rebuild.
// Absent file → empty stylesheet (the app falls back to theme-default.css).
const USER_THEME_PATH = join(homedir(), ".canvas", "theme.css");
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
  const fullPath = join(UI_DIR, target);
  const handle = file(fullPath);
  const exists = await handle.exists();
  if (!exists) {
    // SPA fallback: serve index.html for any unknown path so the React router
    // can resolve client-side. Returns 404 if the bundle isn't built yet.
    const indexHandle = file(join(UI_DIR, "index.html"));
    if (await indexHandle.exists()) return new Response(indexHandle);
    return errorResponse(
      HttpStatus.NotFound,
      ErrorCode.NotFound,
      `static bundle not found at ${UI_DIR}; run 'bun run build:browser' first`,
    );
  }
  return new Response(handle);
}
