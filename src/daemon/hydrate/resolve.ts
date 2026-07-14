// The resolvers: each turns a parsed reference into the value that lands in
// slot state. Shared by the push-time hydrator (index.ts) and the live
// reference-refresh source (../live/reference-refresh.ts), so a watched
// reference re-resolves through exactly the same code that first hydrated it.

import { resolveDiffPatch, resolveDiffSides, type DiffOptions, type DiffSides } from "./git.ts";
import { parseCsv, type CsvParseResult } from "./csv.ts";
import {
  MAX_CSV_READ_BYTES,
  MAX_CSV_ROWS,
  readTextForHydration,
  resolveReferencePath,
  statRegularFile,
} from "./paths.ts";

export type Resolved<T> = { ok: true; value: T; note?: string } | { ok: false; error: string };

export function resolveFileReference(absPath: string, lines: string | null): Resolved<string> {
  const read = readTextForHydration(absPath, lines);
  if (!read.ok) return read;
  return { ok: true, value: read.text };
}

// Resolves to the whole TABLE — header row included — because a CSV reference
// carries a table's shape as well as its data: DataTable's `columns` are derived
// from the header (./columns.ts), and a row cap must never cost the caller the
// header of the rows it kept.
export function resolveCsvReference(absPath: string, limit: number | null): Resolved<CsvParseResult> {
  const stat = statRegularFile(absPath);
  if (!stat.ok) return stat;
  if (stat.sizeBytes > MAX_CSV_READ_BYTES) {
    return {
      ok: false,
      error: `${absPath} is ${Math.ceil(stat.sizeBytes / (1024 * 1024))} MB, over the ${MAX_CSV_READ_BYTES / (1024 * 1024)} MB CSV cap — export a smaller slice.`,
    };
  }
  const read = readTextForHydration(absPath, null);
  if (!read.ok) return read;
  const parsed = parseCsv(read.text);
  const rowCap = Math.min(limit ?? MAX_CSV_ROWS, MAX_CSV_ROWS);
  if (parsed.rows.length <= rowCap) {
    return { ok: true, value: parsed };
  }
  return {
    ok: true,
    value: { columns: parsed.columns, rows: parsed.rows.slice(0, rowCap) },
    note: `capped to ${rowCap} of ${parsed.rows.length} rows`,
  };
}

export function resolveImgReference(
  absPath: string,
  buildUrl: (absPath: string) => string,
): Resolved<string> {
  const stat = statRegularFile(absPath);
  if (!stat.ok) return stat;
  return { ok: true, value: buildUrl(absPath) };
}

export async function resolveDiffSidesReference(
  cwd: string,
  absPath: string,
  displayPath: string,
  options: DiffOptions,
): Promise<Resolved<DiffSides>> {
  const result = await resolveDiffSides(cwd, absPath, displayPath, options);
  if (!result.ok) return result;
  return { ok: true, value: result.sides };
}

export async function resolveDiffPatchReference(
  cwd: string,
  absPath: string,
  displayPath: string,
  options: DiffOptions,
): Promise<Resolved<string>> {
  const result = await resolveDiffPatch(cwd, absPath, displayPath, options);
  if (!result.ok) return result;
  return { ok: true, value: result.patch };
}

// Re-exported so callers get path confinement and resolution from the same
// module they resolve references through.
export { resolveReferencePath };
