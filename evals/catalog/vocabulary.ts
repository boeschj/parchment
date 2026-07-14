// THE ABLATION'S INTEGRITY LIVES HERE — AND SO DOES THE HARNESS'S HONESTY.
//
// One table describes the component surface. Every system prompt in the eval —
// real or scrambled, markup or json or terse-json — is rendered from it, so no
// arm can quietly drift into a better or worse description than another.
//
// WHAT IS DERIVED FROM THE PRODUCT, AND WHY IT MUST BE.
//
// This file used to hand-maintain the whole grammar: prop names, required-ness,
// accepted values, and the reference tags' attributes. It drifted, and the drift
// cost us a scenario. The eval told the model `LogStream` accepted
// groupBy="hour|day|week" and named no way to filter or aggregate; the shipped
// daemon takes any duration, `match`, `series` and `metric`. Asked for
// ten-minute buckets, the model looked at the grammar it had been handed,
// concluded correctly that it could not express the question, and did the
// aggregation itself. We then published that as a product finding. It was a
// harness bug.
//
// So nothing about the SHAPE of the grammar is written here any more:
//   - which components exist, and what props they have  → ComponentContracts
//   - which props are REQUIRED                          → ComponentContracts
//   - what values a prop accepts                        → the widened Zod schema
//   - whether a component takes children                → the catalog definition
//   - the reference tags' attributes                    → REFERENCE_TAG_GRAMMAR
//   - what a reference hydrates                         → the same table
//   - the log bucket grammar                            → the parser itself
// vocabulary.test.ts fails if any of them diverges.
//
// What IS written here is PROSE: one `purpose` sentence per component and one
// `meaning` sentence per prop. No type can carry those, and they steer component
// CHOICE, which no validator checks. They are also what makes the scramble a
// fair ablation: both vocabularies reuse them word-for-word, because the question
// is "is the token familiar", not "does the model know what a chart is". A
// scrambled prompt that also degraded the semantics would be a strawman.
//
// Held fixed across both vocabularies (deliberately NOT scrambled): the grammar
// keywords — the markup sugar (bind/intent/submit/required), the spec's
// structural keys (root/elements/type/props/children), the terse keys
// (r/e/t/p/c) — and every prop VALUE (kind="bar" stays "bar"). Those are the
// notation, not the vocabulary. Scrambling them would answer a different
// question than the one asked.

import { propTypeNotation } from "../../src/shared/catalog/catalog-prompt.ts";
import { ComponentContracts } from "../../src/shared/catalog/component-contracts.ts";
import { acceptsChildren } from "../../src/daemon/markup/component-catalog.ts";
import { semanticRuleFor } from "../../src/daemon/markup/tag-map.ts";
import {
  REFERENCE_TAG_GRAMMAR,
  referenceTagAttrNames,
  type ReferenceTagName,
} from "../../src/daemon/markup/references.ts";
import { BUCKET_INTERVAL_SYNTAX } from "../../src/daemon/hydrate/logs.ts";

// ---- Shape ------------------------------------------------------------------

// A prop value as it appears in an example. Serialized per notation: quoted as an
// attribute for markup, emitted as JSON for the spec notations.
export type ExampleValue =
  | string
  | number
  | boolean
  | readonly ExampleValue[]
  | { readonly [key: string]: ExampleValue };

// The prose, and only the prose. `required`, the accepted values, and whether the
// component takes children are read off the product below.
export type ComponentSpec = {
  readonly purpose: string;
  // propName → the one sentence that says what it means. Every key must be a real
  // prop of the component, and every REQUIRED prop must appear.
  readonly props: Readonly<Record<string, string>>;
  // The inline-content example, in real props.
  readonly example: Readonly<Record<string, ExampleValue>>;
};

