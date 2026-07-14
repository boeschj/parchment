// THE ANTI-DRIFT TEST. This file is the reason the harness cannot lie to the
// model again.
//
// The bug it exists to prevent, in full, because it was expensive:
//
//   The eval kept its own copy of the component grammar. It told the model that
//   <LogStream> accepted groupBy="hour|day|week" and offered no way to filter or
//   aggregate. The shipped daemon accepts any duration ("10m"), plus `match`,
//   `series`, `metric`, `pattern` and `parser`. Asked to bucket a log into ten
//   minutes, the model read the grammar it had been handed, concluded — correctly
//   — that the reference could not express the question, aggregated the log
//   itself, and paid 1,108 output tokens to do it. We published that as
//   "the ladder does not always pay: models rationally bypass a reference that
//   cannot express their task." The sentence was true. The evidence was a harness
//   bug: the reference COULD express the task. We had simply not told the model.
//
// So every assertion below compares the eval's description of the grammar against
// the SHIPPED tables — the ones spec-validation rejects against and the markup
// compiler enforces — in BOTH directions:
//
//   - nothing the eval names may be absent from the product (no strawmanning our
//     own format: a prop the compiler rejects is a loss the arm did not earn), and
//   - nothing the product offers on a documented reference tag may be missing
//     from the eval (no silently unusable feature: THAT is the direction the
//     LogStream bug travelled, and a subset test would have passed it).

import { describe, expect, test } from "bun:test";
import { ComponentContracts } from "../../src/shared/catalog/component-contracts.ts";
import {
  acceptsChildren,
  knownPropNamesFor,
  resolveComponentName,
} from "../../src/daemon/markup/component-catalog.ts";
import { compileMarkup } from "../../src/daemon/markup/index.ts";
import {
  REFERENCE_TAG_GRAMMAR,
  referenceTargetOf,
} from "../../src/daemon/markup/references.ts";
import {
  ElementLevelReferences,
  PropValueReferences,
  parseReferenceValue,
  referenceKeyOf,
} from "../../src/shared/expressions.ts";
import { BUCKET_INTERVAL_EXAMPLES, parseBucketInterval } from "../../src/daemon/hydrate/logs.ts";
import { prepareSpec } from "../../src/daemon/spec-validation.ts";
import { REAL_VOCABULARY, SCRAMBLED_VOCABULARY } from "./vocabulary.ts";
import {
  COMPONENT_SURFACE,
  DOCUMENTED_COMPONENTS,
  LAYERED_REFERENCE_COMPONENTS,
  REFERENCE_SURFACE,
  STANDALONE_REFERENCE_COMPONENTS,
  STRUCTURAL_TAGS,
  SURFACE_COMPONENTS,
  acceptsChildrenIn,
  compilesToOf,
  documentedPropNamesOf,
  hydratedPropsOf,
  isCompiledTag,
  isRequiredProp,
  notationOf,
  standaloneReferenceAttrsOf,
} from "./vocabulary.ts";
import { referenceMarkupExampleFor } from "./surface.ts";

// ---- 1. Every component the eval names is a component the daemon renders ------

describe("the documented components are the shipped components", () => {
  test.each([...SURFACE_COMPONENTS])("%s is in the shipped catalog", (component) => {
    expect(resolveComponentName(component)).toBe(component);
  });

  test.each([...SURFACE_COMPONENTS])("%s has a shipped contract", (component) => {
    expect(ComponentContracts[component]).toBeDefined();
  });

  test.each([...SURFACE_COMPONENTS])("%s's children match the catalog", (component) => {
    expect(acceptsChildrenIn(component)).toBe(acceptsChildren(component));
  });
});

// ---- 2. Every prop the eval names is a prop the validator accepts -------------
//
// The strawman direction. A prompt that documents a prop the compiler rejects
// hands the parchment arms a loss they did not earn, on a technicality we made up.

