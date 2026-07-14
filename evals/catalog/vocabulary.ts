// THE ABLATION'S INTEGRITY LIVES HERE.
//
// One table describes the component surface. Every system prompt in the eval —
// real or scrambled, markup or json or terse-json — is rendered from it, so no
// arm can quietly drift into a better or worse description than another.
//
// The renaming below is the experiment's treatment. REAL_VOCABULARY is the
// identity; SCRAMBLED_VOCABULARY swaps every identifier for an opaque token and
// changes NOTHING else. Every `purpose` and `meaning` sentence is written once
// and reused word-for-word by both, because the question is "is the token
// familiar", not "does the model know what a chart is". A scrambled prompt that
// also degraded the semantics would be a strawman, and the result would be
// worthless.
//
// Two invariants the tests ENFORCE rather than merely intend:
//   - Every prop named on a real catalog component is a real catalog prop, checked
//     against knownPropNamesFor(). That is what stops us strawmanning our OWN
//     format — a low-fidelity prompt that documented props the compiler rejects
//     would hand the parchment arms a loss they did not earn.
//   - No `purpose`/`meaning` sentence names another component. If one did, the
//     scrambled prompt would leak a familiar identifier and contaminate the
//     ablation.
//
// Held fixed across both vocabularies (deliberately NOT scrambled): the grammar
// keywords — the markup sugar (bind/intent/submit/required), the spec's
// structural keys (root/elements/type/props/children), the terse keys
// (r/e/t/p/c) — and every prop VALUE (kind="bar" stays "bar"). Those are the
// notation, not the vocabulary. Scrambling them would answer a different
// question than the one asked.

// ---- Shape ------------------------------------------------------------------

export type PropSpec = {
  readonly meaning: string;
  readonly required: boolean;
};

// A prop value as it appears in an example. Serialized per notation: quoted as an
// attribute for markup, emitted as JSON for the spec notations.
export type ExampleValue =
  | string
  | number
  | boolean
  | readonly ExampleValue[]
  | { readonly [key: string]: ExampleValue };

export type ComponentSpec = {
  readonly purpose: string;
  readonly acceptsChildren: boolean;
  readonly props: Readonly<Record<string, PropSpec>>;
  // The inline-content example. Every prop it names is a real catalog prop.
  readonly example: Readonly<Record<string, ExampleValue>>;
};

// Declaration order is the alias order, so the scrambled names are stable across
// runs and reproducible from this list alone.
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

