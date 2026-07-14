// Turns an element's HTML attributes into catalog props. This is where the
// dialect's authoring sugar lives:
//   - bind="/form/email"      → {$bindState:"/form/email"} on the natural value prop
//   - intent="retry"          → an on.press canvas.intent binding
//   - submit="signup"         → an on.press canvas.submit binding
//   - required / minlength=8  → entries in the catalog's `checks` array
//   - data="[...]" / "{...}"  → JSON-parsed arrays and objects
//   - height="320"            → numbers for number-typed props
//   - value="$state.x"        → passed through untouched for the expression grammar
// Prop names arrive lowercased by the parser and are mapped back to their
// camelCase catalog spelling via component-catalog.

import type { ActionBinding } from "../../../src/shared/types.ts";
import {
  isBooleanProp,
  isNumberProp,
  knownPropNamesFor,
  propNameFor,
} from "./component-catalog.ts";
import {
  CanvasAction,
  DEFAULT_SUBMIT_PAYLOAD_POINTER,
  FORM_CONTROL_COMPONENTS,
  naturalValuePropOf,
} from "./conventions.ts";

export type BuiltElementBody = {
  props: Record<string, unknown>;
  on?: Record<string, ActionBinding[]>;
};

type FormCheck = { type: string; message?: string; args?: Record<string, unknown> };

type AddIssue = (message: string) => void;

const SUGAR_ATTRS = {
  Bind: "bind",
  Intent: "intent",
  IntentParams: "intent-params",
  IntentParamsAlt: "intentparams",
  Submit: "submit",
  Payload: "payload",
  Class: "class",
} as const;

const IGNORED_ATTRS: ReadonlySet<string> = new Set(["id", "style", "key"]);

export function buildElementBody(
  component: string,
  attribs: Readonly<Record<string, string>>,
  elementKey: string,
  strictAttrs: boolean,
  addIssue: AddIssue,
): BuiltElementBody {
  const props: Record<string, unknown> = {};
  const nativeChecks: FormCheck[] = [];
  const isFormControl = FORM_CONTROL_COMPONENTS.has(component);

  let bindPointer: string | null = null;
  let intentId: string | null = null;
  let intentParamsRaw: string | null = null;
  let submitId: string | null = null;
  let payloadRaw: string | null = null;
  let typeValue: string | null = null;

  for (const [rawName, rawValue] of Object.entries(attribs)) {
    const name = rawName.toLowerCase();

    if (name === SUGAR_ATTRS.Bind) {
      bindPointer = rawValue;
      continue;
    }
    if (name === SUGAR_ATTRS.Intent) {
      intentId = rawValue.trim();
      continue;
    }
    if (name === SUGAR_ATTRS.IntentParams || name === SUGAR_ATTRS.IntentParamsAlt) {
      intentParamsRaw = rawValue;
      continue;
    }
    if (name === SUGAR_ATTRS.Submit) {
      submitId = rawValue.trim();
      continue;
    }
    if (name === SUGAR_ATTRS.Payload) {
      payloadRaw = rawValue;
      continue;
    }
    if (name === SUGAR_ATTRS.Class) {
      applyClassAttr(component, rawValue, props);
      continue;
    }
    if (IGNORED_ATTRS.has(name)) continue;

    if (name === "type" && isFormControl) typeValue = rawValue.trim().toLowerCase();

    if (isFormControl) {
      const check = nativeCheckFor(name, rawValue, elementKey, addIssue);
      if (check !== null) {
        nativeChecks.push(check);
        continue;
      }
    }

    assignProp(component, name, rawValue, elementKey, strictAttrs, props, addIssue);
  }

  appendTypeInferredCheck(typeValue, nativeChecks);
  mergeChecks(props, nativeChecks);
  applyBindSugar(component, bindPointer, props);

  const pressBindings = buildPressBindings(
    { intentId, intentParamsRaw, submitId, payloadRaw },
    elementKey,
    addIssue,
  );
  if (pressBindings.length === 0) return { props };
  return { props, on: { press: pressBindings } };
}