describe("the documented props are the shipped props", () => {
  test.each([...SURFACE_COMPONENTS])("no %s prop is invented", (component) => {
    const real = knownPropNamesFor(component);
    const documented = Object.keys(COMPONENT_SURFACE[component].props);
    const invented = documented.filter((prop) => !real.includes(prop));
    expect(invented).toEqual([]);
  });

  // The other direction, for the props that MATTER: a required prop the prompt
  // never mentions is a prop the model cannot know to set, so the arm fails for
  // want of documentation rather than want of expressiveness. Every required prop
  // of every documented component must be documented.
  test.each([...SURFACE_COMPONENTS])("every required %s prop is documented", (component) => {
    const required = ComponentContracts[component]?.requiredProps ?? [];
    const documented = Object.keys(COMPONENT_SURFACE[component].props);
    const undocumented = required.filter((prop) => !documented.includes(prop));
    expect(undocumented).toEqual([]);
  });

  // Required-ness itself is read off the contract, so the two cannot disagree —
  // this pins that the accessor really is the contract's, and not a copy of it.
  test.each([...SURFACE_COMPONENTS])("%s's required-ness IS the contract's", (component) => {
    const contract = ComponentContracts[component];
    const documented = Object.keys(COMPONENT_SURFACE[component].props);
    const saidRequired = documented.filter((prop) => isRequiredProp(component, prop));
    const contractRequired = (contract?.requiredProps ?? []).filter((prop) =>
      documented.includes(prop),
    );
    expect(saidRequired.sort()).toEqual([...contractRequired].sort());
  });

  // The accepted values come from the schema, so a prop can never be advertised
  // with an enum the daemon does not take. A hand-written "One of a, b, c." in a
  // meaning sentence is exactly how that used to happen.
  test.each([...SURFACE_COMPONENTS])("no %s meaning hand-lists an enum", (component) => {
    const meanings = Object.values(COMPONENT_SURFACE[component].props);
    const enumerating = meanings.filter((meaning) => /\bone of\b/i.test(meaning));
    expect(enumerating).toEqual([]);
  });

  test("an enum prop's accepted values are the schema's", () => {
    expect(notationOf("Chart", "kind")).toBe("line|bar|area|pie|scatter");
    expect(notationOf("Callout", "tone")).toContain("warning");
  });
});

// ---- 3. Events: the eval's view of them is the contract's ---------------------
//
// The eval documents no `on` bindings — the markup dialect reaches events through
// bind=/intent=/submit= sugar. What it must never do is imply an event that does
// not exist, so the sugar the grammar advertises is checked against the contract
// that would have to fire it.

describe("the events the grammar implies are events the contract emits", () => {
  test("submit= and intent= bind a press, and Button emits press", () => {
    const { spec, issues } = compileMarkup('<Button submit="signup">Go</Button>');
    expect(issues).toEqual([]);
    const button = Object.values(spec.elements).find((element) => element.type === "Button");
    const boundEvents = Object.keys(button?.on ?? {});
    const emitted = ComponentContracts.Button?.events ?? [];
    expect(boundEvents.every((event) => emitted.includes(event))).toBe(true);
    expect(boundEvents.length).toBeGreaterThan(0);
  });

  // bind= writes through the natural value prop; the contract names the ONE prop
  // $bindState really writes back through. If those two ever disagree the form
  // silently never saves, and the prompt would be describing a binding that does
  // nothing.
  test.each(["Input", "Textarea", "Select"] as const)(
    "bind= on %s writes through the contract's bindable prop",
    (component) => {
      const { spec, issues } = compileMarkup(
        `<${component} label="L" name="n" options='["a"]' bind="/form/n" />`,
      );
      expect(issues).toEqual([]);
      const element = Object.values(spec.elements).find((node) => node.type === component);
      const bindable = ComponentContracts[component]?.bindableProp;
      expect(bindable).not.toBeNull();
      expect(element?.props[bindable ?? ""]).toEqual({ $bindState: "/form/n" });
    },
  );
});

// ---- 4. The reference grammar is the compiler's, attribute for attribute ------
//
// THE ONE THAT WOULD HAVE CAUGHT THE BUG. Exact equality, not a subset: an
// attribute the daemon gains and the eval does not document is a feature the
// model is never told about, and a benchmark that then reports the model "not
// climbing the ladder" is reporting its own omission.

