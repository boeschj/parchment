// The tests that keep the ABLATION honest.
//
// This file owns exactly one question: given the derived catalog, is the text we
// hand the model fair? Whether that catalog matches the shipped product is a
// different question, and vocabulary.test.ts owns it — so nothing here re-checks
// prop names or required-ness, and nothing there reads a rendered prompt.
//
// Two failure modes are guarded against, and each would silently produce a
// publishable-looking number that was worthless:
//   1. Strawmanning the SCRAMBLED arm — degrading its semantics as well as its
//      identifiers, so it loses for a reason other than the one under test.
//   2. Leaking familiarity — a real component name surviving into the scrambled
//      prompt, or an opaque token into the real one.
//
// Plus the one that would make the whole surface a fiction: the dialect the
// prompt DESCRIBES must be the dialect the shipped compiler IMPLEMENTS, so every
// example the model is shown is fed to the real compiler and must come back clean.

import { describe, expect, test } from "bun:test";
import { Fidelity } from "../types.ts";
import { compileMarkup } from "../../src/daemon/markup/index.ts";
import {
  Notation,
  componentsFor,
  inlineMarkupExampleFor,
  renderSurfaceReference,
} from "./surface.ts";
import {
  DOCUMENTED_COMPONENTS,
  REAL_VOCABULARY,
  SCRAMBLED_VOCABULARY,
  STANDALONE_REFERENCE_COMPONENTS,
  STRUCTURAL_TAGS,
  SURFACE_COMPONENTS,
  type DocumentedComponentName,
  type Vocabulary,
} from "./vocabulary.ts";

const ALL_NOTATIONS = [Notation.Markup, Notation.Json, Notation.TerseJson] as const;
const ALL_FIDELITIES = [Fidelity.Low, Fidelity.High] as const;

// ---- Reading a rendered prompt ----------------------------------------------
//
// Everything below is measured on the reference region — from the components
// heading onward — because that is the only part that carries identifiers. The
// grammar preamble is prose we hold fixed, and an example's pasted content can be
// arbitrary multi-line text, so neither is safe to pattern-match against.

const COMPONENTS_HEADING = "# Components";
const EXAMPLE_PREFIX_PATTERN = /^ {2}e\.g\. /;
const PROP_LINE_PATTERN = /^ {2}(?!e\.g\. )[^\s:]+.*?: /;
const HEADLINE_SEPARATOR = " — ";

function referenceRegion(prompt: string): readonly string[] {
  const lines = prompt.split("\n");
  const start = lines.indexOf(COMPONENTS_HEADING);
  if (start === -1) return [];
  return lines.slice(start + 1);
}

function propLinesOf(prompt: string): readonly string[] {
  return referenceRegion(prompt).filter(
    (line) => PROP_LINE_PATTERN.test(line) && !EXAMPLE_PREFIX_PATTERN.test(line),
  );
}

function headlinesOf(
  prompt: string,
  vocabulary: Vocabulary,
  components: readonly DocumentedComponentName[],
): readonly string[] {
  const names = components.map((component) => vocabulary.componentName(component));
  return referenceRegion(prompt).filter((line) =>
    names.some((name) => line.startsWith(`${name}${HEADLINE_SEPARATOR}`)),
  );
}

type PromptCase = { readonly notation: Notation; readonly fidelity: Fidelity };

function documentedIn(promptCase: PromptCase): readonly DocumentedComponentName[] {
  return componentsFor({ ...promptCase, vocabulary: REAL_VOCABULARY });
}

type PromptPair = { readonly real: string; readonly scrambled: string };

function promptPair(notation: Notation, fidelity: Fidelity): PromptPair {
  return {
    real: renderSurfaceReference({ vocabulary: REAL_VOCABULARY, fidelity, notation }),
    scrambled: renderSurfaceReference({ vocabulary: SCRAMBLED_VOCABULARY, fidelity, notation }),
  };
}

