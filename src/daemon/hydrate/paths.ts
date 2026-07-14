// Path resolution + safe reads for the hydrator. Every filesystem access a
// reference performs funnels through here so root confinement, the caps, the
// binary check, and the "regular file" rule live in exactly one place.
//
// SECURITY — root confinement: hydration reads ONLY within the session's
// working directory subtree. A relative path resolves against the cwd; an
// absolute path is honored only when it lands inside the cwd, and one outside
// is REJECTED naming the rule. The confinement check runs against the REAL
// path (symlinks resolved) so a symlink inside the cwd that points at, say,
// /etc/passwd cannot escape the root. Widening the allowed roots is a
// deliberate, user-configured act — never something an agent-supplied path can
// do. These invariants, plus the token on the daemon's routes and the size/
// binary limits below, are the guard.

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

export const MAX_FILE_HYDRATE_BYTES = 512 * 1024;
export const MAX_FILE_READ_BYTES = 8 * 1024 * 1024;
export const MAX_CSV_READ_BYTES = 8 * 1024 * 1024;
export const MAX_CSV_ROWS = 10_000;

const BINARY_SNIFF_BYTES = 8192;
const NULL_BYTE = 0;

export type PathResolution = { ok: true; absPath: string } | { ok: false; error: string };

// Resolves rawPath against the session cwd and confirms the real path stays
// inside the cwd subtree. Returns the REAL, confined absolute path so every
// downstream reader (and the blob allowlist) sees one canonical form.
export function resolveReferencePath(cwd: string, rawPath: string): PathResolution {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "reference path is empty" };
  }
  const root = cwd.trim();
  if (root.length === 0) {
    return {
      ok: false,
      error: `no session working directory to resolve "${trimmed}" against — the daemon received no cwd for this session.`,
    };
  }
  const candidate = isAbsolute(trimmed) ? resolve(trimmed) : resolve(root, trimmed);
  const realRoot = safeRealpath(resolve(root));
  const realCandidate = realpathOfLeaf(candidate);
  if (!isWithinRoot(realRoot, realCandidate)) {
    return {
      ok: false,
      error: `"${trimmed}" resolves outside the session root ${realRoot} — hydration reads only files inside the session's working directory.`,
    };
  }
  return { ok: true, absPath: realCandidate };
}

export function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

// Real path of a possibly-not-yet-existing leaf: realpath the leaf when it
// exists (resolving a symlinked FILE), else realpath its parent (which exists)
// and rejoin the name, so a deleted working-tree file still confines correctly.
function realpathOfLeaf(candidate: string): string {
  if (existsSync(candidate)) return safeRealpath(candidate);
  return join(safeRealpath(dirname(candidate)), basename(candidate));
}

function isWithinRoot(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate.startsWith(rootWithSep);
}

export type RegularFileStat = { ok: true; sizeBytes: number } | { ok: false; error: string };

export function statRegularFile(absPath: string): RegularFileStat {
  if (!existsSync(absPath)) {
    return { ok: false, error: `no file at ${absPath}` };
  }
  const stat = statSync(absPath);
  if (stat.isDirectory()) {
    return { ok: false, error: `${absPath} is a directory, not a file` };
  }
  if (!stat.isFile()) {
    return { ok: false, error: `${absPath} is not a regular file` };
  }
  return { ok: true, sizeBytes: stat.size };
}

export function looksBinary(bytes: Buffer): boolean {
  const scanned = Math.min(bytes.length, BINARY_SNIFF_BYTES);
  for (let index = 0; index < scanned; index += 1) {
    if (bytes[index] === NULL_BYTE) return true;
  }
  return false;
}

function formatKilobytes(bytes: number): string {
  return `${Math.ceil(bytes / 1024)} KB`;
}

export type LineRange = { start: number; end: number };

// "40-80" | "40" | "40-" | "-80". 1-based, inclusive. An open end is Infinity;
// an open start is 1.
export function parseLineRange(raw: string): { ok: true; range: LineRange } | { ok: false; error: string } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d*)-?(\d*)$/);
  const hasSeparator = trimmed.includes("-");
  const rawStart = match?.[1] ?? "";
  const rawEnd = match?.[2] ?? "";
  if (!match || (rawStart === "" && rawEnd === "")) {
    return { ok: false, error: `lines "${raw}" is not a range like "40-80", "40", "40-", or "-80"` };
  }
  const start = rawStart === "" ? 1 : Number.parseInt(rawStart, 10);
  const end = hasSeparator
    ? rawEnd === ""
      ? Number.POSITIVE_INFINITY
      : Number.parseInt(rawEnd, 10)
    : start;
  if (start < 1) {
    return { ok: false, error: `lines "${raw}" starts below line 1` };
  }
  if (end < start) {
    return { ok: false, error: `lines "${raw}" ends before it starts` };
  }
  return { ok: true, range: { start, end } };
}

function sliceLineRange(text: string, range: LineRange): string {
  const lines = text.split("\n");
  const endExclusive = range.end === Number.POSITIVE_INFINITY ? lines.length : range.end;
  return lines.slice(range.start - 1, endExclusive).join("\n");
}

export type TextReadResult = { ok: true; text: string } | { ok: false; error: string };

// The one text-file read the hydrator uses: existence + regular-file + read
// cap + binary rejection + optional line-range slice + hydrate-size cap, with
// over-limit errors that name the exact param to add.
export function readTextForHydration(absPath: string, lines: string | null): TextReadResult {
  const stat = statRegularFile(absPath);
  if (!stat.ok) return stat;
  if (stat.sizeBytes > MAX_FILE_READ_BYTES) {
    return {
      ok: false,
      error: `${absPath} is ${formatKilobytes(stat.sizeBytes)}, past the ${formatKilobytes(MAX_FILE_READ_BYTES)} read ceiling — hydration cannot slice a file this large.`,
    };
  }
  const buffer = readFileSync(absPath);
  if (looksBinary(buffer)) {
    return {
      ok: false,
      error: `${absPath} looks like a binary file; $file hydrates text. For an image use {"$img": "${absPath}"}.`,
    };
  }
  const fullText = buffer.toString("utf8");
  const text = applyLineRangeOrPassThrough(fullText, lines);
  if (!text.ok) return text;
  const resultBytes = Buffer.byteLength(text.value, "utf8");
  if (resultBytes > MAX_FILE_HYDRATE_BYTES) {
    const hint = lines
      ? `narrow the range (it currently selects ${formatKilobytes(resultBytes)}).`
      : `add a line range, e.g. {"$file": "${absPath}", "lines": "1-200"}.`;
    return {
      ok: false,
      error: `${absPath} hydrates to ${formatKilobytes(resultBytes)}, over the ${formatKilobytes(MAX_FILE_HYDRATE_BYTES)} cap — ${hint}`,
    };
  }
  return { ok: true, text: text.value };
}

function applyLineRangeOrPassThrough(
  text: string,
  lines: string | null,
): { ok: true; value: string } | { ok: false; error: string } {
  if (lines === null) return { ok: true, value: text };
  const parsed = parseLineRange(lines);
  if (!parsed.ok) return parsed;
  return { ok: true, value: sliceLineRange(text, parsed.range) };
}