describe("the reference tags' attributes are exactly the compiler's", () => {
  test.each([...STANDALONE_REFERENCE_COMPONENTS])(
    "<%s> documents every attribute the compiler takes, and no other",
    (component) => {
      const compilerAttrs = [...standaloneReferenceAttrsOf(component)].sort();
      const documented = Object.keys(REFERENCE_SURFACE[component].attrs).sort();
      expect(documented).toEqual(compilerAttrs);
    },
  );

  // The specific hole: a log reference that can only name a file is worth nothing
  // when the answer is six numbers. These four are what make it a QUESTION.
  test("<LogStream> can express the question the log scenario asks", () => {
    const attrs = Object.keys(REFERENCE_SURFACE.LogStream.attrs);
    expect(attrs).toContain("groupBy");
    expect(attrs).toContain("match");
    expect(attrs).toContain("metric");
    expect(attrs).toContain("series");
  });

  // And the bucket it asks in is a bucket the parser really takes. The sentence
  // that named hour|day|week is now unwritable: the durations come from logs.ts.
  test.each([...BUCKET_INTERVAL_EXAMPLES])("the advertised bucket %s parses", (duration) => {
    expect(parseBucketInterval(duration).ok).toBe(true);
  });

  test("the ten-minute bucket the scenario asks for is expressible", () => {
    expect(REFERENCE_SURFACE.LogStream.attrs.groupBy).toContain("{buckets}");
    expect(parseBucketInterval("10m").ok).toBe(true);
  });
});

// ---- 5. A reference hydrates exactly what the daemon fills --------------------

describe("what the prompt says the daemon fills is what the daemon fills", () => {
  test("<GitDiff> hydrates the props the element-level $diff supplies", () => {
    expect([...hydratedPropsOf("GitDiff")].sort()).toEqual(
      [...ElementLevelReferences.DiffViewer.supplies].sort(),
    );
  });

  // The Chart's data comes from the reference it carries; x and y are supplied
  // beside it, because only the daemon has read the file.
  test("<LogStream> hydrates the Chart's data plus the props the $log supplies", () => {
    const suppliedBeside = PropValueReferences.Chart.supplies;
    const filledProp = referenceTargetOf(compilesToOf("LogStream"))?.prop;
    expect([...hydratedPropsOf("LogStream")].sort()).toEqual(
      [filledProp ?? "", ...suppliedBeside].sort(),
    );
  });

  test("DataTable's src hydrates its rows plus the columns the $csv supplies", () => {
    const suppliedBeside = PropValueReferences.DataTable.supplies;
    const filledProp = referenceTargetOf("DataTable")?.prop;
    expect([...hydratedPropsOf("DataTable")].sort()).toEqual(
      [filledProp ?? "", ...suppliedBeside].sort(),
    );
  });

  test("CodeBlock's file hydrates the prop the $file fills", () => {
    expect([...hydratedPropsOf("CodeBlock")]).toEqual([referenceTargetOf("CodeBlock")?.prop ?? ""]);
  });

  test.each([...STANDALONE_REFERENCE_COMPONENTS, ...LAYERED_REFERENCE_COMPONENTS])(
    "%s hydrates only real props of the component it lands on",
    (component) => {
      const landsOn = REFERENCE_TAG_GRAMMAR[component as keyof typeof REFERENCE_TAG_GRAMMAR]
        ?.compilesTo ?? component;
      const realProps = knownPropNamesFor(landsOn);
      const unfillable = hydratedPropsOf(component).filter((prop) => !realProps.includes(prop));
      expect(unfillable).toEqual([]);
    },
  );

  test.each([...LAYERED_REFERENCE_COMPONENTS])(
    "%s really can take a reference in the shipped dialect",
    (component) => {
      expect(referenceTargetOf(component)).not.toBeNull();
    },
  );
});

// ---- 6. The prompt's own examples compile, and reach the daemon as references --
//
// The end-to-end proof that the grammar the prompt describes is the grammar that
// runs: every reference example the model is shown is fed to the REAL compiler and
// the REAL validator, and must come out the far side carrying a reference the
// hydrator will resolve. If the eval ever documents a reference the product does
// not implement, this goes red.

