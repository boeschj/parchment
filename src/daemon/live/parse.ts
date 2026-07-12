// Pure value mappers for live sources: tailed lines and polled output become
// state-ready values. Nothing here touches the filesystem or the network.

import { TailLineParser } from "./types.ts";

export type ParseOutcome = { ok: true; value: unknown } | { ok: false };

const SKIPPED: ParseOutcome = { ok: false };

export function parseTailLine(
  line: string,
  parser: TailLineParser,
  pattern: RegExp | null,
): ParseOutcome {
  switch (parser) {
    case TailLineParser.Jsonl:
      return parseJsonlLine(line);
    case TailLineParser.Regex:
      return pattern ? parseRegexLine(line, pattern) : SKIPPED;
    case TailLineParser.Number:
      return parseNumberLine(line);
  }
}

export function parseJsonlLine(line: string): ParseOutcome {
  const trimmed = line.trim();
  if (trimmed.length === 0) return SKIPPED;
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return SKIPPED;
  }
}

export function parseRegexLine(line: string, pattern: RegExp): ParseOutcome {
  const match = pattern.exec(line);
  if (!match || !match.groups) return SKIPPED;
  const record: Record<string, unknown> = {};
  for (const [group, captured] of Object.entries(match.groups)) {
    if (captured === undefined) continue;
    record[group] = coerceNumericString(captured);
  }
  if (Object.keys(record).length === 0) return SKIPPED;
  return { ok: true, value: record };
}

const FIRST_NUMBER_PATTERN = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;

export function parseNumberLine(line: string): ParseOutcome {
  const match = FIRST_NUMBER_PATTERN.exec(line);
  if (!match) return SKIPPED;
  return { ok: true, value: Number(match[0]) };
}

// Polled output (command stdout, HTTP body) has no line contract: try JSON,
// then a bare number, then fall back to the trimmed text itself.
export function parsePolledText(text: string): ParseOutcome {
  const trimmed = text.trim();
  if (trimmed.length === 0) return SKIPPED;
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    // Not JSON — fall through to number/string.
  }
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return { ok: true, value: numeric };
  return { ok: true, value: trimmed };
}

export const APPEND_TIMESTAMP_KEY = "t";
export const APPEND_VALUE_KEY = "value";

// Every appended point is an object with a `t` epoch-ms key so streaming
// charts always have a time axis: objects keep their own `t` when present,
// scalars become { t, value }.
export function toAppendRecord(value: unknown, timestampMs: number): Record<string, unknown> {
  if (isRecord(value)) {
    if (APPEND_TIMESTAMP_KEY in value) return value;
    return { [APPEND_TIMESTAMP_KEY]: timestampMs, ...value };
  }
  return { [APPEND_TIMESTAMP_KEY]: timestampMs, [APPEND_VALUE_KEY]: value };
}

const PLUCK_SEGMENT_PATTERN = /[^.[\]]+/g;

// JSONPath-ish pluck: dot keys and bracket indices, e.g. "data.items[0].cpu".
export function pluckValue(value: unknown, path: string): unknown {
  const segments = path.match(PLUCK_SEGMENT_PATTERN) ?? [];
  let current = value;
  for (const segment of segments) {
    current = memberOf(current, segment);
    if (current === undefined) return undefined;
  }
  return current;
}

function memberOf(container: unknown, key: string): unknown {
  if (Array.isArray(container)) {
    const index = Number(key);
    return Number.isInteger(index) ? container[index] : undefined;
  }
  if (isRecord(container)) return container[key];
  return undefined;
}

function coerceNumericString(captured: string): unknown {
  const numeric = Number(captured);
  const looksNumeric = captured.trim().length > 0 && Number.isFinite(numeric);
  return looksNumeric ? numeric : captured;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