// Declaration order is the alias order, so the scrambled names are stable across
// runs and reproducible from this list alone. WHICH components to document is an
// editorial choice — a compact surface, not all 52 — but every name here must
// exist in the shipped catalog, and every prop named below must be one the
// validator accepts.
export const SURFACE_COMPONENTS = [
  "Card",
  "Stack",
  "Grid",
  "Heading",
  "Text",
  "Badge",
  "Metric",
  "Chart",
  "Sparkline",
  "DataTable",
  "DiffViewer",
  "CodeBlock",
  "Terminal",
  "Markdown",
  "Callout",
  "Steps",
  "MermaidEditor",
  "Input",
  "Textarea",
  "Select",
  "Button",
] as const;

export type SurfaceComponentName = (typeof SURFACE_COMPONENTS)[number];

// The value lists that used to live in these sentences ("One of sm, md, lg,
// full.") are gone: they are printed from the schema instead, by
// notationOf() below. A sentence cannot lie about a value set it does not state.
export const COMPONENT_SURFACE = {
  Card: {
    purpose:
      "A titled surface that groups related content; also the grouping used for a set of form controls.",
    props: {
      title: "Title shown at the top of the surface.",
      description: "One line of supporting context under the title.",
      maxWidth: "How wide the surface may grow.",
      centered: "Centre the surface in its container.",
    },
    example: { title: "Latency", description: "p50/p95/p99 over the last 24h" },
  },

  Stack: {
    purpose: "Lays its children out in one direction with a uniform gap between them.",
    props: {
      direction: "The axis the children run along. Default vertical.",
      gap: "Space between children.",
      align: "Cross-axis alignment.",
      justify: "Main-axis distribution.",
    },
    example: { direction: "vertical", gap: "md" },
  },

  Grid: {
    purpose: "Lays its children out in a fixed number of equal columns.",
    props: {
      columns: "Number of equal columns.",
      gap: "Space between cells.",
    },
    example: { columns: 3, gap: "md" },
  },

  Heading: {
    purpose: "A section heading.",
    props: {
      text: "The heading itself.",
      level: "How deep the heading sits. Default h2.",
    },
    example: { level: "h2", text: "Error budget" },
  },

  Text: {
    purpose: "A single line or short run of prose.",
    props: {
      text: "The prose itself.",
      variant: "How the line is styled.",
    },
    example: { variant: "body", text: "Errors tripled after the 14:00 deploy." },
  },

  Badge: {
    purpose: "A small status pill.",
    props: {
      text: "The pill's label.",
      variant: "How the pill is styled.",
    },
    example: { variant: "destructive", text: "failing" },
  },

  Metric: {
    purpose: "One headline number with an optional change indicator, rendered as a stat tile.",
    props: {
      label: "Short caption above the value, e.g. 'p99 latency'.",
      value: "The headline number, preformatted with its units: '1.24s', '$48.2k', '99.98%'.",
      delta: "Change against the previous period, preformatted: '+12%', '-340ms'.",
      trend: "Direction arrow on the change.",
      tone: "Colour of the change. Use it when direction and sentiment disagree.",
      detail: "One quiet line of context below the value.",
    },
    example: {
      label: "p99 latency",
      value: "1.24s",
      delta: "-180ms",
      trend: "down",
      tone: "success",
    },
  },

  Chart: {
    purpose: "Plots a series of data points as a line, bar, area, pie, or scatter plot.",
    props: {
      kind: "The plot type.",
      data: "The rows to plot. Each row is an object whose keys include the x key and every y key.",
      x: "The key in each row used for the X axis label, or the slice name for a pie. Must exist in every row.",
      y: "The key, or array of keys, in each row to plot on the Y axis. An array gives several series.",
      title: "Title shown above the plot.",
      height: "Height in pixels. Default 320.",
    },
    example: {
      kind: "bar",
      title: "Errors per day",
      x: "day",
      y: "errors",
      data: [
        { day: "Mon", errors: 12 },
        { day: "Tue", errors: 31 },
      ],
    },
  },

  Sparkline: {
    purpose: "A tiny axis-less trend line, sized to sit inline beside other content.",
    props: {
      data: "The points, oldest first: plain numbers, or objects read via the y key.",
      y: "Key read from object points. Default 'value'.",
      width: "Pixel width. Default 120.",
      height: "Pixel height. Default 32.",
    },
    example: { data: [3, 4, 3.5, 5, 6], width: 120, height: 32 },
  },

  DataTable: {
    purpose: "A sortable, exportable table of typed columns and rows.",
    props: {
      caption: "Title shown in the table's header.",
      columns:
        "Column definitions in display order, each naming the row key it reads and the header it shows.",
      rows: "The rows. Each is an object keyed by the columns' key values.",
      exportable: "Show a CSV export button. Default true.",
    },
    example: {
      caption: "Slowest queries",
      columns: [
        { key: "query", header: "Query" },
        { key: "p99", header: "p99 (ms)", type: "number", align: "right" },
      ],
      rows: [{ query: "SELECT * FROM orders WHERE customer_id = $1", p99: 1240 }],
    },
  },

  DiffViewer: {
    purpose:
      "A side-by-side before/after comparison of one file's contents, with syntax highlighting.",
    props: {
      file: "Path of the file being compared. Sets the title and picks the highlighting.",
      before: "The ENTIRE original content of the file, verbatim.",
      after: "The ENTIRE modified content of the file, verbatim.",
      language: "Overrides the language inferred from the file's extension.",
      editableSide: "Which side the user may edit. Default after.",
    },
    example: {
      file: "src/cache.ts",
      before: "const ttlMs = 30_000;\nexport const cache = new Cache(ttlMs);",
      after: "const ttlMs = 300_000;\nexport const cache = new Cache(ttlMs);",
    },
  },

  CodeBlock: {
    purpose: "A syntax-highlighted, line-numbered block of source code.",
    props: {
      code: "The code to display, verbatim.",
      language: "Language for highlighting: 'typescript', 'python', 'sql', 'shell', …",
      title: "Header label, usually the file's path.",
      startLine: "The first displayed line number. Default 1.",
      highlightLines: "Displayed line numbers to emphasize, as an array of numbers.",
    },
    example: {
      title: "src/cache.ts",
      language: "typescript",
      code: "export const ttlMs = 300_000;",
    },
  },

  Terminal: {
    purpose: "A command and the output it produced, on a terminal surface.",
    props: {
      command: "The command exactly as run, without the shell prompt.",
      output: "The captured stdout and stderr, verbatim.",
      exitCode: "The process's exit code.",
      cwd: "The working directory the command ran in.",
    },
    example: {
      command: "bun test",
      cwd: "~/app",
      exitCode: 0,
      output: "21 pass, 0 fail (196ms)",
    },
  },

  Markdown: {
    purpose:
      "A long-form prose section — paragraphs, lists, tables, links — rendered from CommonMark source as one element.",
    props: {
      content: "CommonMark source. GFM tables, task lists, and links are supported.",
      maxHeight: "Maximum height in pixels; the content scrolls beyond it.",
    },
    example: {
      content: "### Why the misses happened\n\nThe TTL was **30s** while the sync runs every 5m.",
    },
  },

  Callout: {
    purpose: "An emphasized note, warning, or recommendation, set apart from the prose around it.",
    props: {
      tone: "What kind of note it is.",
      title: "Short bold lead-in.",
      body: "The note itself. Single newlines become line breaks; backtick spans render as inline code.",
    },
    example: {
      tone: "warning",
      title: "Lock contention risk",
      body: "The backfill takes an exclusive lock on `invoices`.",
    },
  },

  Steps: {
    purpose:
      "An ordered sequence of stages, each with its own status, rendered as a vertical timeline.",
    props: {
      items: "The stages in order, each with its title, optional detail, and status.",
    },
    example: {
      items: [
        { title: "Migration applied", detail: "0042_add_index.sql", status: "done" },
        { title: "Backfilling rows", status: "active" },
      ],
    },
  },

  MermaidEditor: {
    purpose:
      "A diagram rendered from mermaid source — flowcharts, sequence diagrams, state machines, ER diagrams.",
    props: {
      title: "Label shown above the diagram.",
      source: "The mermaid source, unfenced. Use <br/> for a line break inside a node's label.",
      showSource: "Whether to show the source pane beside the render. Set false for display-only.",
    },
    example: {
      title: "Request path",
      showSource: false,
      source: "flowchart LR\n  client --> api --> db",
    },
  },

  Input: {
    purpose: "A single-line form field.",
    props: {
      label: "Visible label for the field.",
      name: "The field's name, unique within its form.",
      type: "What the field accepts.",
      placeholder: "Hint shown while the field is empty.",
      value: "The field's value; usually a two-way binding.",
    },
    example: { label: "Email", name: "email", type: "email", placeholder: "you@example.com" },
  },

  Textarea: {
    purpose: "A multi-line form field.",
    props: {
      label: "Visible label for the field.",
      name: "The field's name, unique within its form.",
      placeholder: "Hint shown while the field is empty.",
      rows: "Visible height, in rows.",
      value: "The field's value; usually a two-way binding.",
    },
    example: { label: "Notes", name: "notes", rows: 4 },
  },

  Select: {
    purpose: "A form field offering a fixed list of choices.",
    props: {
      label: "Visible label for the field.",
      name: "The field's name, unique within its form.",
      options: "The choices offered.",
      placeholder: "Hint shown while nothing is chosen.",
      value: "The chosen value; usually a two-way binding.",
    },
    example: { label: "Environment", name: "env", options: ["prod", "staging"] },
  },

  Button: {
    purpose: "A pressable button.",
    props: {
      label: "The button's text.",
      variant: "How the button is styled.",
      disabled: "When true, the button cannot be pressed.",
    },
    example: { variant: "primary", label: "Submit" },
  },
} as const satisfies Readonly<Record<SurfaceComponentName, ComponentSpec>>;

