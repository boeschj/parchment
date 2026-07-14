// Contract coverage: everything spec-validation.ts REJECTS a spec for must be
// recoverable from the prompt text the model is given. A compaction that drops
// a required prop, an event, an enum value or a bindable prop does not make the
// model cheaper — it makes it fail, at the exact rate it now has to guess.
//
// So this parses the contract back OUT of the generated text and asserts it
// equals ComponentContracts. Enum values are checked against z.toJSONSchema —
// an independent derivation from the same schema, so a bug in the prompt's own
// type walker cannot hide itself.

import { describe, it, expect } from "bun:test";
import * as z from "zod/v4";
import { compactCatalogPrompt } from "./catalog-prompt.ts";
import {
  ComponentContracts,
  ElementFields,
  KnownActionNames,
  KnownCheckTypes,
} from "./component-contracts.ts";
import { WidenedComponentPropSchemas } from "./prop-normal-forms.ts";

const prompt = compactCatalogPrompt();

type ParsedSignature = {
  props: string[];
  requiredProps: string[];
  events: string[];
  bindableProp: string | null;
};

const SIGNATURE_LINE = /^([A-Z]\w*)\((.*?)\)((?:\s+[+\->=]\S+)*)/;

function parseSignatures(text: string): Record<string, ParsedSignature> {
  const signatures: Record<string, ParsedSignature> = {};
  for (const line of text.split("\n")) {
    const match = line.match(SIGNATURE_LINE);
    if (!match) continue;
    const [, componentName, propList, markers] = match;
    if (!componentName || propList === undefined) continue;
    signatures[componentName] = {
      props: propNamesOf(propList),
      requiredProps: propNamesOf(propList).filter((_, index) => !isOptionalAt(propList, index)),
      events: eventsOf(markers ?? ""),
      bindableProp: bindablePropOf(markers ?? ""),
    };
  }
  return signatures;
}

// Split on top-level commas only — a prop's type may itself be an object or a
// union containing commas ({title: str, detail?: str}).
function topLevelProps(propList: string): string[] {
  const props: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of propList) {
    if (character === "{" || character === "[") depth++;
    if (character === "}" || character === "]") depth--;
    if (character === "," && depth === 0) {
      props.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim().length > 0) props.push(current.trim());
  return props;
}

function propNamesOf(propList: string): string[] {
  return topLevelProps(propList).map((prop) => prop.split(/[?:]/)[0]?.trim() ?? "");
}

function isOptionalAt(propList: string, index: number): boolean {
  const prop = topLevelProps(propList)[index] ?? "";
  const nameAndMarker = prop.split(":")[0] ?? "";
  return nameAndMarker.trim().endsWith("?");
}

function eventsOf(markers: string): string[] {
  const match = markers.match(/->(\S+)/);
  if (!match?.[1]) return [];
  return match[1].split(",");
}

function bindablePropOf(markers: string): string | null {
  const match = markers.match(/=bind:(\S+)/);
  return match?.[1] ?? null;
}

// Independent of the prompt's own type walker: Zod's serializer, on the same
// widened schema the validator parses against.
function enumValuesOf(componentName: string): string[] {
  const schema = WidenedComponentPropSchemas[componentName];
  if (!schema) return [];
  const jsonSchema = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  const values: string[] = [];
  collectEnums(jsonSchema, values);
  return values;
}

function collectEnums(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const entry of node) collectEnums(entry, out);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const record: Record<string, unknown> = { ...node };
  if (Array.isArray(record.enum)) {
    for (const value of record.enum) {
      if (typeof value === "string") out.push(value);
    }
  }
  for (const value of Object.values(record)) collectEnums(value, out);
}

const signatures = parseSignatures(prompt);
const componentNames = Object.keys(ComponentContracts);

describe("compactCatalogPrompt — contract coverage", () => {
  it("names every component in the catalog", () => {
    expect(Object.keys(signatures).sort()).toEqual([...componentNames].sort());
  });

  describe.each(componentNames)("%s", (componentName) => {
    const contract = ComponentContracts[componentName];
    const signature = signatures[componentName];

    it("lists every prop the renderer reads", () => {
      expect(signature?.props.sort()).toEqual([...(contract?.knownProps ?? [])].sort());
    });

    it("marks exactly the required props as required", () => {
      expect(signature?.requiredProps.sort()).toEqual([...(contract?.requiredProps ?? [])].sort());
    });

    it("lists every event the component emits", () => {
      expect(signature?.events.sort()).toEqual([...(contract?.events ?? [])].sort());
    });

    it("names the bindable prop", () => {
      expect(signature?.bindableProp).toEqual(contract?.bindableProp ?? null);
    });

    it("carries every enum value the validator accepts", () => {
      const line = promptLineFor(componentName);
      const missing = enumValuesOf(componentName).filter((value) => !line.includes(value));
      expect(missing).toEqual([]);
    });
  });
});

describe("compactCatalogPrompt — grammar coverage", () => {
  it("names every action the validator accepts", () => {
    const missing = KnownActionNames.filter((actionName) => !prompt.includes(actionName));
    expect(missing).toEqual([]);
  });

  it("names every check type the validator accepts", () => {
    const missing = KnownCheckTypes.filter((checkType) => !prompt.includes(checkType));
    expect(missing).toEqual([]);
  });

  it("names every field an element may carry", () => {
    const missing = ElementFields.filter((field) => !prompt.includes(field));
    expect(missing).toEqual([]);
  });
});

function promptLineFor(componentName: string): string {
  const line = prompt.split("\n").find((entry) => entry.startsWith(`${componentName}(`));
  return line ?? "";
}