const PROMPT_CASES: readonly PromptCase[] = ALL_NOTATIONS.flatMap((notation) =>
  ALL_FIDELITIES.map((fidelity) => ({ notation, fidelity })),
);

// ---- 1. The two prompts differ ONLY in their identifiers ---------------------

describe("the real and scrambled prompts are structurally identical", () => {
  test.each([...PROMPT_CASES])("$notation/$fidelity: same line count", ({ notation, fidelity }) => {
    const { real, scrambled } = promptPair(notation, fidelity);
    expect(scrambled.split("\n").length).toBe(real.split("\n").length);
  });

  test.each([...PROMPT_CASES])(
    "$notation/$fidelity: both document every component, and the same ones",
    (promptCase) => {
      const { notation, fidelity } = promptCase;
      const { real, scrambled } = promptPair(notation, fidelity);
      const documented = documentedIn(promptCase);

      expect(headlinesOf(real, REAL_VOCABULARY, documented)).toHaveLength(documented.length);
      expect(headlinesOf(scrambled, SCRAMBLED_VOCABULARY, documented)).toHaveLength(
        documented.length,
      );
    },
  );

  test.each([...PROMPT_CASES])(
    "$notation/$fidelity: both document the same number of props",
    ({ notation, fidelity }) => {
      const { real, scrambled } = promptPair(notation, fidelity);
      expect(propLinesOf(scrambled)).toHaveLength(propLinesOf(real).length);
      expect(propLinesOf(real).length).toBeGreaterThan(0);
    },
  );
});

// ---- 2. No familiarity leaks in either direction -----------------------------

const REAL_NAMES = [...SURFACE_COMPONENTS, ...STANDALONE_REFERENCE_COMPONENTS] as const;
const OPAQUE_TOKEN_PATTERN = /\b(C\d{2}|t\d{2})\b/;

describe("no vocabulary leaks between the arms", () => {
  test.each([...PROMPT_CASES])(
    "$notation/$fidelity: the scrambled prompt names no real component",
    ({ notation, fidelity }) => {
      const { scrambled } = promptPair(notation, fidelity);
      const leaked = REAL_NAMES.filter((name) => new RegExp(`\\b${name}\\b`).test(scrambled));
      expect(leaked).toEqual([]);
    },
  );

  test.each([...PROMPT_CASES])(
    "$notation/$fidelity: the real prompt contains no opaque token",
    ({ notation, fidelity }) => {
      const { real } = promptPair(notation, fidelity);
      expect(OPAQUE_TOKEN_PATTERN.test(real)).toBe(false);
    },
  );

  // The point of the whole exercise. Strip the identifiers from both prompts and
  // what remains — every word we actually wrote, and every value the schema
  // supplied — must be byte-identical. A scrambled arm that also got worse
  // SEMANTICS would be a strawman, and its loss would prove nothing.
  test.each([...PROMPT_CASES])(
    "$notation/$fidelity: the semantic text is word-for-word identical",
    (promptCase) => {
      const { notation, fidelity } = promptCase;
      const { real, scrambled } = promptPair(notation, fidelity);
      const documented = documentedIn(promptCase);

      const realMeanings = meaningsOf(real, REAL_VOCABULARY, documented);
      const scrambledMeanings = meaningsOf(scrambled, SCRAMBLED_VOCABULARY, documented);

      expect(scrambledMeanings).toEqual(realMeanings);
      expect(realMeanings.length).toBeGreaterThan(0);
    },
  );
});

function meaningsOf(
  prompt: string,
  vocabulary: Vocabulary,
  components: readonly DocumentedComponentName[],
): readonly string[] {
  const purposes = headlinesOf(prompt, vocabulary, components).map((line) =>
    line.slice(line.indexOf(HEADLINE_SEPARATOR) + HEADLINE_SEPARATOR.length),
  );
  const meanings = propLinesOf(prompt).map((line) => line.slice(line.indexOf(": ") + ": ".length));
  return [...purposes, ...meanings];
}

// ---- 3. The dialect the prompt describes is the dialect that compiles ---------
//
// Fed to the SHIPPED compiler, not a copy of it. An example the prompt shows that
// the real compiler rejects is a trap we set for our own arm.

