import { describe, it, expect, mock } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SlotKind } from "../shared/types.ts";
import type { JsonRenderSpec, LibraryEntry } from "../shared/types.ts";

// library.ts imports state.ts, which computes STATE_DIR = join(homedir(),
// ".parchment") once at module-load time. Redirecting homedir() must happen
// via mock.module before that chain is ever imported — see slots.test.ts for
// the same constraint.
const fakeHome = mkdtempSync(join(tmpdir(), "parchment-library-test-"));
const realOs = await import("node:os");
mock.module("node:os", () => ({ ...realOs, homedir: () => fakeHome }));

const {
  LIBRARY_DIR,
  libraryNameToPath,
  writeLibraryEntry,
  readLibraryEntry,
  deleteLibraryEntry,
  listLibraryEntryNames,
  listLibraryEntries,
  ensureLibrarySeeded,
} = await import("./library.ts");

function baseSpec(): JsonRenderSpec {
  return { root: "root", elements: { root: { type: "Heading", props: { text: "Hi", level: "h1" } } } };
}

function baseEntry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    name: "test-entry",
    savedAt: Date.now(),
    title: "Test entry",
    kind: SlotKind.Render,
    spec: baseSpec(),
    ...overrides,
  };
}

describe("libraryNameToPath", () => {
  it("slugifies a human-readable name into a filesystem-safe filename", () => {
    const path = libraryNameToPath("Perf Dashboard!!");
    expect(path).toBe(join(LIBRARY_DIR, "perf-dashboard.json"));
  });

  it("throws when the name slugifies to nothing", () => {
    expect(() => libraryNameToPath("!!!")).toThrow(/invalid library name/);
  });
});

describe("writeLibraryEntry / readLibraryEntry", () => {
  it("round-trips an entry written to disk", () => {
    const entry = baseEntry({ name: `round-trip-${Date.now()}` });

    writeLibraryEntry(entry);
    const loaded = readLibraryEntry(entry.name);

    expect(loaded).toEqual(entry);
  });

  it("returns null for a name with no saved entry", () => {
    expect(readLibraryEntry(`does-not-exist-${Date.now()}`)).toBeNull();
  });
});

describe("deleteLibraryEntry", () => {
  it("deletes an existing entry and reports success, then false on a second delete", () => {
    const entry = baseEntry({ name: `delete-me-${Date.now()}` });
    writeLibraryEntry(entry);

    expect(deleteLibraryEntry(entry.name)).toBe(true);
    expect(readLibraryEntry(entry.name)).toBeNull();
    expect(deleteLibraryEntry(entry.name)).toBe(false);
  });
});

describe("listLibraryEntryNames / listLibraryEntries", () => {
  it("lists saved entries sorted by savedAt, newest first", () => {
    const older = baseEntry({ name: `older-${Date.now()}`, savedAt: 1000, title: "Older" });
    const newer = baseEntry({ name: `newer-${Date.now()}`, savedAt: 2000, title: "Newer" });
    writeLibraryEntry(older);
    writeLibraryEntry(newer);

    expect(listLibraryEntryNames()).toContain(older.name);
    expect(listLibraryEntryNames()).toContain(newer.name);

    const listing = listLibraryEntries();
    const newerIndex = listing.findIndex((item) => item.name === newer.name);
    const olderIndex = listing.findIndex((item) => item.name === older.name);
    expect(newerIndex).toBeGreaterThanOrEqual(0);
    expect(olderIndex).toBeGreaterThan(newerIndex);
  });

  it("reports elementCount from the spec's element map", () => {
    const entry = baseEntry({ name: `count-${Date.now()}` });
    writeLibraryEntry(entry);

    const listing = listLibraryEntries().find((item) => item.name === entry.name);
    expect(listing?.elementCount).toBe(Object.keys(entry.spec.elements).length);
  });

  it("skips a corrupt entry file instead of throwing", () => {
    const corruptName = `corrupt-${Date.now()}`;
    writeFileSync(libraryNameToPath(corruptName), "{ not valid json");

    expect(() => listLibraryEntries()).not.toThrow();
    expect(listLibraryEntries().some((item) => item.name === corruptName)).toBe(false);
  });
});

describe("ensureLibrarySeeded", () => {
  it("seeds every starter template on first run and writes the marker", () => {
    ensureLibrarySeeded();

    const names = listLibraryEntryNames();
    expect(names).toContain("project-status-dashboard");
    expect(names).toContain("pr-review");
    expect(names).toContain("incident-timeline");
    expect(names).toContain("cost-report");
    expect(names).toContain("agent-fleet-snapshot");
  });

  it("does not overwrite a starter the user has already edited", () => {
    ensureLibrarySeeded();
    const path = libraryNameToPath("cost-report");
    const edited = { ...readLibraryEntry("cost-report")!, title: "My edited cost report" };
    writeFileSync(path, JSON.stringify(edited));

    ensureLibrarySeeded();

    expect(JSON.parse(readFileSync(path, "utf8")).title).toBe("My edited cost report");
  });

  it("is a no-op on a second call (idempotent via the .seeded marker)", () => {
    ensureLibrarySeeded();
    deleteLibraryEntry("pr-review");

    ensureLibrarySeeded();

    expect(listLibraryEntryNames()).not.toContain("pr-review");
  });
});
