// The tests that keep the ablation honest.
//
// Three failure modes are guarded against here, and each would silently produce a
// publishable-looking number that was worthless:
//   1. Strawmanning our OWN format — documenting props the real compiler rejects,
//      so the parchment arms lose on a technicality we invented.
//   2. Strawmanning the SCRAMBLED arm — degrading its semantics as well as its
//      identifiers, so it loses for a reason other than the one under test.
//   3. Leaking familiarity — a real component name surviving into the scrambled
//      prompt, or an opaque token into the real one.

import { describe, expect, test } from "bun:test";
import { Fidelity } from "../types.ts";
import { compileMarkup } from "../vendor/markup/compiler.ts";
import {
  acceptsChildren,
  knownPropNamesFor,
  resolveComponentName,
} from "../vendor/markup/component-catalog.ts";
import { Notation, inlineMarkupExampleFor, renderSurfaceReference } from "./surface.ts";
import {
  COMPONENT_SURFACE,
  DOCUMENTED_COMPONENTS,
  LAYERED_REFERENCE_COMPONENTS,
  REAL_VOCABULARY,
  REFERENCE_ONLY_NAMES,
  REFERENCE_SURFACE,
  SCRAMBLED_VOCABULARY,
  STANDALONE_REFERENCE_COMPONENTS,
  STRUCTURAL_TAGS,
  SURFACE_COMPONENTS,
  documentedPropNamesOf,
  layeredReferenceFor,
  type DocumentedComponentName,
  type Vocabulary,
} from "./vocabulary.ts";

const ALL_NOTATIONS = [Notation.Markup, Notation.Json, Notation.TerseJson] as const;
const ALL_FIDELITIES = [Fidelity.Low, Fidelity.High] as const;

// ---- 1. Anti-strawman: the real catalog is the authority ---------------------

describe("COMPONENT_SURFACE matches the real catalog", () => {
  test.each([...SURFACE_COMPONENTS])("%s exists in the catalog", (component) => {
    expect(resolveComponentName(component)).toBe(component);
  });

  test.each([...SURFACE_COMPONENTS])("every %s prop is a real catalog prop", (component) => {
    const realProps = knownPropNamesFor(component);
    const documented = Object.keys(COMPONENT_SURFACE[component].props);
    const invented = documented.filter((prop) => !realProps.includes(prop));
    expect(invented).toEqual([]);
  });

  test.each([...SURFACE_COMPONENTS])("%s children match the catalog", (component) => {
    expect(COMPONENT_SURFACE[component].acceptsChildren).toBe(acceptsChildren(component));
  });
});

// ---- 2. The ladder's exemption is explicit and necessary ---------------------

describe("the reference surface is exempt from the catalog, auditably", () => {
  test("REFERENCE_ONLY_NAMES lists exactly the names the catalog does not have", () => {
    const standalone = [...STANDALONE_REFERENCE_COMPONENTS];
    const layered = LAYERED_REFERENCE_COMPONENTS.flatMap((component) =>
      Object.keys(REFERENCE_SURFACE[component].props).map((prop) => `${component}.${prop}`),
    );
    expect([...standalone, ...layered].sort()).toEqual([...REFERENCE_ONLY_NAMES].sort());
  });

  test.each([...STANDALONE_REFERENCE_COMPONENTS])(
    "%s is genuinely absent from the catalog, so the exemption is needed",
    (component) => {
      expect(resolveComponentName(component)).toBeNull();
    },
  );

  test.each([...LAYERED_REFERENCE_COMPONENTS])(
    "%s's reference props are genuinely absent from the catalog",
    (component) => {
      const realProps = knownPropNamesFor(component);
      const referenceProps = Object.keys(REFERENCE_SURFACE[component].props);
      const alreadyReal = referenceProps.filter((prop) => realProps.includes(prop));
      expect(alreadyReal).toEqual([]);
    },
  );

  // The hydrator fills these on the compiled element, so they had better exist.
  test.each([...STANDALONE_REFERENCE_COMPONENTS, ...LAYERED_REFERENCE_COMPONENTS])(
    "%s hydrates only real props of the component it compiles to",
    (component) => {
      const spec = REFERENCE_SURFACE[component];
      const targetProps = knownPropNamesFor(spec.compilesTo);
      const unfillable = spec.hydratedProps.filter((prop) => !targetProps.includes(prop));
      expect(unfillable).toEqual([]);
    },
  );

  // The ladder's sharpest edge, asserted rather than asserted-about: a low-fidelity
  // diff really does force the model to paste the whole file twice.
  test("a low-fidelity diff requires both sides pasted in full", () => {
    const diffProps = COMPONENT_SURFACE.DiffViewer.props;
    expect(diffProps.before.required).toBe(true);
    expect(diffProps.after.required).toBe(true);
    expect(layeredReferenceFor("DiffViewer")).toBeNull();
  });
});

// ---- 3. The scrambled vocabulary is a pure renaming --------------------------

