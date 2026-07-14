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

// An ELEMENT-LEVEL reference is a $-key sitting directly in props (rather than
// as a prop's value): `{"type": "DiffViewer", "props": {"$diff": "src/a.ts"}}`.
// The daemon expands it at push time into the props listed in `supplies`, and
// consumes the keys in `consumes`. Validation runs BEFORE hydration, so it must
// read this same contract — otherwise it rejects `$diff` as an unknown prop and
// `before`/`after`/`file` as missing. One table, both readers: they cannot drift.
export const ElementLevelReferences = {
  DiffViewer: {
    key: ReferenceExpressionKey.Diff,
    consumes: [ReferenceExpressionKey.Diff, "base", "staged", "watch"],
    supplies: ["file", "before", "after"],
  },
} as const satisfies Record<
  string,
  { key: ReferenceExpressionKey; consumes: readonly string[]; supplies: readonly string[] }
>;

type ElementLevelReferenceContract = {
  consumes: readonly string[];
  supplies: readonly string[];
};

// The contract for an element carrying an element-level reference, or null when
// it carries none (the overwhelmingly common case).
export function elementLevelReferenceOf(
  componentType: string,
  props: Record<string, unknown>,
): ElementLevelReferenceContract | null {
  const contract = ElementLevelReferences[componentType as keyof typeof ElementLevelReferences];
  if (!contract) return null;
  if (typeof props[contract.key] !== "string") return null;
  return contract;
}

// A PROP-VALUE reference can supply more than the prop it sits in. `{"rows":
// {"$csv": "results.csv"}}` on a DataTable resolves against a file whose FIRST
// ROW is the table's shape, so the daemon fills `columns` from it too — the
// model names a file it has never opened and never has to guess its header. That
// is the whole point of the reference: the daemon reads the file, not the model.
//
// Same one-table-two-readers contract as ElementLevelReferences above, for the
// other reference shape. Validation runs BEFORE hydration, so it reads this to
// stop reporting the supplied props missing; hydration reads it to know which
// props to fill from the resolution it just performed. An explicitly authored
// prop always wins: hydration never overwrites `columns` the author wrote.
export const PropValueReferences = {
  DataTable: {
    prop: "rows",
    key: ReferenceExpressionKey.Csv,
    supplies: ["columns"],
  },
} as const satisfies Record<string, PropValueReferenceContract>;

export type PropValueReferenceContract = {
  prop: string;
  key: ReferenceExpressionKey;
  supplies: readonly string[];
};

type PropValueReferenceTable = typeof PropValueReferences;
type PropValueReferenceEntry = PropValueReferenceTable[keyof PropValueReferenceTable];

// The props a reference of one KIND supplies, across every component whose
// contract declares it. The hydrator types its resolution against this, so a
// prop added to a `supplies` list above does not compile until hydration
// actually produces it — the validator can never promise a prop the hydrator
// does not fill.
export type SuppliedPropsOf<Key extends ReferenceExpressionKey> = Record<
  Extract<PropValueReferenceEntry, { key: Key }>["supplies"][number],
  unknown
>;

// The contract for an element whose prop carries a supplying reference, or null
// when it carries none. Both the reference's kind and the prop it sits in must
// match: a $file in DataTable.rows supplies nothing, and neither does a $csv in
// Chart.data (a Chart plots the rows; it has no columns to fill).
export function propValueReferenceOf(
  componentType: string,
  props: Record<string, unknown>,
): PropValueReferenceContract | null {
  const contract = propValueReferenceContractFor(componentType);
  if (!contract) return null;
  const reference = parseReferenceValue(props[contract.prop]);
  if (reference === null) return null;
  if (referenceKeyOf(reference) !== contract.key) return null;
  return contract;
}

function propValueReferenceContractFor(componentType: string): PropValueReferenceContract | null {
  const table: Readonly<Record<string, PropValueReferenceContract>> = PropValueReferences;
  return table[componentType] ?? null;
}

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

// A prop value carrying a reference, normalized from EITHER authored form — the
// object ({"$csv": "x.csv", "limit": 500}) or the string shorthand ("$csv:x.csv")
// — into the one flat record the hydrator reads options off. Null when the value
// is not a reference at all. One definition, so every reader agrees on what
// counts as a reference.
export function parseReferenceValue(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") return parseReferenceShorthand(value);
  if (isPlainObject(value) && isReferenceExpression(value)) return value;
  return null;
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
