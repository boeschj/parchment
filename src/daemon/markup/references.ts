// The top rung of the fidelity ladder: attributes that NAME a file instead of
// pasting its bytes. Output tokens are where the cost lives, so this is the only
// lever that matters — an authored `<GitDiff file="src/daemon/server.ts"/>` is
// ~16 tokens against ~15,000 for pasting both sides of that file. No syntax
// choice competes with a 473x compression, which is why the dialect's job is to
// make the high rungs trivially reachable.
//
// The compiler only EMITS these expressions; the daemon's hydration engine
// resolves them (root-confined, symlink-guarded) at push time. The shapes below
// are the contract with that engine and are deliberately isolated in this one
// module.
//
// Grammar: the $-key's value is the PATH; options ride as sibling keys.
//   {"$file": "src/a.ts", "lines": "40-80", "watch": true}  → file text
//   {"$diff": "src/a.ts", "base": "HEAD~1", "staged": true} → unified patch
//   {"$csv":  "data/x.csv", "limit": 500}                   → row objects
//   {"$img":  "shots/after.png"}                            → blob URL
//   {"$log":  "app.log", "groupBy": "10m", "match": "ERROR"} → chart rows
// A diff is two-sided, so on a DiffViewer `$diff` is an ELEMENT-level props key
// that expands into file/before/after rather than filling one prop. A $log is
// the only reference that ANSWERS rather than quotes: the daemon buckets and
// aggregates the log, and supplies the Chart's `x` and `y` from what it found.

export const ReferenceExpressionKey = {
  File: "$file",
  Diff: "$diff",
  Csv: "$csv",
  Image: "$img",
  Log: "$log",
} as const;

export type ReferenceExpressionKey =
  (typeof ReferenceExpressionKey)[keyof typeof ReferenceExpressionKey];

// The attributes that turn a component into a reference. `file` is universal;
// `src` is the ecosystem-standard spelling for a data source and is only read as
// a reference where the component has no real `src` prop (DataTable, Chart) or
// where the value is a local path rather than a URL (Image).
export const ReferenceAttr = {
  File: "file",
  Src: "src",
  Diff: "diff",
  Lines: "lines",
  Base: "base",
  Watch: "watch",
  Staged: "staged",
  Limit: "limit",
} as const;

export type ReferenceOptions = {
  lines?: string;
  watch?: boolean;
  limit?: number;
  base?: string;
  staged?: boolean;
};

type ReferenceTarget = {
  prop: string;
  key: ReferenceExpressionKey;
};

// Which prop a file reference fills on each component, and the expression the
// hydration engine resolves it with. A component absent from this table cannot
// take a reference — its `file`/`src` attributes stay ordinary props, so
// DiffViewer keeps `file` as its path LABEL and a remote Image keeps its URL.
export const REFERENCE_TARGETS = {
  CodeBlock: { prop: "code", key: ReferenceExpressionKey.File },
  Terminal: { prop: "output", key: ReferenceExpressionKey.File },
  Markdown: { prop: "content", key: ReferenceExpressionKey.File },
  MermaidEditor: { prop: "source", key: ReferenceExpressionKey.File },
  PlanFile: { prop: "markdown", key: ReferenceExpressionKey.File },
  Image: { prop: "src", key: ReferenceExpressionKey.Image },
  DataTable: { prop: "rows", key: ReferenceExpressionKey.Csv },
  Chart: { prop: "data", key: ReferenceExpressionKey.Csv },
  Sparkline: { prop: "data", key: ReferenceExpressionKey.Csv },
} as const satisfies Record<string, ReferenceTarget>;

export type ReferenceComponent = keyof typeof REFERENCE_TARGETS;

export function referenceTargetOf(component: string): ReferenceTarget | null {
  if (Object.prototype.hasOwnProperty.call(REFERENCE_TARGETS, component)) {
    return REFERENCE_TARGETS[component as ReferenceComponent];
  }
  return null;
}

export function buildReferenceExpression(
  key: ReferenceExpressionKey,
  path: string,
  options: ReferenceOptions,
): Record<string, unknown> {
  return { [key]: path, ...referenceOptionEntries(options) };
}

function referenceOptionEntries(options: ReferenceOptions): Record<string, unknown> {
  return {
    ...(options.lines !== undefined ? { lines: options.lines } : {}),
    ...(options.base !== undefined ? { base: options.base } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.watch === true ? { watch: true } : {}),
    ...(options.staged === true ? { staged: true } : {}),
  };
}

// A diff is two-sided, so it rides as an element-level props key the hydration
// engine expands into DiffViewer's file/before/after.
export function gitDiffProps(path: string, options: ReferenceOptions): Record<string, unknown> {
  return buildReferenceExpression(ReferenceExpressionKey.Diff, path, options);
}

// The question a <LogStream> asks of its file. `groupBy` is the only required
// one — a log reference with no bucket is not a chart — and the rest ride as
// sibling keys the aggregator reads.
export type LogQueryAttrs = {
  groupBy: string;
  match: string | null;
  pattern: string | null;
  parser: string | null;
  series: string | null;
  metric: string | null;
  watch: boolean;
};

