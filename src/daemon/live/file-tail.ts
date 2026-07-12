// file-tail source: follow a file and turn each new line into a state write.
// Same watch+poll belt-and-braces as transcript.ts — fs.watch drops events
// on macOS, the poll guarantees progress; a file that doesn't exist yet is
// picked up the moment it appears.

import { existsSync, statSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { applySourceValue } from "./apply.ts";
import { parseTailLine } from "./parse.ts";
import type { SlotStatePump } from "./pump.ts";
import { consumeAppendedLines, FRESH_TAIL_CURSOR, type TailCursor } from "./tail-reader.ts";
import { TailLineParser, type FileTailSourceConfig } from "./types.ts";

const TAIL_POLL_INTERVAL_MS = 1000;
const MAX_TAIL_READ_BYTES = 1024 * 1024;

export function startFileTail(config: FileTailSourceConfig, pump: SlotStatePump): () => void {
  const pattern = compilePattern(config);
  let cursor: TailCursor = existsSync(config.path)
    ? { offset: statSync(config.path).size, remainder: "" }
    : FRESH_TAIL_CURSOR;
  let watcher: FSWatcher | null = tryWatch(config.path, pumpNewLines);
  const pollTimer = setInterval(pumpNewLines, TAIL_POLL_INTERVAL_MS);

  function pumpNewLines(): void {
    if (watcher === null) {
      watcher = tryWatch(config.path, pumpNewLines);
    }
    cursor = consumeAppendedLines({
      path: config.path,
      cursor,
      maxBytes: MAX_TAIL_READ_BYTES,
      onLine: applyLine,
    });
  }

  function applyLine(line: string): void {
    const outcome = parseTailLine(line, config.parser, pattern);
    if (!outcome.ok) return;
    applySourceValue(pump, config, outcome.value);
  }

  return () => {
    clearInterval(pollTimer);
    watcher?.close();
  };
}

function compilePattern(config: FileTailSourceConfig): RegExp | null {
  if (config.parser !== TailLineParser.Regex || config.pattern === null) return null;
  return new RegExp(config.pattern);
}

function tryWatch(path: string, onChange: () => void): FSWatcher | null {
  if (!existsSync(path)) return null;
  try {
    return watch(path, onChange);
  } catch {
    return null;
  }
}
