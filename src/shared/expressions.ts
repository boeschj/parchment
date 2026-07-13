// The expression grammar for spec prop values. A prop whose value is a plain
// object with a $-prefixed key ({$state}, {$bindState}, {$template}, {$cond},
// ...) resolves at render time rather than validating statically.
//
// The grammar also declares a string shorthand for the two state expressions:
// "$state.build.duration", "$state:/build/duration", and "$bindState./form/title"
// are accepted anywhere a prop value appears and normalize to the object form
// ({"$state": "/build/duration"}) before a spec reaches the browser.

const EXPRESSION_KEY_PREFIX = "$";

export function isExpressionValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(isExpressionValue);
  if (!isPlainObject(value)) return false;
  return Object.keys(value).some((key) => key.startsWith(EXPRESSION_KEY_PREFIX));
}

export type StateExpression = { $state: string } | { $bindState: string };

const STATE_SHORTHAND_PATTERN = /^\$(state|bindState)([.:/])(.+)$/;

export function parseStateShorthand(raw: string): StateExpression | null {
  const match = raw.trim().match(STATE_SHORTHAND_PATTERN);
  if (!match) return null;
  const body = (match[3] ?? "").trim();
  if (body.length === 0) return null;
  const pointer = body.startsWith("/") ? body : `/${body.replace(/\./g, "/")}`;
  if (match[1] === "state") return { $state: pointer };
  return { $bindState: pointer };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
