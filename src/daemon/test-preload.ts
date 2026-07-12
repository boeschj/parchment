// Loaded by bunfig.toml's [test].preload before any test module evaluates.
// state.ts computes STATE_DIR from PARCHMENT_STATE_DIR at module-load time, so
// setting it here — ahead of the whole module graph — redirects every daemon
// test's on-disk reads and writes to a throwaway temp dir. This replaces the
// per-file `mock.module("node:os")` hack, which only worked when its file
// happened to load before any other daemon test reached state.ts (e.g.
// apps/config.test.ts imports state.ts unmocked) and otherwise leaked test
// fixtures into the user's real ~/.parchment.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.PARCHMENT_STATE_DIR) {
  process.env.PARCHMENT_STATE_DIR = mkdtempSync(join(tmpdir(), "parchment-test-state-"));
}