// ---- Read off the product ---------------------------------------------------
//
// The four facts a prompt cannot be allowed to invent. Each is one lookup into
// the tables the daemon itself validates and compiles against.

export function isRequiredProp(component: SurfaceComponentName, prop: string): boolean {
  return ComponentContracts[component]?.requiredProps.includes(prop) ?? false;
}

export function acceptsChildrenIn(component: DocumentedComponentName): boolean {
  if (isStandaloneReference(component)) return false;
  return acceptsChildren(component);
}

// A prop's accepted values, in the notation the shipped catalog prompt prints —
// "line|bar|area|pie|scatter", "num", "obj[]". Walked off the widened schema the
// validator parses against, so the prompt cannot advertise a value the daemon
// rejects, nor withhold one it takes.
export function notationOf(component: SurfaceComponentName, prop: string): string {
  return propTypeNotation(component, prop);
}

export function eventsOf(component: SurfaceComponentName): readonly string[] {
  return ComponentContracts[component]?.events ?? [];
}

// ---- The fidelity ladder ----------------------------------------------------
//
// The reference-taking surface: the rung where the model NAMES a file and the
// daemon fetches the bytes. Two shapes, because the shipped dialect has two:
//
//   - Standalone: an authoring tag (<GitDiff>, <LogStream>) the compiler lowers
//     into a catalog component carrying a reference expression, whose heavy props
//     the daemon fills at push time. Its attribute grammar is
//     REFERENCE_TAG_GRAMMAR — the same table the compiler validates against.
//   - Layered: a reference attribute on a component that already exists
//     (DataTable src=, CodeBlock file=). Same component either way; the model
//     simply names a file instead of pasting one.
//
// The sharpest edge is the diff. DiffViewer's real schema requires `before` AND
// `after` as strings, so a low-fidelity arm must paste the entire file TWICE. A
// high-fidelity arm names the file and a base revision. That is the whole thesis
// in one component.