describe("SCRAMBLED_VOCABULARY is bijective and reversible", () => {
  test("component aliases are unique", () => {
    const aliases = DOCUMENTED_COMPONENTS.map((c) => SCRAMBLED_VOCABULARY.componentName(c));
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  test("tag aliases are unique", () => {
    const aliases = STRUCTURAL_TAGS.map((tag) => SCRAMBLED_VOCABULARY.tagName(tag));
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  test.each([...DOCUMENTED_COMPONENTS])("%s prop aliases are unique within it", (component) => {
    const aliases = documentedPropNamesOf(component).map((prop) =>
      SCRAMBLED_VOCABULARY.propName(component, prop),
    );
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  test("the inverse round-trips every component and every prop", () => {
    const { componentNameByAlias, propNameByAliasByComponent } = SCRAMBLED_VOCABULARY.inverse;

    for (const component of DOCUMENTED_COMPONENTS) {
      const componentAlias = SCRAMBLED_VOCABULARY.componentName(component);
      expect(componentNameByAlias[componentAlias]).toBe(component);

      for (const prop of documentedPropNamesOf(component)) {
        const propAlias = SCRAMBLED_VOCABULARY.propName(component, prop);
        expect(propNameByAliasByComponent[component]?.[propAlias]).toBe(prop);
      }
    }
  });

  test("the inverse round-trips every structural tag", () => {
    for (const tag of STRUCTURAL_TAGS) {
      const alias = SCRAMBLED_VOCABULARY.tagName(tag);
      expect(SCRAMBLED_VOCABULARY.inverse.tagNameByAlias[alias]).toBe(tag);
    }
  });

  test("aliases are opaque — no alias is its own real name", () => {
    for (const component of DOCUMENTED_COMPONENTS) {
      expect(SCRAMBLED_VOCABULARY.componentName(component)).not.toBe(component);
    }
  });

  test("REAL_VOCABULARY is the identity", () => {
    for (const component of DOCUMENTED_COMPONENTS) {
      expect(REAL_VOCABULARY.componentName(component)).toBe(component);
      for (const prop of documentedPropNamesOf(component)) {
        expect(REAL_VOCABULARY.propName(component, prop)).toBe(prop);
      }
    }
  });
});

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

function componentsAt(fidelity: Fidelity): readonly DocumentedComponentName[] {
  if (fidelity === Fidelity.High) return DOCUMENTED_COMPONENTS;
  return SURFACE_COMPONENTS;
}

// Derived from the data model, not from the rendered text — so the prompt is being
// checked against the table rather than against itself.
function expectedPropCount(fidelity: Fidelity, notation: Notation): number {
  const componentProps = componentsAt(fidelity).reduce((total, component) => {
    const visible =
      fidelity === Fidelity.High
        ? documentedPropNamesOf(component).length
        : Object.keys(COMPONENT_SURFACE[component as (typeof SURFACE_COMPONENTS)[number]].props)
            .length;
    return total + visible;
  }, 0);
  const shortcutLines = notation === Notation.Markup ? STRUCTURAL_TAGS.length : 0;
  return componentProps + shortcutLines;
}

type PromptPair = { readonly real: string; readonly scrambled: string };

function promptPair(notation: Notation, fidelity: Fidelity): PromptPair {
  return {
    real: renderSurfaceReference({ vocabulary: REAL_VOCABULARY, fidelity, notation }),
    scrambled: renderSurfaceReference({ vocabulary: SCRAMBLED_VOCABULARY, fidelity, notation }),
  };
}

const PROMPT_CASES = ALL_NOTATIONS.flatMap((notation) =>
  ALL_FIDELITIES.map((fidelity) => ({ notation, fidelity })),
);

// ---- 4. The two prompts differ ONLY in their identifiers ---------------------

describe("the real and scrambled prompts are structurally identical", () => {
  test.each([...PROMPT_CASES])("$notation/$fidelity: same line count", ({ notation, fidelity }) => {
    const { real, scrambled } = promptPair(notation, fidelity);
    expect(scrambled.split("\n").length).toBe(real.split("\n").length);
  });

  test.each([...PROMPT_CASES])(
    "$notation/$fidelity: both document every component, and the same ones",
    ({ notation, fidelity }) => {
      const { real, scrambled } = promptPair(notation, fidelity);
      const expected = componentsAt(fidelity).length;
      expect(headlinesOf(real, REAL_VOCABULARY, componentsAt(fidelity))).toHaveLength(expected);
      expect(headlinesOf(scrambled, SCRAMBLED_VOCABULARY, componentsAt(fidelity))).toHaveLength(
        expected,
      );
    },
  );

  test.each([...PROMPT_CASES])(
    "$notation/$fidelity: both document every prop, and the same number",
    ({ notation, fidelity }) => {
      const { real, scrambled } = promptPair(notation, fidelity);
      const expected = expectedPropCount(fidelity, notation);
      expect(propLinesOf(real)).toHaveLength(expected);
      expect(propLinesOf(scrambled)).toHaveLength(expected);
    },
  );
});

// ---- 5. No familiarity leaks in either direction -----------------------------

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
  // what remains — every word we actually wrote — must be byte-identical.
  test.each([...PROMPT_CASES])(
    "$notation/$fidelity: the semantic text is word-for-word identical",
    ({ notation, fidelity }) => {
      const { real, scrambled } = promptPair(notation, fidelity);
      const realMeanings = meaningsOf(real, REAL_VOCABULARY, componentsAt(fidelity));
      const scrambledMeanings = meaningsOf(
        scrambled,
        SCRAMBLED_VOCABULARY,
        componentsAt(fidelity),
      );
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

// ---- 6. The dialect the prompt describes is the dialect that compiles ---------

describe("the markup reference describes the dialect the compiler implements", () => {
  // Low fidelity only: the high-fidelity examples use reference props that the
  // hydrator resolves away BEFORE anything reaches the compiler, so the compiler
  // has never heard of them and would rightly reject them.
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
