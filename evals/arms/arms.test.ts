// The tests that keep the ARMS fair.
//
// The eval's credibility rests on a claim that is easy to make and easy to break:
// every arm was told the same thing, in the same words, and helped exactly as much.
// These tests hold that claim to account — the repair prompt is byte-identical
// across arms, every arm's task carries the same facts, and the only sentence that
// differs is the one describing what THAT arm can do, which is the independent
// variable itself.

import { describe, expect, test } from "bun:test";
import { ArmId, AuthoringSurface, Fidelity, type EvalScenario, type RepairSignal } from "../types.ts";
import {
  SCRAMBLED_VOCABULARY,
  STANDALONE_REFERENCE_COMPONENTS,
  SURFACE_COMPONENTS,
} from "../catalog/vocabulary.ts";
import { ARMS, RAW_HTML_OUTPUT_FILE, RAW_JSX_OUTPUT_FILE, RUNNABLE_ARM_IDS, armFor } from "./index.ts";

const ALL_ARM_IDS = Object.values(ArmId);

const SCENARIO: EvalScenario = {
  id: "diff-review",
  title: "Review the server change",
  request: "Show me what changed in the server, with a summary of the impact.",
  inlineData: null,
  sourceFiles: [
    {
      relativePath: "src/server.ts",
      absolutePath: "/tmp/fixture/src/server.ts",
      description: "the HTTP server, changed in the last commit",
    },
  ],
  exercisesLadder: true,
  acceptance: { scenarioId: "diff-review", title: "Review the server change", assertions: [] },
};

const SIGNAL: RepairSignal = {
  toolchainIssues: ['elements/chart-0: Chart requires "data", which is missing'],
  missingFromPage: ["a chart of errors per hour"],
};

// ---- The registry ------------------------------------------------------------

describe("the arm registry", () => {
  test.each([...ALL_ARM_IDS])("%s is registered under its own id", (id) => {
    expect(armFor(id).id).toBe(id);
  });

  test("openui-lang is registered but never runnable", () => {
    expect(ARMS[ArmId.OpenUiLang]).toBeDefined();
    expect(RUNNABLE_ARM_IDS).not.toContain(ArmId.OpenUiLang);
    expect(RUNNABLE_ARM_IDS).toHaveLength(ALL_ARM_IDS.length - 1);
  });
});

// ---- The unimplemented rival -------------------------------------------------

describe("openui-lang cannot be run by accident", () => {
  const arm = ARMS[ArmId.OpenUiLang];

  test("reading its system prompt throws", () => {
    expect(() => arm.systemPrompt).toThrow(/not implemented/);
  });

  test("encoding a task throws", () => {
    expect(() => arm.encodeTask(SCENARIO)).toThrow(/not implemented/);
  });

  test("building a repair prompt throws", () => {
    expect(() => arm.repairPrompt(SIGNAL)).toThrow(/not implemented/);
  });
});

// ---- Rungs and surfaces ------------------------------------------------------

const EXPECTED_FIDELITY = {
  [ArmId.ParchmentMarkupHigh]: Fidelity.High,
  [ArmId.ParchmentMarkupLow]: Fidelity.Low,
  [ArmId.ParchmentJsonHigh]: Fidelity.High,
  [ArmId.ParchmentJsonLow]: Fidelity.Low,
  [ArmId.ScrambledMarkupHigh]: Fidelity.High,
  [ArmId.ScrambledMarkupLow]: Fidelity.Low,
  [ArmId.TerseJson]: Fidelity.Low,
  [ArmId.OpenUiLang]: Fidelity.Low,
  [ArmId.RawHtml]: Fidelity.Low,
  [ArmId.RawJsx]: Fidelity.Low,
} as const satisfies Record<ArmId, Fidelity>;

const EXPECTED_SURFACE = {
  [ArmId.ParchmentMarkupHigh]: AuthoringSurface.CanvasTool,
  [ArmId.ParchmentMarkupLow]: AuthoringSurface.CanvasTool,
  [ArmId.ParchmentJsonHigh]: AuthoringSurface.CanvasTool,
  [ArmId.ParchmentJsonLow]: AuthoringSurface.CanvasTool,
  [ArmId.ScrambledMarkupHigh]: AuthoringSurface.CanvasTool,
  [ArmId.ScrambledMarkupLow]: AuthoringSurface.CanvasTool,
  [ArmId.TerseJson]: AuthoringSurface.CanvasTool,
  [ArmId.OpenUiLang]: AuthoringSurface.CanvasTool,
  [ArmId.RawHtml]: AuthoringSurface.WrittenFile,
  [ArmId.RawJsx]: AuthoringSurface.WrittenFile,
} as const satisfies Record<ArmId, AuthoringSurface>;

