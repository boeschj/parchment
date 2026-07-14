// The local-image blob route + URL builder for the $img reference.
//
// SECURITY, three layers:
//  1. Token — an <img> tag cannot send the x-canvas-token header, so the token
//     rides in the query string and serveBlob verifies it with a constant-time
//     compare. A cross-origin page (which never learns the token) cannot pull
//     files through this route, and the daemon is loopback-only with a
//     Host/Origin guard in front.
//  2. Allowlist — the route serves ONLY paths a $img reference actually
//     hydrated. The hydrator registers each resolved image (already confined
//     to the session root by resolveReferencePath) via allowBlobPath; a
//     forged ?path= that was never hydrated is refused even WITH the token.
//     This is what keeps a leaked token from becoming an arbitrary-file read.
//  3. Realpath — the request's path is realpath'd before the allowlist check,
//     so a symlink cannot smuggle a different file past a registered name.
// One regular file per request: no directory listing, size-capped, and the
// content type is sniffed from magic bytes rather than trusted from the name.

import { timingSafeEqual } from "node:crypto";
import { isAbsolute } from "node:path";
import { safeRealpath, statRegularFile } from "./paths.ts";

export const BLOB_ROUTE_PATH = "/api/blob";
const PATH_PARAM = "path";
const TOKEN_PARAM = "token";
const MAX_BLOB_BYTES = 25 * 1024 * 1024;

// Paths a $img reference resolved (and therefore confined) during hydration.
// Re-pushing a slot re-registers them; a daemon restart empties the set, so a
// persisted image URL only serves again once its slot is re-hydrated.
const allowedBlobPaths = new Set<string>();

export function allowBlobPath(realPath: string): void {
  allowedBlobPaths.add(realPath);
}

export function isBlobPathAllowed(realPath: string): boolean {
  return allowedBlobPaths.has(realPath);
}

// A page-origin-relative URL: the browser resolves it against the daemon it
// loaded from, so the daemon's port never has to be hardcoded into slot state.
export function buildBlobUrl(absPath: string, token: string): string {
  const query = new URLSearchParams({ [PATH_PARAM]: absPath, [TOKEN_PARAM]: token });
  return `${BLOB_ROUTE_PATH}?${query.toString()}`;
}

export async function serveBlob(url: URL, serverToken: string): Promise<Response> {
  const providedToken = url.searchParams.get(TOKEN_PARAM);
  if (!tokenMatches(providedToken, serverToken)) {
    return blobError(401, "blob token missing or invalid");
  }
  const requestedPath = url.searchParams.get(PATH_PARAM);
  if (!requestedPath || !isAbsolute(requestedPath)) {
    return blobError(400, "blob path must be an absolute file path");
  }
  const stat = statRegularFile(requestedPath);
  if (!stat.ok) return blobError(404, stat.error);

  const realPath = safeRealpath(requestedPath);
  if (!isBlobPathAllowed(realPath)) {
    return blobError(403, "path was never hydrated by a $img reference — the blob route serves only hydrated images");
  }
  if (stat.sizeBytes > MAX_BLOB_BYTES) {
    return blobError(413, `blob is ${Math.ceil(stat.sizeBytes / (1024 * 1024))} MB, over the 25 MB serve cap`);
  }
  const contentType = await sniffContentType(realPath);
  return new Response(Bun.file(realPath), {
    headers: { "content-type": contentType, "cache-control": "no-store" },
  });
}

function tokenMatches(provided: string | null, expected: string): boolean {
  if (provided === null) return false;
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(providedBytes, expectedBytes);
}

function blobError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: "blob", message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const MAGIC_SIGNATURES = [
  { bytes: [0x89, 0x50, 0x4e, 0x47], type: "image/png" },
  { bytes: [0xff, 0xd8, 0xff], type: "image/jpeg" },
  { bytes: [0x47, 0x49, 0x46, 0x38], type: "image/gif" },
] as const;

const EXTENSION_CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

async function sniffContentType(absPath: string): Promise<string> {
  const header = new Uint8Array(await Bun.file(absPath).slice(0, 16).arrayBuffer());
  const magic = matchMagic(header);
  if (magic) return magic;
  if (isRiffWebp(header)) return "image/webp";
  return extensionContentType(absPath) ?? "application/octet-stream";
}

function matchMagic(header: Uint8Array): string | null {
  for (const signature of MAGIC_SIGNATURES) {
    if (signature.bytes.every((byte, index) => header[index] === byte)) return signature.type;
  }
  return null;
}

function isRiffWebp(header: Uint8Array): boolean {
  const riff = [0x52, 0x49, 0x46, 0x46];
  const webp = [0x57, 0x45, 0x42, 0x50];
  const startsRiff = riff.every((byte, index) => header[index] === byte);
  const hasWebp = webp.every((byte, index) => header[index + 8] === byte);
  return startsRiff && hasWebp;
}

function extensionContentType(absPath: string): string | null {
  const lastDot = absPath.lastIndexOf(".");
  if (lastDot === -1) return null;
  const extension = absPath.slice(lastDot + 1).toLowerCase();
  return EXTENSION_CONTENT_TYPES[extension] ?? null;
}
