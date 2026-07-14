import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { prepareSpec } from "./spec-validation.ts";
import type { JsonRenderSpec } from "../shared/types.ts";

// The skills are the model's ONLY view of the spec dialect. When they drift from
// the validator, every example the model copies is a rejection — and worse, an
// example the validator wrongly accepts is how a broken dialect gets taught.
// So: every ```json block in skills/**/*.md must parse, and every spec inside
// one must validate with zero issues. The docs cannot drift again.

const SKILLS_DIR = new URL("../../skills", import.meta.url).pathname;

// Fences show tool calls as `canvas_render: {...}`, sometimes several per fence
// (render, then live). Split on the label, then parse each payload on its own.
const TOOL_CALL_LABEL = /^(?=\w+:\s*\{)/m;
const LABEL_PREFIX = /^\w+:\s*/;
const JSON_FENCE = /```json\n([\s\S]*?)```/g;

type Example = { source: string; payload: unknown };

function markdownFilesIn(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...markdownFilesIn(path));
    else if (entry.name.endsWith(".md")) files.push(path);
  }
  return files.sort();
}

function jsonExamplesIn(file: string): Example[] {
  const text = readFileSync(file, "utf8");
  const relativePath = file.slice(SKILLS_DIR.length + 1);
  const examples: Example[] = [];
  let fenceIndex = 0;
  for (const fence of text.matchAll(JSON_FENCE)) {
    fenceIndex += 1;
    const body = fence[1] ?? "";
    const payloads = body.split(TOOL_CALL_LABEL).filter((segment) => segment.trim().length > 0);
    payloads.forEach((payload, payloadIndex) => {
      const source = `${relativePath} json block ${fenceIndex}.${payloadIndex + 1}`;
      examples.push({ source, payload: parseExample(source, payload) });
    });
  }
  return examples;
}

function parseExample(source: string, payload: string): unknown {
  const json = payload.replace(LABEL_PREFIX, "").trim();
  try {
    return JSON.parse(json);
  } catch (error) {
    throw new Error(`${source} is not valid JSON: ${String(error)}\n${json}`);
  }
}

// A spec is either the payload itself (a bare spec block) or the `spec` field of
// a canvas_render/canvas_app tool call.
function specOf(payload: unknown): JsonRenderSpec | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record: Record<string, unknown> = { ...payload };
  const candidate = isSpecShaped(record) ? record : record.spec;
  if (typeof candidate !== "object" || candidate === null) return null;
  const spec: Record<string, unknown> = { ...candidate };
  if (!isSpecShaped(spec)) return null;
  return spec as unknown as JsonRenderSpec;
}

function isSpecShaped(value: Record<string, unknown>): boolean {
  return typeof value.root === "string" && typeof value.elements === "object";
}

const examples = markdownFilesIn(SKILLS_DIR).flatMap(jsonExamplesIn);
const specExamples = examples.filter((example) => specOf(example.payload) !== null);

describe("skills examples — the docs are validated by the validator they document", () => {
  it("finds the JSON examples (a silent zero here would make every test below vacuous)", () => {
    expect(examples.length).toBeGreaterThanOrEqual(10);
    expect(specExamples.length).toBeGreaterThanOrEqual(4);
  });

  for (const example of specExamples) {
    it(`${example.source} validates clean`, () => {
      const spec = specOf(example.payload);
      if (!spec) throw new Error(`${example.source}: expected a spec`);
      const { issues } = prepareSpec(spec);
      expect(issues).toEqual([]);
    });
  }
});
