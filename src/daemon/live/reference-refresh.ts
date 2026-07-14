// reference-refresh source: watch the file behind a {watch:true} $file/$diff
// reference and re-hydrate it into the same slot-state path whenever it
// changes. This is the killer combo — a DiffViewer that keeps updating as the
// agent edits the file, with no further tool calls.
//
// Same watch+poll belt-and-braces as file-tail (fs.watch drops events on
// macOS; the poll guarantees progress). Unlike file-tail it does not track a
// cursor: every change re-resolves the whole reference and REPLACES the state
// path, because a diff's before/after cannot be reconstructed from appended
// lines.

import { existsSync, statSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import {
  resolveDiffPatchReference,
  resolveDiffSidesReference,
  resolveFileReference,
  resolveLogReference,
  type Resolved,
} from "../hydrate/resolve.ts";
import { buildHydratedMeta, HydrationMode } from "../hydrate/meta.ts";
import type { SlotStatePump } from "./pump.ts";
import { LogRefreshSelection } from "./types.ts";
import type {
  ReferenceRefreshSourceConfig,
  ReferenceRefreshTarget,
  SourceErrorReporter,
} from "./types.ts";

const REFRESH_POLL_INTERVAL_MS = 1000;

export function startReferenceRefresh(
  config: ReferenceRefreshSourceConfig,
  pump: SlotStatePump,
  reportError: SourceErrorReporter,
): () => void {
  let lastSignature = "";
  let stopped = false;
  let watcher: FSWatcher | null = tryWatch(config.watchPath, onFileEvent);
  const pollTimer = setInterval(onFileEvent, REFRESH_POLL_INTERVAL_MS);

  // Resolve once on start so a reference that changed while the daemon was down
  // (or was just registered) reflects current content immediately.
  void refresh();

  function onFileEvent(): void {
    if (watcher === null) watcher = tryWatch(config.watchPath, onFileEvent);
    const signature = fileSignature(config.watchPath);
    if (signature === lastSignature) return;
    lastSignature = signature;
    void refresh();
  }

  async function refresh(): Promise<void> {
    if (stopped) return;
    const resolved = await resolveTarget(config.target);
    if (stopped) return;
    if (!resolved.ok) {
      reportError(resolved.error);
      return;
    }
    pump.replace(config.statePath, resolved.value);
    pump.replace(config.metaStatePath, buildHydratedMeta(resolved.value, HydrationMode.Live));
    reportError(null);
  }

  return () => {
    stopped = true;
    clearInterval(pollTimer);
    watcher?.close();
  };
}

function resolveTarget(target: ReferenceRefreshTarget): Promise<Resolved<unknown>> {
  if (target.kind === "file") {
    return Promise.resolve(resolveFileReference(target.absPath, target.lines));
  }
  if (target.kind === "log") {
    return Promise.resolve(refreshLog(target));
  }
  if (target.kind === "diff-sides") {
    return resolveDiffSidesReference(target.cwd, target.absPath, target.displayPath, {
      base: target.base,
      staged: target.staged,
    });
  }
  return resolveDiffPatchReference(target.cwd, target.absPath, target.displayPath, {
    base: target.base,
    staged: target.staged,
  });
}

// The whole log is re-read and re-aggregated on every change — a bucket's count
// is a function of all the lines in it, so there is no cursor to advance and
// nothing to append. One source writes the rows; when the chart is split by a
// captured field, a second writes the series list the new rows are keyed by.
function refreshLog(
  target: Extract<ReferenceRefreshTarget, { kind: "log" }>,
): Resolved<unknown> {
  const aggregated = resolveLogReference(target.absPath, target.options);
  if (!aggregated.ok) return aggregated;
  if (target.select === LogRefreshSelection.SeriesKeys) {
    return { ok: true, value: aggregated.value.y };
  }
  return { ok: true, value: aggregated.value.rows };
}

function fileSignature(path: string): string {
  if (!existsSync(path)) return "absent";
  const stat = statSync(path);
  return `${stat.size}:${stat.mtimeMs}`;
}

function tryWatch(path: string, onChange: () => void): FSWatcher | null {
  if (!existsSync(path)) return null;
  try {
    return watch(path, onChange);
  } catch {
    return null;
  }
}
