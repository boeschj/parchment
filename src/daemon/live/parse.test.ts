import { describe, it, expect } from "bun:test";
import {
  parseJsonlLine,
  parseNumberLine,
  parsePolledText,
  parseRegexLine,
  parseTailLine,
  pluckValue,
  toAppendRecord,
} from "./parse.ts";
import { appendWithWindow } from "./pump.ts";
import { TailLineParser } from "./types.ts";

describe("parseJsonlLine", () => {
  it("parses a JSON object line", () => {
    expect(parseJsonlLine('{"t": 5, "value": 42}')).toEqual({
      ok: true,
      value: { t: 5, value: 42 },
    });
  });

  it("skips malformed JSON and blank lines", () => {
    expect(parseJsonlLine("not json").ok).toBe(false);
    expect(parseJsonlLine("   ").ok).toBe(false);
  });
});

describe("parseRegexLine", () => {
  it("extracts named groups and coerces numeric captures", () => {
    const pattern = /lat=(?<ms>\d+) route=(?<route>\S+)/;
    expect(parseRegexLine("GET lat=123 route=/api/users", pattern)).toEqual({
      ok: true,
      value: { ms: 123, route: "/api/users" },
    });
  });

  it("skips non-matching lines", () => {
    expect(parseRegexLine("no latency here", /lat=(?<ms>\d+)/).ok).toBe(false);
  });

  it("skips lines when the pattern has no named groups", () => {
    expect(parseRegexLine("lat=123", /lat=\d+/).ok).toBe(false);
  });
});

describe("parseNumberLine", () => {
  it("extracts the first number on the line", () => {
    expect(parseNumberLine("latency: 42.5ms (attempt 3)")).toEqual({ ok: true, value: 42.5 });
  });

  it("handles negatives and exponents", () => {
    expect(parseNumberLine("delta -1.5e2 units")).toEqual({ ok: true, value: -150 });
  });

  it("skips numberless lines", () => {
    expect(parseNumberLine("no digits").ok).toBe(false);
  });
});

describe("parseTailLine", () => {
  it("routes to the configured parser", () => {
    expect(parseTailLine("7", TailLineParser.Number, null)).toEqual({ ok: true, value: 7 });
    expect(parseTailLine('{"a":1}', TailLineParser.Jsonl, null)).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it("skips regex lines when no compiled pattern is supplied", () => {
    expect(parseTailLine("lat=1", TailLineParser.Regex, null).ok).toBe(false);
  });
});

describe("parsePolledText", () => {
  it("prefers JSON, then number, then trimmed string", () => {
    expect(parsePolledText('{"cpu": 0.4}')).toEqual({ ok: true, value: { cpu: 0.4 } });
    expect(parsePolledText(" 17\n")).toEqual({ ok: true, value: 17 });
    expect(parsePolledText("all systems go\n")).toEqual({ ok: true, value: "all systems go" });
  });

  it("skips empty output", () => {
    expect(parsePolledText("   \n").ok).toBe(false);
  });
});

describe("toAppendRecord", () => {
  it("wraps scalars as { t, value }", () => {
    expect(toAppendRecord(42, 1000)).toEqual({ t: 1000, value: 42 });
  });

  it("stamps objects with t when they lack one", () => {
    expect(toAppendRecord({ cpu: 0.5 }, 1000)).toEqual({ t: 1000, cpu: 0.5 });
  });

  it("keeps an object's own t", () => {
    expect(toAppendRecord({ t: 7, cpu: 0.5 }, 1000)).toEqual({ t: 7, cpu: 0.5 });
  });

  it("wraps arrays as values rather than spreading them", () => {
    expect(toAppendRecord([1, 2], 1000)).toEqual({ t: 1000, value: [1, 2] });
  });
});

describe("pluckValue", () => {
  const payload = { data: { stats: [{ cpu: 0.25 }, { cpu: 0.75 }], name: "box" } };

  it("plucks nested dot paths and bracket indices", () => {
    expect(pluckValue(payload, "data.stats[1].cpu")).toBe(0.75);
    expect(pluckValue(payload, "data.name")).toBe("box");
  });

  it("returns undefined for missing paths", () => {
    expect(pluckValue(payload, "data.missing.deep")).toBeUndefined();
    expect(pluckValue(42, "anything")).toBeUndefined();
  });
});

describe("appendWithWindow", () => {
  it("appends onto an existing array", () => {
    expect(appendWithWindow([1, 2], [{ t: 3 }], 10)).toEqual([1, 2, { t: 3 }]);
  });

  it("starts a fresh array when the path held a non-array", () => {
    expect(appendWithWindow("junk", [{ t: 1 }], 10)).toEqual([{ t: 1 }]);
  });

  it("keeps only the newest `window` points", () => {
    const records = [{ t: 3 }, { t: 4 }, { t: 5 }];
    expect(appendWithWindow([{ t: 1 }, { t: 2 }], records, 3)).toEqual([
      { t: 3 },
      { t: 4 },
      { t: 5 },
    ]);
  });
});