export const ReferenceKind = {
  Layered: "layered",
  Standalone: "standalone",
} as const;

export type ReferenceKind = (typeof ReferenceKind)[keyof typeof ReferenceKind];

// Rendered with the (possibly renamed) hydrated prop names spliced in, so the
// sentence never hardcodes an identifier.
export const HYDRATED_PROPS_PLACEHOLDER = "{hydrated}";

// Rendered with the shipped bucket grammar spliced in. The sentence that named
// hour|day|week is exactly the sentence that cost us the log scenario: it is now
// impossible to write, because the accepted buckets come from the parser.
export const BUCKET_SYNTAX_PLACEHOLDER = "{buckets}";

// New tags the ladder adds, in the order the compiler knows them. Aliased after
// the surface components, so the scrambled names of everything else are
// unaffected by their presence.
export const STANDALONE_REFERENCE_COMPONENTS = ["GitDiff", "LogStream"] as const;

export type StandaloneReferenceName = (typeof STANDALONE_REFERENCE_COMPONENTS)[number];

// Existing components that gain reference attributes at high fidelity. An
// editorial subset of the components the product lets take a reference — these
// two are the ones the ladder scenarios need — but each must genuinely be
// reference-capable, and every attribute below must be one the compiler consumes.
export const LAYERED_REFERENCE_COMPONENTS = ["DataTable", "CodeBlock"] as const;

