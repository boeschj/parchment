import { file } from "bun";
import { join } from "node:path";
import { errorResponse, ErrorCode, HttpStatus } from "./security.ts";

const UI_DIR = join(import.meta.dir, "..", "..", "dist", "browser");

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