describe("the reference examples the prompt shows are executable", () => {
  test.each([...STANDALONE_REFERENCE_COMPONENTS, ...LAYERED_REFERENCE_COMPONENTS])(
    "the %s reference example compiles, validates, and carries a reference",
    (component) => {
      const example = referenceMarkupExampleFor(component, REAL_VOCABULARY);
      expect(example).not.toBeNull();

      const compiled = compileMarkup(example ?? "");
      expect(compiled.issues).toEqual([]);

      const carriesReference = Object.values(compiled.spec.elements).some(isReferenceCarrying);
      expect(carriesReference).toBe(true);

      // The validator runs BEFORE hydration in production, so the authored form
      // must survive it with the heavy props still absent.
      expect(prepareSpec(compiled.spec).issues).toEqual([]);
    },
  );

  test("the LogStream example is the one the log scenario needs: a matched, bucketed chart", () => {
    const compiled = compileMarkup(referenceMarkupExampleFor("LogStream", REAL_VOCABULARY) ?? "");
    const chart = Object.values(compiled.spec.elements).find((node) => node.type === "Chart");
    const reference = parseReferenceValue(chart?.props.data);

    expect(referenceKeyOf(reference)).toBe("$log");
    expect(reference?.groupBy).toBe("10m");
    expect(reference?.match).toBe("ERROR");
  });
});

function isReferenceCarrying(element: { props: Record<string, unknown> }): boolean {
  if (typeof element.props.$diff === "string") return true;
  return Object.values(element.props).some((value) => parseReferenceValue(value) !== null);
}

// ---- 7. The structural shortcuts are tags the compiler really maps -------------

describe("the documented shortcuts are shortcuts the compiler implements", () => {
  test.each([...STRUCTURAL_TAGS])("<%s> is a tag the compiler maps", (tag) => {
    expect(isCompiledTag(tag)).toBe(true);
  });
});

// ---- 8. The scramble is a transformation OVER the derived catalog --------------
//
// Not a second catalog. The scrambled arm therefore tracks the product exactly as
// closely as the real arm does: a prop the daemon gains is a prop the scrambled
// arm can name on the next build, with no edit anywhere.

describe("the scrambled vocabulary is derived, bijective, and reversible", () => {
  test("it renames exactly the identifiers the product defines — no more, no fewer", () => {
    for (const component of DOCUMENTED_COMPONENTS) {
      const aliased = Object.keys(
        SCRAMBLED_VOCABULARY.inverse.propNameByAliasByComponent[component] ?? {},
      );
      expect(aliased).toHaveLength(documentedPropNamesOf(component).length);
    }
  });

  // The one that keeps the ablation from measuring the harness: the scrambled arm
  // authors <C22 a1=… a2=…> and the harness must turn that back into the exact
  // component and props it meant, per component, never through a flat map.
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

  test("the reference tags are scrambled too — the ladder is not a familiarity freebie", () => {
    for (const component of STANDALONE_REFERENCE_COMPONENTS) {
      expect(SCRAMBLED_VOCABULARY.componentName(component)).not.toBe(component);
      for (const attr of standaloneReferenceAttrsOf(component)) {
        expect(SCRAMBLED_VOCABULARY.propName(component, attr)).not.toBe(attr);
      }
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

  test("component aliases are unique", () => {
    const aliases = DOCUMENTED_COMPONENTS.map((c) => SCRAMBLED_VOCABULARY.componentName(c));
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  test.each([...DOCUMENTED_COMPONENTS])("%s prop aliases are unique within it", (component) => {
    const aliases = documentedPropNamesOf(component).map((prop) =>
      SCRAMBLED_VOCABULARY.propName(component, prop),
    );
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  test("tag aliases are unique and round-trip", () => {
    const aliases = STRUCTURAL_TAGS.map((tag) => SCRAMBLED_VOCABULARY.tagName(tag));
    expect(new Set(aliases).size).toBe(aliases.length);
    for (const tag of STRUCTURAL_TAGS) {
      const alias = SCRAMBLED_VOCABULARY.tagName(tag);
      expect(SCRAMBLED_VOCABULARY.inverse.tagNameByAlias[alias]).toBe(tag);
    }
  });
});