describe("every arm stands on the rung and the surface it claims", () => {
  test.each([...ALL_ARM_IDS])("%s", (id) => {
    expect(armFor(id).fidelity).toBe(EXPECTED_FIDELITY[id]);
    expect(armFor(id).surface).toBe(EXPECTED_SURFACE[id]);
  });
});

// ---- No arm is hand-held -----------------------------------------------------

describe("the repair signal is phrased identically for every arm", () => {
  test("all runnable arms produce a byte-identical repair prompt", () => {
    const prompts = RUNNABLE_ARM_IDS.map((id) => armFor(id).repairPrompt(SIGNAL));
    expect(new Set(prompts).size).toBe(1);
  });

  test("it folds both halves of the signal into one plain message", () => {
    const prompt = armFor(ArmId.RawHtml).repairPrompt(SIGNAL);
    expect(prompt).toContain(SIGNAL.toolchainIssues[0] ?? "");
    expect(prompt).toContain(SIGNAL.missingFromPage[0] ?? "");
  });

  test("an empty half is omitted rather than left as an empty heading", () => {
    const prompt = armFor(ArmId.RawHtml).repairPrompt({
      toolchainIssues: [],
      missingFromPage: ["a chart of errors per hour"],
    });
    expect(prompt).not.toContain("toolchain");
    expect(prompt).toContain("a chart of errors per hour");
  });
});

// ---- Same facts to every arm -------------------------------------------------

describe("every arm's task carries the same facts", () => {
  const tasks = RUNNABLE_ARM_IDS.map((id) => ({ id, task: armFor(id).encodeTask(SCENARIO) }));

  test.each([...tasks])("$id states the request, the title, and the source file", ({ task }) => {
    expect(task).toContain(SCENARIO.request);
    expect(task).toContain(SCENARIO.title);
    expect(task).toContain("src/server.ts");
    expect(task).toContain("the HTTP server, changed in the last commit");
  });

  test("inline data, when a scenario has it, reaches every arm verbatim", () => {
    const inlineData = "day,errors\nMon,12\nTue,31";
    const withData: EvalScenario = { ...SCENARIO, inlineData };
    for (const id of RUNNABLE_ARM_IDS) {
      expect(armFor(id).encodeTask(withData)).toContain(inlineData);
    }
  });

  // The tasks may differ ONLY in their closing instruction. Strip that and the two
  // arms on opposite sides of the experiment must be reading the same prompt.
  test("a high arm and a low arm are told the same thing up to the closing line", () => {
    const high = armFor(ArmId.ParchmentMarkupHigh).encodeTask(SCENARIO);
    const low = armFor(ArmId.ParchmentMarkupLow).encodeTask(SCENARIO);
    expect(withoutClosingParagraph(low)).toBe(withoutClosingParagraph(high));
  });

  test("a canvas arm and a written-file arm are told the same thing up to the closing line", () => {
    const canvas = armFor(ArmId.ParchmentMarkupLow).encodeTask(SCENARIO);
    const written = armFor(ArmId.RawHtml).encodeTask(SCENARIO);
    expect(withoutClosingParagraph(written)).toBe(withoutClosingParagraph(canvas));
  });
});

const PARAGRAPH_SEPARATOR = "\n\n";

function withoutClosingParagraph(task: string): string {
  const paragraphs = task.split(PARAGRAPH_SEPARATOR);
  return paragraphs.slice(0, -1).join(PARAGRAPH_SEPARATOR);
}

// ---- The rungs say what they can and cannot do ------------------------------

describe("each rung states its capability, without advising the model to use it", () => {
  test("the low rung says the page cannot point at a file", () => {
    const task = armFor(ArmId.ParchmentMarkupLow).encodeTask(SCENARIO);
    expect(task).toContain("Nothing on the page can point at a file");
  });

  test("the high rung says it can, and says so as a fact", () => {
    const task = armFor(ArmId.ParchmentMarkupHigh).encodeTask(SCENARIO);
    expect(task).toContain("The page can also point at a file");
    expect(task.toLowerCase()).not.toContain("prefer");
    expect(task.toLowerCase()).not.toContain("instead of pasting");
  });

  test("every arm is told it may read the files, in the same words", () => {
    for (const id of RUNNABLE_ARM_IDS) {
      expect(armFor(id).encodeTask(SCENARIO)).toContain("You can read the files above with Read.");
    }
  });
});