export function logChartData(path: string, query: LogQueryAttrs): Record<string, unknown> {
  return {
    [ReferenceExpressionKey.Log]: path,
    groupBy: query.groupBy,
    ...optionalEntry("match", query.match),
    ...optionalEntry("pattern", query.pattern),
    ...optionalEntry("parser", query.parser),
    ...optionalEntry("series", query.series),
    ...optionalEntry("metric", query.metric),
    ...(query.watch ? { watch: true } : {}),
  };
}

function optionalEntry(name: string, value: string | null): Record<string, string> {
  if (value === null) return {};
  return { [name]: value };
}

// ---- The reference tags' attribute grammar ---------------------------------
//
// ONE TABLE, TWO READERS. The compiler validates <GitDiff>/<LogStream> against
// it and rejects anything else; every tool that DESCRIBES the dialect to a model
// renders the attribute list from it. A grammar a model is TOLD and a grammar a
// compiler ENFORCES that are two hand-kept lists is how a benchmark ends up
// measuring a reference the model was never given the words to reach for.

// The reference options are markup ATTRIBUTES, not catalog props, so no schema
// carries their type. This is that type, for anything that has to print one.
export const ReferenceAttrType = {
  Path: "path",
  Text: "str",
  Flag: "bool",
  Duration: "duration",
  Number: "num",
} as const;

export type ReferenceAttrType = (typeof ReferenceAttrType)[keyof typeof ReferenceAttrType];

// `null` means the attribute is a real prop of the component the tag compiles
// to, so its type comes from that component's schema and is never restated here.
type ReferenceTagAttrs = Readonly<Record<string, ReferenceAttrType | null>>;

export type ReferenceTagSpec = {
  readonly compilesTo: string;
  readonly attrs: ReferenceTagAttrs;
  // The props the daemon fills from the reference. The model omits them, and
  // spec-validation reads the same fact off shared/expressions.ts so it does not
  // report them missing.
  readonly supplies: readonly string[];
};

export const REFERENCE_TAG_GRAMMAR = {
  GitDiff: {
    compilesTo: "DiffViewer",
    attrs: {
      file: ReferenceAttrType.Path,
      base: ReferenceAttrType.Text,
      staged: ReferenceAttrType.Flag,
      watch: ReferenceAttrType.Flag,
      language: null,
      editableSide: null,
    },
    supplies: ["file", "before", "after"],
  },
  LogStream: {
    compilesTo: "Chart",
    attrs: {
      file: ReferenceAttrType.Path,
      groupBy: ReferenceAttrType.Duration,
      match: ReferenceAttrType.Text,
      pattern: ReferenceAttrType.Text,
      parser: ReferenceAttrType.Text,
      series: ReferenceAttrType.Text,
      metric: ReferenceAttrType.Text,
      watch: ReferenceAttrType.Flag,
      kind: null,
      title: null,
      height: null,
    },
    supplies: ["data", "x", "y"],
  },
} as const satisfies Record<string, ReferenceTagSpec>;

export type ReferenceTagName = keyof typeof REFERENCE_TAG_GRAMMAR;

// Without `groupBy` a <LogStream> is a live tail, not a chart — so these are the
// attributes that only mean something once there is a bucket to aggregate into.
// Writing one without `groupBy` is a question the daemon cannot answer.
export const LOG_AGGREGATION_ATTRS = ["match", "pattern", "parser", "series", "metric"] as const;

// The tail form's whole grammar: <LogStream file="app.log" watch/>.
export const LOG_TAIL_ATTRS = ["file", "watch"] as const;

export function referenceTagAttrNames(tag: ReferenceTagName): readonly string[] {
  return Object.keys(REFERENCE_TAG_GRAMMAR[tag].attrs);
}

// The compiler matches attributes the way an HTML parser hands them over.
export function lowercaseAttrSet(names: readonly string[]): ReadonlySet<string> {
  return new Set(names.map((name) => name.toLowerCase()));
}

// "40-80" | "40" | "40-" | "-80" — the gutter starts wherever the range does, so
// a referenced excerpt numbers its lines the way the file does.
const LINE_RANGE_START_PATTERN = /^(\d+)/;

export function startLineOf(lines: string | undefined): number | null {
  if (lines === undefined) return null;
  const match = lines.trim().match(LINE_RANGE_START_PATTERN);
  const start = match?.[1];
  if (start === undefined) return null;
  return Number.parseInt(start, 10);
}

// An Image `src` is a reference only when it names a local file. Anything with a
// scheme, a protocol-relative prefix, or a root-relative web path stays the URL
// the author wrote.
const REMOTE_SRC_PATTERN = /^([a-z][a-z0-9+.-]*:|\/\/|\/)/i;

export function isLocalPath(value: string): boolean {
  return !REMOTE_SRC_PATTERN.test(value.trim());
}