export type LayeredReferenceName = (typeof LAYERED_REFERENCE_COMPONENTS)[number];

// Everything a prompt can name.
export type DocumentedComponentName = SurfaceComponentName | StandaloneReferenceName;

type ReferenceCommon = {
  // Prose only. The attribute NAMES come from the product (referenceAttrsOf).
  readonly attrs: Readonly<Record<string, string>>;
  readonly example: Readonly<Record<string, ExampleValue>>;
};

export type LayeredReferenceSpec = ReferenceCommon & {
  readonly kind: typeof ReferenceKind.Layered;
  readonly hydrationNote: string;
};

export type StandaloneReferenceSpec = ReferenceCommon & {
  readonly kind: typeof ReferenceKind.Standalone;
  readonly purpose: string;
};

export type ReferenceSpec = LayeredReferenceSpec | StandaloneReferenceSpec;

export const REFERENCE_SURFACE = {
  GitDiff: {
    kind: ReferenceKind.Standalone,
    purpose:
      "A side-by-side comparison of one file before and after a git revision. The daemon runs the diff and fills in both sides.",
    attrs: {
      file: "Path of the file to compare.",
      base: "The revision to compare against, e.g. 'HEAD~1'. Defaults to 'HEAD'.",
      staged: "Compare against the staged copy rather than a revision.",
      watch: "Keep the view updating as the file changes.",
      language: "Overrides the language inferred from the file's extension.",
      editableSide: "Which side the user may edit.",
    },
    example: { file: "src/server.ts", base: "HEAD~1" },
  },

  LogStream: {
    kind: ReferenceKind.Standalone,
    purpose:
      "Asks a question of a log file and plots the answer. The daemon reads every line, keeps the ones that match, buckets them over time, aggregates them, and fills in the points — so you never open the log.",
    attrs: {
      file: "Path of the log file to read.",
      groupBy:
        `The time bucket the lines are grouped into: ${BUCKET_SYNTAX_PLACEHOLDER}. Becomes the X axis. Without it this is a live tail, not a chart.`,
      match: "Keep only the lines matching this regular expression, e.g. 'ERROR'.",
      pattern: "A regular expression with named groups, capturing fields out of each line.",
      parser: "How a line is read: as JSON, by the pattern above, or as a bare number.",
      series: "A captured field to split into one line per distinct value.",
      metric:
        "The value computed per bucket: 'count', 'rate', or an aggregation over a captured numeric field ('p95:duration_ms', 'avg:latency'). Default 'count'.",
      watch: "Keep re-reading and re-aggregating the file as it grows.",
      kind: "The plot type.",
      title: "Title shown above the plot.",
      height: "Height in pixels.",
    },
    example: { file: "logs/app.log", match: "ERROR", groupBy: "10m" },
  },

  DataTable: {
    kind: ReferenceKind.Layered,
    attrs: {
      src: "Path to a CSV file to read the table from.",
    },
    hydrationNote:
      "The daemon reads the file, infers the columns from its header, and fills {hydrated} — omit them.",
    example: { caption: "Benchmark results", src: "data/results.csv" },
  },

  CodeBlock: {
    kind: ReferenceKind.Layered,
    attrs: {
      file: "Path to the source file to read.",
      lines: "The line range to show, e.g. '40-80'. Omit for the whole file.",
    },
    hydrationNote: "The daemon reads the file, keeps the requested lines, and fills {hydrated} — omit them.",
    example: { file: "src/server.ts", lines: "40-80", language: "typescript" },
  },
} as const satisfies Readonly<
  Record<StandaloneReferenceName, StandaloneReferenceSpec> &
    Record<LayeredReferenceName, LayeredReferenceSpec>