export const COMPONENT_SURFACE = {
  Card: {
    purpose:
      "A titled surface that groups related content; also the grouping used for a set of form controls.",
    acceptsChildren: true,
    props: {
      title: { meaning: "Title shown at the top of the surface.", required: false },
      description: {
        meaning: "One line of supporting context under the title.",
        required: false,
      },
      maxWidth: { meaning: "One of sm, md, lg, full.", required: false },
      centered: { meaning: "Centre the surface in its container.", required: false },
    },
    example: { title: "Latency", description: "p50/p95/p99 over the last 24h" },
  },

  Stack: {
    purpose: "Lays its children out in one direction with a uniform gap between them.",
    acceptsChildren: true,
    props: {
      direction: { meaning: "One of vertical, horizontal. Default vertical.", required: false },
      gap: { meaning: "Space between children: one of none, sm, md, lg, xl.", required: false },
      align: {
        meaning: "Cross-axis alignment: one of start, center, end, stretch.",
        required: false,
      },
      justify: {
        meaning: "Main-axis distribution: one of start, center, end, between, around.",
        required: false,
      },
    },
    example: { direction: "vertical", gap: "md" },
  },

  Grid: {
    purpose: "Lays its children out in a fixed number of equal columns.",
    acceptsChildren: true,
    props: {
      columns: { meaning: "Number of equal columns.", required: false },
      gap: { meaning: "Space between cells: one of sm, md, lg, xl.", required: false },
    },
    example: { columns: 3, gap: "md" },
  },

  Heading: {
    purpose: "A section heading.",
    acceptsChildren: false,
    props: {
      text: { meaning: "The heading itself.", required: true },
      level: { meaning: "One of h1, h2, h3, h4. Default h2.", required: false },
    },
    example: { level: "h2", text: "Error budget" },
  },

  Text: {
    purpose: "A single line or short run of prose.",
    acceptsChildren: false,
    props: {
      text: { meaning: "The prose itself.", required: true },
      variant: { meaning: "One of body, caption, muted, lead, code.", required: false },
    },
    example: { variant: "body", text: "Errors tripled after the 14:00 deploy." },
  },

  Badge: {
    purpose: "A small status pill.",
    acceptsChildren: false,
    props: {
      text: { meaning: "The pill's label.", required: true },
      variant: { meaning: "One of default, secondary, destructive, outline.", required: false },
    },
    example: { variant: "destructive", text: "failing" },
  },

  Metric: {
    purpose: "One headline number with an optional change indicator, rendered as a stat tile.",
    acceptsChildren: false,
    props: {
      label: { meaning: "Short caption above the value, e.g. 'p99 latency'.", required: true },
      value: {
        meaning: "The headline number, preformatted with its units: '1.24s', '$48.2k', '99.98%'.",
        required: true,
      },
      delta: {
        meaning: "Change against the previous period, preformatted: '+12%', '-340ms'.",
        required: false,
      },
      trend: { meaning: "Direction arrow on the change: one of up, down, flat.", required: false },
      tone: {
        meaning:
          "Colour of the change: one of neutral, success, warning, danger. Use it when direction and sentiment disagree.",
        required: false,
      },
      detail: { meaning: "One quiet line of context below the value.", required: false },
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
    acceptsChildren: false,
    props: {
      kind: { meaning: "The plot type: one of line, bar, area, pie, scatter.", required: true },
      data: {
        meaning:
          "The rows to plot. Each row is an object whose keys include the x key and every y key.",
        required: true,
      },
      x: {
        meaning:
          "The key in each row used for the X axis label, or the slice name for a pie. Must exist in every row.",
        required: true,
      },
      y: {
        meaning:
          "The key, or array of keys, in each row to plot on the Y axis. An array gives several series.",
        required: true,
      },
      title: { meaning: "Title shown above the plot.", required: false },
      height: { meaning: "Height in pixels. Default 320.", required: false },
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
    acceptsChildren: false,
    props: {
      data: {
        meaning: "The points, oldest first: plain numbers, or objects read via the y key.",
        required: true,
      },
      y: { meaning: "Key read from object points. Default 'value'.", required: false },
      width: { meaning: "Pixel width. Default 120.", required: false },
      height: { meaning: "Pixel height. Default 32.", required: false },
    },
    example: { data: [3, 4, 3.5, 5, 6], width: 120, height: 32 },
  },

  DataTable: {
    purpose: "A sortable, exportable table of typed columns and rows.",
    acceptsChildren: false,
    props: {
      caption: { meaning: "Title shown in the table's header.", required: false },
      columns: {
        meaning:
          "Column definitions in display order. Each is {key, header, type?, align?}, where type is one of string, number, date, boolean and align is one of left, right, center.",
        required: true,
      },
      rows: {
        meaning: "The rows. Each is an object keyed by the columns' key values.",
        required: true,
      },
      exportable: { meaning: "Show a CSV export button. Default true.", required: false },
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
    acceptsChildren: false,
    props: {
      file: {
        meaning: "Path of the file being compared. Sets the title and picks the highlighting.",
        required: true,
      },
      before: { meaning: "The ENTIRE original content of the file, verbatim.", required: true },
      after: { meaning: "The ENTIRE modified content of the file, verbatim.", required: true },
      language: {
        meaning: "Overrides the language inferred from the file's extension.",
        required: false,
      },
      editableSide: {
        meaning: "Which side the user may edit: one of after, both, none. Default after.",
        required: false,
      },
    },
    example: {
      file: "src/cache.ts",
      before: "const ttlMs = 30_000;\nexport const cache = new Cache(ttlMs);",
      after: "const ttlMs = 300_000;\nexport const cache = new Cache(ttlMs);",
    },
  },

  CodeBlock: {
    purpose: "A syntax-highlighted, line-numbered block of source code.",
    acceptsChildren: false,
    props: {
      code: { meaning: "The code to display, verbatim.", required: true },
      language: {
        meaning: "Language for highlighting: 'typescript', 'python', 'sql', 'shell', …",
        required: false,
      },
      title: { meaning: "Header label, usually the file's path.", required: false },
      startLine: { meaning: "The first displayed line number. Default 1.", required: false },
      highlightLines: {
        meaning: "Displayed line numbers to emphasize, as an array of numbers.",
        required: false,
      },
    },
    example: {
      title: "src/cache.ts",
      language: "typescript",
      code: "export const ttlMs = 300_000;",
    },
  },

  Terminal: {
    purpose: "A command and the output it produced, on a terminal surface.",
    acceptsChildren: false,
    props: {
      command: { meaning: "The command exactly as run, without the shell prompt.", required: true },
      output: { meaning: "The captured stdout and stderr, verbatim.", required: true },
      exitCode: { meaning: "The process's exit code.", required: false },
      cwd: { meaning: "The working directory the command ran in.", required: false },
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
    acceptsChildren: false,
    props: {
      content: {
        meaning: "CommonMark source. GFM tables, task lists, and links are supported.",
        required: true,
      },
      maxHeight: {
        meaning: "Maximum height in pixels; the content scrolls beyond it.",
        required: false,
      },
    },
    example: {
      content: "### Why the misses happened\n\nThe TTL was **30s** while the sync runs every 5m.",
    },
  },

  Callout: {
    purpose: "An emphasized note, warning, or recommendation, set apart from the prose around it.",
    acceptsChildren: false,
    props: {
      tone: { meaning: "One of info, success, warning, danger, tip.", required: true },
      title: { meaning: "Short bold lead-in.", required: false },
      body: {
        meaning:
          "The note itself. Single newlines become line breaks; backtick spans render as inline code.",
        required: true,
      },
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
    acceptsChildren: false,
    props: {
      items: {
        meaning:
          "The stages in order. Each is {title, detail?, status?}, where status is one of done, active, pending, error.",
        required: true,
      },
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
    acceptsChildren: false,
    props: {
      title: { meaning: "Label shown above the diagram.", required: false },
      source: {
        meaning: "The mermaid source, unfenced. Use <br/> for a line break inside a node's label.",
        required: true,
      },
      showSource: {
        meaning: "Whether to show the source pane beside the render. Set false for display-only.",
        required: false,
      },
    },
    example: {
      title: "Request path",
      showSource: false,
      source: "flowchart LR\n  client --> api --> db",
    },
  },

  Input: {
    purpose: "A single-line form field.",
    acceptsChildren: false,
    props: {
      label: { meaning: "Visible label for the field.", required: true },
      name: { meaning: "The field's name, unique within its form.", required: true },
      type: { meaning: "One of text, email, password, number.", required: false },
      placeholder: { meaning: "Hint shown while the field is empty.", required: false },
      value: { meaning: "The field's value; usually a two-way binding.", required: false },
    },
    example: { label: "Email", name: "email", type: "email", placeholder: "you@example.com" },
  },

  Textarea: {
    purpose: "A multi-line form field.",
    acceptsChildren: false,
    props: {
      label: { meaning: "Visible label for the field.", required: true },
      name: { meaning: "The field's name, unique within its form.", required: true },
      placeholder: { meaning: "Hint shown while the field is empty.", required: false },
      rows: { meaning: "Visible height, in rows.", required: false },
      value: { meaning: "The field's value; usually a two-way binding.", required: false },
    },
    example: { label: "Notes", name: "notes", rows: 4 },
  },

  Select: {
    purpose: "A form field offering a fixed list of choices.",
    acceptsChildren: false,
    props: {
      label: { meaning: "Visible label for the field.", required: true },
      name: { meaning: "The field's name, unique within its form.", required: true },
      options: { meaning: "The choices offered, as an array of strings.", required: true },
      placeholder: { meaning: "Hint shown while nothing is chosen.", required: false },
      value: { meaning: "The chosen value; usually a two-way binding.", required: false },
    },
    example: { label: "Environment", name: "env", options: ["prod", "staging"] },
  },

  Button: {
    purpose: "A pressable button.",
    acceptsChildren: false,
    props: {
      label: { meaning: "The button's text.", required: true },
      variant: { meaning: "One of primary, secondary, danger.", required: false },
      disabled: { meaning: "When true, the button cannot be pressed.", required: false },
    },
    example: { variant: "primary", label: "Submit" },
  },
} as const satisfies Readonly<Record<SurfaceComponentName, ComponentSpec>>;

// ---- The fidelity ladder ----------------------------------------------------
//
// The reference-taking surface. None of it exists in main's catalog: the
// hydration engine is a sibling's unmerged branch, and the eval's own hydrator
// resolves these away before anything is compiled. That is sanctioned, because
// what we are measuring is what the MODEL had to emit — not what the daemon
// later did with it.
//
// Two shapes, because the real grammar has two:
//   - Standalone: a NEW authoring component (GitDiff, LogStream) that compiles to
//     an existing catalog component with its heavy props filled from disk.
//   - Layered: extra reference props on a component that already exists
//     (DataTable.src, CodeBlock.file) — the model uses the same component either
//     way and simply names a file instead of pasting one.
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

export const HYDRATED_PROPS_PLACEHOLDER = "{hydrated}";

type ReferenceCommon = {
  // The real catalog component the hydrator produces.
  readonly compilesTo: SurfaceComponentName;
  readonly props: Readonly<Record<string, PropSpec>>;
  // Real props on `compilesTo` that the daemon fills from the reference. The
  // hydrator resolves exactly these; the prompt tells the model to omit them.
  readonly hydratedProps: readonly string[];
  readonly example: Readonly<Record<string, ExampleValue>>;
};

export type LayeredReferenceSpec = ReferenceCommon & {
  readonly kind: typeof ReferenceKind.Layered;
  // Rendered with HYDRATED_PROPS_PLACEHOLDER replaced by the (possibly renamed)
  // hydrated prop names, so this sentence never hardcodes an identifier.
  readonly hydrationNote: string;
};

export type StandaloneReferenceSpec = ReferenceCommon & {
  readonly kind: typeof ReferenceKind.Standalone;
  readonly purpose: string;
};

export type ReferenceSpec = LayeredReferenceSpec | StandaloneReferenceSpec;

// New components the ladder adds. Aliased after the surface components, so the
// scrambled names of everything else are unaffected by their presence.
export const STANDALONE_REFERENCE_COMPONENTS = ["GitDiff", "LogStream"] as const;

export type StandaloneReferenceName = (typeof STANDALONE_REFERENCE_COMPONENTS)[number];

// Existing components that gain reference props at high fidelity.
export const LAYERED_REFERENCE_COMPONENTS = ["DataTable", "CodeBlock"] as const;

export type LayeredReferenceName = (typeof LAYERED_REFERENCE_COMPONENTS)[number];

// Everything a prompt can name.
export type DocumentedComponentName = SurfaceComponentName | StandaloneReferenceName;

export const REFERENCE_SURFACE = {
  GitDiff: {
    kind: ReferenceKind.Standalone,
    compilesTo: "DiffViewer",
    purpose:
      "A side-by-side comparison of one file before and after a git revision. The daemon runs the diff and fills in both sides.",
    props: {
      file: { meaning: "Path of the file to compare.", required: true },
      base: {
        meaning: "The revision to compare against, e.g. 'HEAD~1'. Defaults to 'HEAD'.",
        required: false,
      },
    },
    hydratedProps: ["before", "after"],
    example: { file: "src/server.ts", base: "HEAD~1" },
  },

  LogStream: {
    kind: ReferenceKind.Standalone,
    compilesTo: "Chart",
    purpose:
      "Plots a log file over time. The daemon reads the file, aggregates it, and fills in the points.",
    props: {
      file: { meaning: "Path of the log file to read.", required: true },
      watch: {
        meaning: "Keep the view updating as the file grows. Default false.",
        required: false,
      },
      // NOT in the peer-supplied grammar. Added deliberately and flagged: without
      // a way to state the aggregation, the model cannot say WHICH question the
      // plot answers ("errors per hour"), and a daemon silently guessing the
      // analysis would credit the high-fidelity arm for output tokens it never
      // had to spend. Optional, so it costs nothing when the default is right.
      groupBy: {
        meaning:
          "The field the lines are grouped by, or a time bucket — one of hour, day, week. Becomes the X axis.",
        required: false,
      },
      metric: {
        meaning:
          "The value computed per group: 'count', or 'sum:<field>' / 'avg:<field>' / 'max:<field>'. Becomes the Y axis.",
        required: false,
      },
    },
    hydratedProps: ["kind", "data", "x", "y"],
    example: { file: "logs/app.log", groupBy: "hour", metric: "count" },
  },

  DataTable: {
    kind: ReferenceKind.Layered,
    compilesTo: "DataTable",
    props: {
      src: { meaning: "Path to a CSV or JSON file to read the table from.", required: true },
    },
    hydratedProps: ["columns", "rows"],
    hydrationNote:
      "The daemon reads the file, infers the columns from its header, and fills {hydrated} — omit them.",
    example: { caption: "Benchmark results", src: "data/results.csv" },
  },

  CodeBlock: {
    kind: ReferenceKind.Layered,
    compilesTo: "CodeBlock",
    props: {
      file: { meaning: "Path to the source file to read.", required: true },
      lines: {
        meaning: "The line range to show, e.g. '40-80'. Omit for the whole file.",
        required: false,
      },
    },
    hydratedProps: ["code"],
    hydrationNote:
      "The daemon reads the file, keeps the requested lines, and fills {hydrated} — omit them.",
    example: { file: "src/server.ts", lines: "40-80", language: "typescript" },
  },
} as const satisfies Readonly<
  Record<StandaloneReferenceName, StandaloneReferenceSpec> &
    Record<LayeredReferenceName, LayeredReferenceSpec>
>;

// The exemption, stated out loud. These names intentionally do NOT exist in
// main's catalog — the hydrator resolves every one of them before compiling — so
// the anti-strawman test skips exactly these and nothing else. Layered props are
// qualified by component because `file` is a REAL prop on DiffViewer while being
// a reference-only prop on CodeBlock; an unqualified list would silently excuse
// the wrong one.
export const REFERENCE_ONLY_NAMES = [
  "GitDiff",
  "LogStream",
  "DataTable.src",
  "CodeBlock.file",
  "CodeBlock.lines",
] as const;

export function layeredReferenceFor(component: SurfaceComponentName): LayeredReferenceSpec | null {
  const isLayered = (LAYERED_REFERENCE_COMPONENTS as readonly string[]).includes(component);
  if (!isLayered) return null;
  return REFERENCE_SURFACE[component as LayeredReferenceName];
}

export function standaloneReferenceFor(name: StandaloneReferenceName): StandaloneReferenceSpec {
  return REFERENCE_SURFACE[name];
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
// Only tags whose meaning stands alone are documented. Lists, tables, and code
// have first-class components above, so nothing is unreachable.

export const STRUCTURAL_TAGS = ["section", "h1", "h2", "h3", "p", "form"] as const;

export type StructuralTagName = (typeof STRUCTURAL_TAGS)[number];

export const STRUCTURAL_TAG_SURFACE = {
  section: { meaning: "Wraps its children in a vertical stack." },
  h1: { meaning: "A level-1 heading. Its content is the heading." },
  h2: { meaning: "A level-2 heading. Its content is the heading." },
  h3: { meaning: "A level-3 heading. Its content is the heading." },
  p: { meaning: "A paragraph of prose. Its content is the prose." },
  form: { meaning: "Wraps a set of form controls in a titled surface." },
} as const satisfies Readonly<Record<StructuralTagName, { readonly meaning: string }>>;

// ---- Vocabulary -------------------------------------------------------------

export const VocabularyId = {
  Real: "real",
  Scrambled: "scrambled",
} as const;

export type VocabularyId = (typeof VocabularyId)[keyof typeof VocabularyId];

export type NameMap = Readonly<Record<string, string>>;

// The harness un-scrambles a model's output with this before compiling it.
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

function isStandaloneReference(
  component: DocumentedComponentName,
): component is StandaloneReferenceName {
  return (STANDALONE_REFERENCE_COMPONENTS as readonly string[]).includes(component);
}

// A component's props as the prompt documents them: its real catalog props, then
// any reference props the ladder layers on. One continuous namespace, so an alias
// is unique within the component.
export function documentedPropNamesOf(component: DocumentedComponentName): readonly string[] {
  if (isStandaloneReference(component)) {
    return Object.keys(REFERENCE_SURFACE[component].props);
  }
  const surfaceProps = Object.keys(COMPONENT_SURFACE[component].props);
  const layered = layeredReferenceFor(component);
  if (layered === null) return surfaceProps;
  return [...surfaceProps, ...Object.keys(layered.props)];
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
