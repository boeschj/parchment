// Incremental line reader shared by file-tail sources and the fleet scanner.
// Reads only bytes appended since the caller's offset, in bounded chunks, so
// a 100MB session file never materializes as one string.

import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

const READ_CHUNK_BYTES = 4 * 1024 * 1024;

export type TailCursor = {
  offset: number;
  remainder: string;
};

export const FRESH_TAIL_CURSOR: TailCursor = { offset: 0, remainder: "" };

export type ConsumeAppendedLinesInput = {
  path: string;
  cursor: TailCursor;
  // When set and the file grew by more than this, skip ahead so only the
  // newest maxBytes are read — a dashboard tail cares about recent lines,
  // not a backlog dump.
  maxBytes?: number;
  onLine: (line: string) => void;
};

export function consumeAppendedLines(input: ConsumeAppendedLinesInput): TailCursor {
  if (!existsSync(input.path)) return input.cursor;

  const size = statSync(input.path).size;
  const truncated = size < input.cursor.offset;
  let cursor: TailCursor = truncated ? FRESH_TAIL_CURSOR : input.cursor;

  const growth = size - cursor.offset;
  if (growth <= 0) return cursor;

  const skipAhead = input.maxBytes !== undefined && growth > input.maxBytes;
  if (skipAhead && input.maxBytes !== undefined) {
    // The first line after a skip is almost certainly partial; dropping the
    // pre-skip remainder makes the line splitter discard it naturally.
    cursor = { offset: size - input.maxBytes, remainder: "" };
  }

  const descriptor = openSync(input.path, "r");
  try {
    let dropPartialFirstLine = skipAhead;
    let offset = cursor.offset;
    let remainder = cursor.remainder;
    while (offset < size) {
      const bytesToRead = Math.min(READ_CHUNK_BYTES, size - offset);
      const buffer = Buffer.alloc(bytesToRead);
      const bytesRead = readSync(descriptor, buffer, 0, bytesToRead, offset);
      if (bytesRead <= 0) break;
      offset += bytesRead;

      const text = remainder + buffer.toString("utf8", 0, bytesRead);
      const lines = text.split("\n");
      remainder = lines.pop() ?? "";
      for (const line of lines) {
        if (dropPartialFirstLine) {
          dropPartialFirstLine = false;
          continue;
        }
        if (line.trim().length === 0) continue;
        input.onLine(line);
      }
    }
    return { offset, remainder };
  } finally {
    closeSync(descriptor);
  }
}