>;

// The bucket grammar, spliced into the sentence that describes it. One string,
// exported by the parser that enforces it.
export const LOG_BUCKET_SYNTAX = BUCKET_INTERVAL_SYNTAX;

// The attribute names a reference tag takes, straight off the compiler's own
// table. The prose above must name exactly these — vocabulary.test.ts enforces
// it in BOTH directions, so an attribute the product gains and the eval does not
// document is a failing test, not a silently unusable feature.
export function standaloneReferenceAttrsOf(component: StandaloneReferenceName): readonly string[] {
  return referenceTagAttrNames(component satisfies ReferenceTagName);
}

// The sentence that describes one reference attribute. The attribute NAMES come
// from the compiler (above); this is the prose the prompt puts against each of
// them, and vocabulary.test.ts requires one for every name the compiler knows.
export function standaloneAttrMeaningOf(
  component: StandaloneReferenceName,
  attr: string,
): string {
  const attrs: Readonly<Record<string, string>> = REFERENCE_SURFACE[component].attrs;
  return attrs[attr] ?? "";
}

// The grammar table marks an attribute `null` when it is a real prop of the
// component the tag compiles to — so its accepted values come from that
// component's schema, and are never restated. Anything else is a reference-only
// attribute (a path, a flag, a duration) whose meaning its sentence carries.
export function takesCompiledPropType(
  component: StandaloneReferenceName,
  attr: string,
): boolean {
  const attrs: Readonly<Record<string, unknown>> = REFERENCE_TAG_GRAMMAR[component].attrs;
  return attrs[attr] === null;
}

// What the daemon fills once the reference resolves. The model is told to omit
// exactly these, and the validator is told not to report exactly these missing.
export function hydratedPropsOf(component: DocumentedComponentName): readonly string[] {
  if (isStandaloneReference(component)) return REFERENCE_TAG_GRAMMAR[component].supplies;
  if (component === "DataTable") return ["rows", "columns"];
  if (component === "CodeBlock") return ["code"];
  return [];
}

// The catalog component a standalone reference tag compiles to. Read off the
// compiler's table, because "GitDiff becomes a DiffViewer" is the compiler's
// decision and no one else's.
export function compilesToOf(component: StandaloneReferenceName): string {
  return REFERENCE_TAG_GRAMMAR[component].compilesTo;
}

export function layeredReferenceFor(component: SurfaceComponentName): LayeredReferenceSpec | null {
  const isLayered = (LAYERED_REFERENCE_COMPONENTS as readonly string[]).includes(component);
  if (!isLayered) return null;
  return REFERENCE_SURFACE[component as LayeredReferenceName];
}

export function standaloneReferenceFor(name: StandaloneReferenceName): StandaloneReferenceSpec {
  return REFERENCE_SURFACE[name];
}

export function isStandaloneReference(
  component: DocumentedComponentName,
): component is StandaloneReferenceName {
  return (STANDALONE_REFERENCE_COMPONENTS as readonly string[]).includes(component);
}

// ---- Semantic HTML shortcuts (markup notation only) -------------------------
//
// The markup compiler maps a handful of HTML tags straight onto catalog
// components. They are part of the dialect the compiler ACTUALLY implements, and
// they are the most familiar tokens the format has — so they are part of the
// vocabulary too, and the scrambled arm gets opaque ones. Leaving them real in
// the scrambled prompt would hand that arm a freebie and shrink the very effect
// we are trying to measure.
//
// Only tags whose meaning stands alone are documented; the compiler knows more.
// Every one below must be a tag the compiler really maps — semanticRuleFor()
// answers for it, and the test asks.

