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

// ---- Reference expressions (content hydration) ----------------------------
// A second family of $-prefixed expressions. Unlike $state/$bindState (which
// stay live in the browser), a reference is resolved ONCE by the daemon at
// slot-push time: it names a local resource the daemon reads and inlines —
// a file's text, a git diff, parsed CSV rows, or a served image URL. The
// grammar (shapes + detectors + string shorthand) lives here so the daemon's
// hydrator and any spec tooling share one definition; the resolution itself
// (filesystem, git, blob URLs) lives in src/daemon/hydrate.

export const ReferenceExpressionKey = {
  File: "$file",
  Diff: "$diff",
  Csv: "$csv",
  Img: "$img",
} as const;

export type ReferenceExpressionKey =
  (typeof ReferenceExpressionKey)[keyof typeof ReferenceExpressionKey];

const REFERENCE_EXPRESSION_KEYS = Object.values(ReferenceExpressionKey);

// The path (or the primary argument) is the value under the $-key; options
// sit beside it as sibling keys — the same "options are siblings of the
// $-key" convention the object forms below and the element-level $diff share.
export type FileReference = { $file: string; lines?: string; watch?: boolean };
export type DiffReference = { $diff: string; base?: string; staged?: boolean; watch?: boolean };
export type CsvReference = { $csv: string; limit?: number };
export type ImgReference = { $img: string };

export type ReferenceExpression = FileReference | DiffReference | CsvReference | ImgReference;

// The $-key present on a reference object, or null when the value is not a
// reference. A reference is recognized only when its $-key holds a string, so
// {$state:...} objects and stray $-keys never read as references.
export function referenceKeyOf(value: unknown): ReferenceExpressionKey | null {
  if (!isPlainObject(value)) return null;
  for (const key of REFERENCE_EXPRESSION_KEYS) {
    if (typeof value[key] === "string") return key;
  }
  return null;
}

export function isReferenceExpression(value: unknown): boolean {
  return referenceKeyOf(value) !== null;
}

// Bare-string shorthand for a whole-resource reference: "$file:src/a.ts",
// "$diff:src/a.ts", "$csv:data/x.csv", "$img:shot.png". Safe under the
// existing $-prefix convention (a real content string does not begin "$file:")
// and carries no options — the object form is canonical when a line range,
// git base, or watch flag is needed.
const REFERENCE_SHORTHAND_PATTERN = /^\$(file|diff|csv|img):(.+)$/;

export function parseReferenceShorthand(raw: string): ReferenceExpression | null {
  const match = raw.trim().match(REFERENCE_SHORTHAND_PATTERN);
  if (!match) return null;
  const kind = match[1];
  const path = (match[2] ?? "").trim();
  if (path.length === 0) return null;
  if (kind === "file") return { $file: path };
  if (kind === "diff") return { $diff: path };
  if (kind === "csv") return { $csv: path };
  return { $img: path };
}
