// The saved-UI library at ~/.parchment/library/<name>.json — one JSON file
// per saved slot (spec + optional state). Shared by the MCP tools
// (canvas_save/canvas_load/canvas_library in mcp-stdio.ts, a separate
// process per session) and the daemon's /api/library HTTP routes (server.ts,
// read by the browser's library panel), so both sides agree on the file
// format and the slugification rule from a single place.

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LibraryEntry, LibraryListing } from "../shared/types.ts";
import { STARTER_TEMPLATES } from "../shared/templates/index.ts";
import { STATE_DIR } from "./state.ts";

export const LIBRARY_DIR = join(STATE_DIR, "library");

// Marks that the starter templates have already been copied in, so deleting
// one intentionally doesn't bring it back on the next seed check.
const SEEDED_MARKER_PATH = join(LIBRARY_DIR, ".seeded");

export function libraryNameToPath(name: string): string {
  const slug = slugify(name);
  if (slug.length === 0) throw new Error(`invalid library name: "${name}"`);
  return join(LIBRARY_DIR, `${slug}.json`);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isLibraryFile(fileName: string): boolean {
  return fileName.endsWith(".json");
}

function readEntryFile(path: string): LibraryEntry {
  return JSON.parse(readFileSync(path, "utf8")) as LibraryEntry;
}

export function writeLibraryEntry(entry: LibraryEntry): string {
  mkdirSync(LIBRARY_DIR, { recursive: true });
  const target = libraryNameToPath(entry.name);
  writeFileSync(target, JSON.stringify(entry, null, 2));
  return target;
}

export function readLibraryEntry(name: string): LibraryEntry | null {
  const target = libraryNameToPath(name);
  if (!existsSync(target)) return null;
  return readEntryFile(target);
}

export function deleteLibraryEntry(name: string): boolean {
  const target = libraryNameToPath(name);
  if (!existsSync(target)) return false;
  unlinkSync(target);
  return true;
}

export function listLibraryEntryNames(): string[] {
  if (!existsSync(LIBRARY_DIR)) return [];
  return readdirSync(LIBRARY_DIR)
    .filter(isLibraryFile)
    .map((fileName) => fileName.replace(/\.json$/, ""));
}

// The lightweight listing the browser's library panel renders — every saved
// entry's metadata, without shipping each one's full (potentially large)
// spec over the wire. Newest first.
export function listLibraryEntries(): LibraryListing[] {
  if (!existsSync(LIBRARY_DIR)) return [];
  const listings = readdirSync(LIBRARY_DIR)
    .filter(isLibraryFile)
    .map((fileName) => toListing(join(LIBRARY_DIR, fileName)))
    .filter((listing): listing is LibraryListing => listing !== null);
  return listings.sort((a, b) => b.savedAt - a.savedAt);
}

function toListing(path: string): LibraryListing | null {
  try {
    const entry = readEntryFile(path);
    return {
      name: entry.name,
      title: entry.title,
      kind: entry.kind,
      savedAt: entry.savedAt,
      elementCount: Object.keys(entry.spec.elements).length,
    };
  } catch {
    return null;
  }
}

// Copies the shipped starter templates into a fresh install's library, once.
// Never overwrites a file that already exists — a user's own save (or an
// edited starter) always wins, and deleting a starter doesn't resurrect it.
export function ensureLibrarySeeded(): void {
  if (existsSync(SEEDED_MARKER_PATH)) return;
  mkdirSync(LIBRARY_DIR, { recursive: true });
  for (const template of STARTER_TEMPLATES) {
    const target = libraryNameToPath(template.name);
    if (existsSync(target)) continue;
    const entry: LibraryEntry = {
      name: template.name,
      savedAt: Date.now(),
      title: template.title,
      kind: template.kind,
      spec: template.spec,
    };
    writeFileSync(target, JSON.stringify(entry, null, 2));
  }
  writeFileSync(SEEDED_MARKER_PATH, new Date().toISOString());
}