export const STRUCTURAL_TAGS = ["section", "h1", "h2", "h3", "p", "form"] as const;

export type StructuralTagName = (typeof STRUCTURAL_TAGS)[number];

export const STRUCTURAL_TAG_SURFACE = {
  section: "Wraps its children in a vertical stack.",
  h1: "A level-1 heading. Its content is the heading.",
  h2: "A level-2 heading. Its content is the heading.",
  h3: "A level-3 heading. Its content is the heading.",
  p: "A paragraph of prose. Its content is the prose.",
  form: "Wraps a set of form controls in a titled surface.",
} as const satisfies Readonly<Record<StructuralTagName, string>>;

export function isCompiledTag(tag: string): boolean {
  return semanticRuleFor(tag) !== null;
}

// ---- Vocabulary -------------------------------------------------------------

export const VocabularyId = {
  Real: "real",
  Scrambled: "scrambled",
} as const;

export type VocabularyId = (typeof VocabularyId)[keyof typeof VocabularyId];

export type NameMap = Readonly<Record<string, string>>;

// The harness un-scrambles a model's output with this before compiling it.
//
// THE INVERSE MAP CANNOT BE FLAT, AND THIS IS NOT A DETAIL. Prop aliases are
// numbered per COMPONENT ("a1" is the first prop of whichever component it
// appears on), so "a1" on Chart and "a1" on DataTable are DIFFERENT real props.
// A flat alias→name map would let one overwrite the other, the scrambled arm's
// markup would fail to compile, and the results would show "the real vocabulary
// massively beats a scrambled one" — a pure harness artifact, and precisely the
// answer our own thesis wants to hear. So the component is resolved FIRST, and
// only then are its props looked up inside that component's own namespace.
export type VocabularyInverse = {
  readonly componentNameByAlias: NameMap;
  // Keyed by the REAL component name: resolve the component first, then its props.
  readonly propNameByAliasByComponent: Readonly<Record<string, NameMap>>;
  readonly tagNameByAlias: NameMap;
};

export type Vocabulary = {
  readonly id: VocabularyId;
  readonly componentName: (component: DocumentedComponentName) => string;
  readonly propName: (component: DocumentedComponentName, prop: string) => string;
  readonly tagName: (tag: StructuralTagName) => string;
  readonly inverse: VocabularyInverse;
};

// Every component a prompt can name, in alias order.
export const DOCUMENTED_COMPONENTS: readonly DocumentedComponentName[] = [
  ...SURFACE_COMPONENTS,
  ...STANDALONE_REFERENCE_COMPONENTS,
];

// A component's props as the prompt documents them: its real catalog props, then
// any reference attributes the ladder layers on. One continuous namespace, so an
// alias is unique within the component.
//
// The standalone tags' names come from the COMPILER's table rather than from the
// prose, so the scramble covers exactly the attributes the compiler accepts —
// never a stale hand-kept subset.
export function documentedPropNamesOf(component: DocumentedComponentName): readonly string[] {
  if (isStandaloneReference(component)) return standaloneReferenceAttrsOf(component);

  const surfaceProps = Object.keys(COMPONENT_SURFACE[component].props);
  const layered = layeredReferenceFor(component);
  if (layered === null) return surfaceProps;
  return [...surfaceProps, ...Object.keys(layered.attrs)];
}

type AliasScheme = {
  readonly componentAlias: (component: DocumentedComponentName, index: number) => string;
  readonly propAlias: (component: DocumentedComponentName, prop: string, index: number) => string;
  readonly tagAlias: (tag: StructuralTagName, index: number) => string;
};

const COMPONENT_ALIAS_PREFIX = "C";
const COMPONENT_ALIAS_DIGITS = 2;
const PROP_ALIAS_PREFIX = "a";
const TAG_ALIAS_PREFIX = "t";
const TAG_ALIAS_DIGITS = 2;
const FIRST_ORDINAL = 1;

function paddedOrdinal(index: number, digits: number): string {
  return String(index + FIRST_ORDINAL).padStart(digits, "0");
}