function applyClassAttr(
  component: string,
  rawValue: string,
  props: Record<string, unknown>,
): void {
  const propName = propNameFor(component, "classname");
  if (propName !== null) props[propName] = rawValue.trim();
}

function assignProp(
  component: string,
  lowercaseName: string,
  rawValue: string,
  elementKey: string,
  strictAttrs: boolean,
  props: Record<string, unknown>,
  addIssue: AddIssue,
): void {
  const propName = propNameFor(component, lowercaseName);
  if (propName === null) {
    if (strictAttrs) {
      const known = knownPropNamesFor(component).join(", ");
      addIssue(
        `elements/${elementKey}: unknown attribute "${lowercaseName}" on <${component}>. Known attributes: ${known}`,
      );
    }
    return;
  }
  const parsed = parseAttrValue(component, propName, rawValue, lowercaseName, elementKey, addIssue);
  if (parsed.ok) props[propName] = parsed.value;
}

type ParseOutcome = { ok: true; value: unknown } | { ok: false };

function parseAttrValue(
  component: string,
  propName: string,
  rawValue: string,
  lowercaseName: string,
  elementKey: string,
  addIssue: AddIssue,
): ParseOutcome {
  if (isBooleanProp(component, propName)) {
    return { ok: true, value: coerceBoolean(rawValue) };
  }
  const trimmed = rawValue.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return parseJsonAttr(trimmed, lowercaseName, elementKey, addIssue);
  }
  if (isNumberProp(component, propName) && isNumericString(trimmed)) {
    return { ok: true, value: Number(trimmed) };
  }
  return { ok: true, value: rawValue };
}

function parseJsonAttr(
  trimmed: string,
  lowercaseName: string,
  elementKey: string,
  addIssue: AddIssue,
): ParseOutcome {
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    addIssue(
      `elements/${elementKey}: attribute "${lowercaseName}" starts with "${trimmed[0]}" so it is parsed as JSON, but it is invalid JSON (${detail}). Fix the JSON, or drop the bracket if it is meant to be plain text.`,
    );
    return { ok: false };
  }
}