describe("the markup reference describes the dialect the compiler implements", () => {
  test.each([...SURFACE_COMPONENTS])("the %s example compiles with zero issues", (component) => {
    const example = inlineMarkupExampleFor(component, REAL_VOCABULARY);
    const { issues } = compileMarkup(example);
    expect(issues).toEqual([]);
  });

  test.each([...SURFACE_COMPONENTS])("the %s example is the one the prompt shows", (component) => {
    const prompt = renderSurfaceReference({
      vocabulary: REAL_VOCABULARY,
      fidelity: Fidelity.Low,
      notation: Notation.Markup,
    });
    expect(prompt).toContain(inlineMarkupExampleFor(component, REAL_VOCABULARY));
  });

  test("the structural shortcuts compile to real components", () => {
    const { issues, spec } = compileMarkup(
      "<section><h1>Title</h1><h2>Sub</h2><h3>Sub</h3><p>Prose.</p><form></form></section>",
    );
    expect(issues).toEqual([]);
    const types = Object.values(spec.elements).map((element) => element.type);
    expect(types).toContain("Stack");
    expect(types).toContain("Heading");
    expect(types).toContain("Card");
  });
});

// ---- 4. Each arm is shown the door it actually has ----------------------------
//
// The reference tags are MARKUP sugar. A spec arm that authored <GitDiff> would be
// rejected by the validator — so a spec prompt must never name one, and must show
// the expression grammar instead. Getting this wrong manufactures a loss for one
// of our own arms, which is the same sin as manufacturing a win.

describe("the ladder is documented in the notation the arm can author", () => {
  test("a high-fidelity MARKUP prompt names the reference tags", () => {
    const prompt = renderSurfaceReference({
      vocabulary: REAL_VOCABULARY,
      fidelity: Fidelity.High,
      notation: Notation.Markup,
    });
    expect(prompt).toContain("GitDiff");
    expect(prompt).toContain("LogStream");
  });

  test.each([Notation.Json, Notation.TerseJson])(
    "a high-fidelity %s prompt names no markup-only tag, and shows the expressions instead",
    (notation) => {
      const prompt = renderSurfaceReference({
        vocabulary: REAL_VOCABULARY,
        fidelity: Fidelity.High,
        notation,
      });

      for (const tag of STANDALONE_REFERENCE_COMPONENTS) {
        expect(prompt).not.toContain(`${tag} —`);
      }
      expect(prompt).toContain("$diff");
      expect(prompt).toContain("$csv");
      expect(prompt).toContain("$log");
    },
  );

  test("a low-fidelity prompt offers no reference at all — that is the control", () => {
    const prompt = renderSurfaceReference({
      vocabulary: REAL_VOCABULARY,
      fidelity: Fidelity.Low,
      notation: Notation.Markup,
    });
    expect(prompt).not.toContain("GitDiff");
    expect(prompt).not.toContain("$diff");
    expect(prompt).toContain("paste");
  });

  test("the low-fidelity surface is the catalog without the ladder", () => {
    const low = documentedIn({ notation: Notation.Markup, fidelity: Fidelity.Low });
    expect(low).toEqual(SURFACE_COMPONENTS);
    expect(DOCUMENTED_COMPONENTS.length).toBeGreaterThan(low.length);
  });

  test("the structural shortcuts are documented, and only in markup", () => {
    const markup = renderSurfaceReference({
      vocabulary: REAL_VOCABULARY,
      fidelity: Fidelity.Low,
      notation: Notation.Markup,
    });
    const json = renderSurfaceReference({
      vocabulary: REAL_VOCABULARY,
      fidelity: Fidelity.Low,
      notation: Notation.Json,
    });

    expect(markup).toContain("# Shortcuts");
    expect(json).not.toContain("# Shortcuts");
    expect(STRUCTURAL_TAGS.every((tag) => markup.includes(`<${tag}>`))).toBe(true);
  });
});