// ---- The vocabulary reaches the arms intact ---------------------------------

const REAL_NAMES = [...SURFACE_COMPONENTS, ...STANDALONE_REFERENCE_COMPONENTS] as const;
const OPAQUE_TOKEN_PATTERN = /\b(C\d{2}|t\d{2})\b/;
const SCRAMBLED_ARM_IDS = [ArmId.ScrambledMarkupHigh, ArmId.ScrambledMarkupLow] as const;
const REAL_CATALOG_ARM_IDS = [
  ArmId.ParchmentMarkupHigh,
  ArmId.ParchmentMarkupLow,
  ArmId.ParchmentJsonHigh,
  ArmId.ParchmentJsonLow,
  ArmId.TerseJson,
] as const;

describe("the scrambled arms are scrambled and the real arms are not", () => {
  test.each([...SCRAMBLED_ARM_IDS])("%s names no real component", (id) => {
    const prompt = armFor(id).systemPrompt;
    const leaked = REAL_NAMES.filter((name) => new RegExp(`\\b${name}\\b`).test(prompt));
    expect(leaked).toEqual([]);
  });

  test.each([...SCRAMBLED_ARM_IDS])("%s uses the opaque tokens", (id) => {
    const prompt = armFor(id).systemPrompt;
    expect(prompt).toContain(SCRAMBLED_VOCABULARY.componentName("Chart"));
    expect(OPAQUE_TOKEN_PATTERN.test(prompt)).toBe(true);
  });

  test.each([...REAL_CATALOG_ARM_IDS])("%s contains no opaque token", (id) => {
    expect(OPAQUE_TOKEN_PATTERN.test(armFor(id).systemPrompt)).toBe(false);
  });

  test.each([...REAL_CATALOG_ARM_IDS])("%s names the real components", (id) => {
    expect(armFor(id).systemPrompt).toContain("Chart");
    expect(armFor(id).systemPrompt).toContain("DataTable");
  });
});

// ---- The ladder is present exactly where it should be ------------------------

describe("only the high arms are shown the reference surface", () => {
  const HIGH_ARM_IDS = [ArmId.ParchmentMarkupHigh, ArmId.ParchmentJsonHigh] as const;
  const LOW_ARM_IDS = [
    ArmId.ParchmentMarkupLow,
    ArmId.ParchmentJsonLow,
    ArmId.TerseJson,
  ] as const;

  test.each([...HIGH_ARM_IDS])("%s is shown the reference components", (id) => {
    const prompt = armFor(id).systemPrompt;
    for (const component of STANDALONE_REFERENCE_COMPONENTS) {
      expect(prompt).toContain(component);
    }
  });

  test.each([...LOW_ARM_IDS])("%s is not, and is told content must be inline", (id) => {
    const prompt = armFor(id).systemPrompt;
    for (const component of STANDALONE_REFERENCE_COMPONENTS) {
      expect(prompt).not.toContain(component);
    }
    expect(prompt).toContain("there is no way to point a component at");
  });

  test.each([...LOW_ARM_IDS])("%s still requires both sides of a diff pasted", (id) => {
    const prompt = armFor(id).systemPrompt;
    expect(prompt).toContain("The ENTIRE original content of the file, verbatim.");
    expect(prompt).toContain("The ENTIRE modified content of the file, verbatim.");
  });
});

// ---- The written-file arms get a contract and nothing else -------------------

describe("the raw arms are given the format's real terms", () => {
  test("raw-html is told where to write and that it has no network", () => {
    const prompt = armFor(ArmId.RawHtml).systemPrompt;
    expect(prompt).toContain(RAW_HTML_OUTPUT_FILE);
    expect(prompt).toContain("no network access");
  });

  test("raw-jsx is told where to write and what is available", () => {
    const prompt = armFor(ArmId.RawJsx).systemPrompt;
    expect(prompt).toContain(RAW_JSX_OUTPUT_FILE);
    expect(prompt).toContain("React is available");
  });

  // Their protocol cost is near zero, and that is the competing format's genuine
  // advantage — not something the eval should quietly hand back by shipping them a
  // catalog they never asked for.
  test.each([ArmId.RawHtml, ArmId.RawJsx])("%s is given no component catalog", (id) => {
    const prompt = armFor(id).systemPrompt;
    const leaked = REAL_NAMES.filter((name) => new RegExp(`\\b${name}\\b`).test(prompt));
    expect(leaked).toEqual([]);
  });
});