function coerceBoolean(rawValue: string): boolean {
  const normalized = rawValue.trim().toLowerCase();
  return !(normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off");
}

const NUMERIC_STRING_PATTERN = /^-?\d+(\.\d+)?$/;

function isNumericString(value: string): boolean {
  return NUMERIC_STRING_PATTERN.test(value);
}

// ---- Native validation attributes → checks ---------------------------------

function nativeCheckFor(
  name: string,
  rawValue: string,
  elementKey: string,
  addIssue: AddIssue,
): FormCheck | null {
  if (name === "required") return { type: "required", message: "Required" };
  if (name === "minlength") {
    return lengthCheck("minLength", rawValue, "at least", elementKey, name, addIssue);
  }
  if (name === "maxlength") {
    return lengthCheck("maxLength", rawValue, "at most", elementKey, name, addIssue);
  }
  if (name === "min") return boundCheck("min", rawValue, elementKey, name, addIssue);
  if (name === "max") return boundCheck("max", rawValue, elementKey, name, addIssue);
  if (name === "pattern") return { type: "pattern", args: { pattern: rawValue } };
  return null;
}

function lengthCheck(
  type: string,
  rawValue: string,
  phrase: string,
  elementKey: string,
  name: string,
  addIssue: AddIssue,
): FormCheck | null {
  const length = numericAttr(rawValue, elementKey, name, addIssue);
  if (length === null) return null;
  return { type, args: { value: length }, message: `Must be ${phrase} ${length} characters` };
}

function boundCheck(
  type: string,
  rawValue: string,
  elementKey: string,
  name: string,
  addIssue: AddIssue,
): FormCheck | null {
  const value = numericAttr(rawValue, elementKey, name, addIssue);
  if (value === null) return null;
  return { type, args: { value } };
}

function numericAttr(
  rawValue: string,
  elementKey: string,
  name: string,
  addIssue: AddIssue,
): number | null {
  const trimmed = rawValue.trim();
  if (!isNumericString(trimmed)) {
    addIssue(`elements/${elementKey}: attribute "${name}" expects a number, got "${rawValue}".`);
    return null;
  }
  return Number(trimmed);
}

function appendTypeInferredCheck(typeValue: string | null, checks: FormCheck[]): void {
  if (typeValue === "email") checks.push({ type: "email", message: "Enter a valid email" });
  if (typeValue === "url") checks.push({ type: "url", message: "Enter a valid URL" });
}

function mergeChecks(props: Record<string, unknown>, nativeChecks: FormCheck[]): void {
  if (nativeChecks.length === 0) return;
  const existing = Array.isArray(props.checks) ? props.checks : [];
  props.checks = [...existing, ...nativeChecks];
}

// ---- bind / intent / submit sugar ------------------------------------------

function applyBindSugar(
  component: string,
  bindPointer: string | null,
  props: Record<string, unknown>,
): void {
  if (bindPointer === null) return;
  props[naturalValuePropOf(component)] = { $bindState: normalizePointer(bindPointer) };
}

type PressSugar = {
  intentId: string | null;
  intentParamsRaw: string | null;
  submitId: string | null;
  payloadRaw: string | null;
};

function buildPressBindings(
  sugar: PressSugar,
  elementKey: string,
  addIssue: AddIssue,
): ActionBinding[] {
  const bindings: ActionBinding[] = [];
  const intent = buildIntentBinding(sugar, elementKey, addIssue);
  if (intent !== null) bindings.push(intent);
  const submit = buildSubmitBinding(sugar, elementKey, addIssue);
  if (submit !== null) bindings.push(submit);
  return bindings;
}

function buildIntentBinding(
  sugar: PressSugar,
  elementKey: string,
  addIssue: AddIssue,
): ActionBinding | null {
  if (sugar.intentId === null) return null;
  if (sugar.intentId.length === 0) {
    addIssue(`elements/${elementKey}: intent="" needs a non-empty intent id.`);
    return null;
  }
  const params: Record<string, unknown> = { id: sugar.intentId };
  if (sugar.intentParamsRaw !== null) {
    const parsed = parseIntentParams(sugar.intentParamsRaw, elementKey, addIssue);
    if (parsed !== null) params.params = parsed;
  }
  return { action: CanvasAction.Intent, params };
}

function parseIntentParams(
  raw: string,
  elementKey: string,
  addIssue: AddIssue,
): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    addIssue(`elements/${elementKey}: intent-params is invalid JSON (${detail}).`);
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    addIssue(`elements/${elementKey}: intent-params must be a JSON object.`);
    return null;
  }
  return parsed as Record<string, unknown>;
}

function buildSubmitBinding(
  sugar: PressSugar,
  elementKey: string,
  addIssue: AddIssue,
): ActionBinding | null {
  if (sugar.submitId === null) return null;
  if (sugar.submitId.length === 0) {
    addIssue(`elements/${elementKey}: submit="" needs a non-empty submit id.`);
    return null;
  }
  return {
    action: CanvasAction.Submit,
    params: { id: sugar.submitId, payload: submitPayload(sugar.payloadRaw, elementKey, addIssue) },
  };
}

function submitPayload(
  payloadRaw: string | null,
  elementKey: string,
  addIssue: AddIssue,
): unknown {
  if (payloadRaw === null) return { $state: DEFAULT_SUBMIT_PAYLOAD_POINTER };
  const trimmed = payloadRaw.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      addIssue(`elements/${elementKey}: payload is invalid JSON (${detail}).`);
      return { $state: DEFAULT_SUBMIT_PAYLOAD_POINTER };
    }
  }
  return { $state: normalizePointer(trimmed) };
}

function normalizePointer(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("/")) return trimmed;
  return `/${trimmed.replace(/\./g, "/")}`;
}