const IDENTITY_ALIASES: AliasScheme = {
  componentAlias: (component) => component,
  propAlias: (_component, prop) => prop,
  tagAlias: (tag) => tag,
};

// THE ABLATION'S TREATMENT, and the whole of it. It is a TRANSFORMATION over the
// derived catalog above — not a second catalog — so the scrambled arm tracks the
// product exactly as closely as the real arm does. A prop the daemon gains is a
// prop the scrambled arm can name, on the next build, with no edit here.
const OPAQUE_ALIASES: AliasScheme = {
  componentAlias: (_component, index) =>
    `${COMPONENT_ALIAS_PREFIX}${paddedOrdinal(index, COMPONENT_ALIAS_DIGITS)}`,
  propAlias: (_component, _prop, index) => `${PROP_ALIAS_PREFIX}${index + FIRST_ORDINAL}`,
  tagAlias: (_tag, index) => `${TAG_ALIAS_PREFIX}${paddedOrdinal(index, TAG_ALIAS_DIGITS)}`,
};

type VocabularyTables = {
  readonly componentAliasByName: NameMap;
  readonly propAliasByNameByComponent: Readonly<Record<string, NameMap>>;
  readonly tagAliasByName: NameMap;
};

function buildTables(scheme: AliasScheme): VocabularyTables {
  const componentAliasByName: Record<string, string> = {};
  const propAliasByNameByComponent: Record<string, Record<string, string>> = {};

  DOCUMENTED_COMPONENTS.forEach((component, componentIndex) => {
    componentAliasByName[component] = scheme.componentAlias(component, componentIndex);
    const propAliasByName: Record<string, string> = {};
    documentedPropNamesOf(component).forEach((prop, propIndex) => {
      propAliasByName[prop] = scheme.propAlias(component, prop, propIndex);
    });
    propAliasByNameByComponent[component] = propAliasByName;
  });

  const tagAliasByName: Record<string, string> = {};
  STRUCTURAL_TAGS.forEach((tag, tagIndex) => {
    tagAliasByName[tag] = scheme.tagAlias(tag, tagIndex);
  });

  return { componentAliasByName, propAliasByNameByComponent, tagAliasByName };
}

function invertNameMap(forward: NameMap): NameMap {
  const inverted: Record<string, string> = {};
  for (const [name, alias] of Object.entries(forward)) {
    inverted[alias] = name;
  }
  return inverted;
}

function buildInverse(tables: VocabularyTables): VocabularyInverse {
  const propNameByAliasByComponent: Record<string, NameMap> = {};
  for (const [component, propAliasByName] of Object.entries(tables.propAliasByNameByComponent)) {
    propNameByAliasByComponent[component] = invertNameMap(propAliasByName);
  }
  return {
    componentNameByAlias: invertNameMap(tables.componentAliasByName),
    propNameByAliasByComponent,
    tagNameByAlias: invertNameMap(tables.tagAliasByName),
  };
}

function buildVocabulary(id: VocabularyId, scheme: AliasScheme): Vocabulary {
  const tables = buildTables(scheme);
  return {
    id,
    componentName: (component) => {
      const alias = tables.componentAliasByName[component];
      if (alias === undefined) throw new Error(`vocabulary: unknown component "${component}"`);
      return alias;
    },
    propName: (component, prop) => {
      const alias = tables.propAliasByNameByComponent[component]?.[prop];
      if (alias === undefined) {
        throw new Error(`vocabulary: unknown prop "${prop}" on component "${component}"`);
      }
      return alias;
    },
    tagName: (tag) => {
      const alias = tables.tagAliasByName[tag];
      if (alias === undefined) throw new Error(`vocabulary: unknown tag "${tag}"`);
      return alias;
    },
    inverse: buildInverse(tables),
  };
}

export const REAL_VOCABULARY: Vocabulary = buildVocabulary(VocabularyId.Real, IDENTITY_ALIASES);

export const SCRAMBLED_VOCABULARY: Vocabulary = buildVocabulary(
  VocabularyId.Scrambled,
  OPAQUE_ALIASES,
);
