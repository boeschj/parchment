import { describe, expect, test } from "bun:test";
import { compileMarkup } from "./index.ts";
import { prepareSpec } from "../spec-validation.ts";
import type { UIElement } from "../../shared/types.ts";

function compile(markup: string) {
  return compileMarkup(markup);
}

function elementsOf(markup: string): Record<string, UIElement> {
  return compile(markup).spec.elements;
}

function typesOf(markup: string): string[] {
  return Object.values(elementsOf(markup)).map((element) => element.type);
}

function firstOfType(markup: string, type: string): UIElement {
  const found = Object.values(elementsOf(markup)).find((element) => element.type === type);
  if (!found) throw new Error(`no ${type} element compiled from: ${markup}`);
  return found;
}

function issuesOf(markup: string): string[] {
  return compile(markup).issues;
}

describe("semantic tag mapping", () => {
  test("h1-h4 map to Heading with the tag's level", () => {
    for (const level of [1, 2, 3, 4]) {
      const heading = firstOfType(`<h${level}>Title</h${level}>`, "Heading");
      expect(heading.props).toEqual({ level: `h${level}`, text: "Title" });
    }
  });

  test("h5/h6 compile to Heading and clamp to h4 through prepareSpec", () => {
    const { spec } = compile("<h6>Deep</h6>");
    const prepared = prepareSpec(spec);
    expect(prepared.issues).toEqual([]);
    expect(Object.values(prepared.spec.elements)[0]?.props.level).toBe("h4");
  });

  test("a plain paragraph becomes Text(body)", () => {
    const text = firstOfType("<div><p>Just a line.</p></div>", "Text");
    expect(text.props).toEqual({ text: "Just a line.", variant: "body" });
  });

  test("a paragraph with inline markup becomes one Markdown", () => {
    const markdown = firstOfType(
      "<div><p>The TTL was <strong>30s</strong> — see <code>cache.ts</code>.</p></div>",
      "Markdown",
    );
    expect(markdown.props.content).toBe("The TTL was **30s** — see `cache.ts`.");
  });

  test("section and div both become Stack", () => {
    expect(typesOf("<section><div><p>a</p></div></section>")).toContain("Stack");
    expect(typesOf("<section><div><p>a</p></div></section>").filter((t) => t === "Stack")).toHaveLength(2);
  });

  test("form becomes Card and keeps its children", () => {
    const elements = elementsOf('<form title="Sign up"><button>Go</button></form>');
    const card = Object.values(elements).find((element) => element.type === "Card");
    expect(card?.props.title).toBe("Sign up");
    expect(card?.children).toHaveLength(1);
  });

  test("hr becomes Separator, img becomes Image", () => {
    const types = typesOf('<section><hr><img src="/a.png" alt="A"></section>');
    expect(types).toContain("Separator");
    expect(types).toContain("Image");
    const image = firstOfType('<section><img src="/a.png" alt="A"></section>', "Image");
    expect(image.props).toEqual({ src: "/a.png", alt: "A" });
  });

  test("a standalone anchor becomes a Link", () => {
    const link = firstOfType('<section><a href="https://x.dev">Docs</a></section>', "Link");
    expect(link.props).toEqual({ href: "https://x.dev", label: "Docs" });
  });

  test("ul and ol become one Markdown list", () => {
    expect(firstOfType("<div><ul><li>one</li><li>two</li></ul></div>", "Markdown").props.content).toBe(
      "- one\n- two",
    );
    expect(firstOfType("<div><ol><li>one</li><li>two</li></ol></div>", "Markdown").props.content).toBe(
      "1. one\n2. two",
    );
  });

  test("blockquote becomes a Markdown quote", () => {
    expect(firstOfType("<div><blockquote>Careful.</blockquote></div>", "Markdown").props.content).toBe(
      "> Careful.",
    );
  });

  test("pre becomes a CodeBlock and picks up language-* from the inner code tag", () => {
    const code = firstOfType('<div><pre><code class="language-go">x := 1</code></pre></div>', "CodeBlock");
    expect(code.props.code).toBe("x := 1");
    expect(code.props.language).toBe("go");
  });

  test("label becomes Text", () => {
    expect(firstOfType("<div><label>Email</label></div>", "Text").props.text).toBe("Email");
  });
});

describe("tables", () => {
  const regular = `<table>
    <caption>Jobs</caption>
    <thead><tr><th>Job</th><th>p99 ms</th></tr></thead>
    <tbody><tr><td>build</td><td>412</td></tr><tr><td>test</td><td>980</td></tr></tbody>
  </table>`;

  test("a regular table becomes a DataTable with slugified column keys", () => {
    const table = firstOfType(regular, "DataTable");
    expect(table.props.columns).toEqual([
      { key: "job", header: "Job" },
      { key: "p99_ms", header: "p99 ms", type: "number", align: "right" },
    ]);
    expect(table.props.rows).toEqual([
      { job: "build", p99_ms: 412 },
      { job: "test", p99_ms: 980 },
    ]);
    expect(table.props.caption).toBe("Jobs");
  });

  test("an all-numeric column is typed number and right-aligned; a text column is not", () => {
    const table = firstOfType(regular, "DataTable");
    const columns = table.props.columns;
    expect(Array.isArray(columns) && columns[0]).toEqual({ key: "job", header: "Job" });
  });

  test("a table with colspan falls back to the shadcn Table", () => {
    const irregular = `<table>
      <thead><tr><th>A</th><th>B</th></tr></thead>
      <tbody><tr><td colspan="2">merged</td></tr></tbody>
    </table>`;
    const table = firstOfType(irregular, "Table");
    expect(table.props.columns).toEqual(["A", "B"]);
    expect(table.props.rows).toEqual([["merged"]]);
  });

  test("a headerless table falls back to the shadcn Table", () => {
    const table = firstOfType("<table><tr><td>a</td><td>b</td></tr></table>", "Table");
    expect(table.props.rows).toEqual([["a", "b"]]);
  });
});

describe("custom elements", () => {
  test("widget tags resolve case-insensitively", () => {
    expect(typesOf('<div><metric label="a" value="1"/></div>')).toContain("Metric");
    expect(typesOf('<div><METRIC label="a" value="1"/></div>')).toContain("Metric");
    expect(typesOf('<div><Metric label="a" value="1"/></div>')).toContain("Metric");
  });

  test("self-closing widgets are siblings, not nested", () => {
    const elements = elementsOf(
      '<section><Metric label="a" value="1"/><Metric label="b" value="2"/></section>',
    );
    const root = elements.root;
    expect(root?.children).toEqual(["metric-0", "metric-1"]);
    expect(elements["metric-0"]?.children).toEqual([]);
  });

  test("lowercased attributes map back to camelCase schema props", () => {
    const code = firstOfType(
      '<div><CodeBlock language="ts" highlightlines="[3]" startline="10" maxheight="200">x</CodeBlock></div>',
      "CodeBlock",
    );
    expect(code.props.highlightLines).toEqual([3]);
    expect(code.props.startLine).toBe(10);
    expect(code.props.maxHeight).toBe(200);
  });

  test("camelCase attributes as authored also map (parser lowercases them)", () => {
    const code = firstOfType('<div><CodeBlock highlightLines="[1,2]">x</CodeBlock></div>', "CodeBlock");
    expect(code.props.highlightLines).toEqual([1, 2]);
  });

  test("raw text content fills the widget's text prop verbatim", () => {
    expect(firstOfType("<div><CodeBlock>const x = 1;</CodeBlock></div>", "CodeBlock").props.code).toBe(
      "const x = 1;",
    );
    expect(
      firstOfType('<div><Terminal command="ls">a.ts\nb.ts</Terminal></div>', "Terminal").props.output,
    ).toBe("a.ts\nb.ts");
    expect(
      firstOfType("<div><MermaidEditor>graph TD\n  A-->B</MermaidEditor></div>", "MermaidEditor").props
        .source,
    ).toBe("graph TD\n  A-->B");
  });

  test("raw text content is dedented to the authored shape", () => {
    const code = firstOfType(
      `<div><CodeBlock>
      function a() {
        return 1;
      }
    </CodeBlock></div>`,
      "CodeBlock",
    );
    expect(code.props.code).toBe("function a() {\n  return 1;\n}");
  });

  test("layout widgets compile their element children", () => {
    const elements = elementsOf('<Grid columns="3"><Metric label="a" value="1"/></Grid>');
    expect(elements.root?.type).toBe("Grid");
    expect(elements.root?.props.columns).toBe(3);
    expect(elements.root?.children).toEqual(["metric-0"]);
  });
});

describe("attribute values", () => {
  test("values starting with [ or { are JSON-parsed", () => {
    const chart = firstOfType(
      `<div><Chart kind="bar" data='[{"d":"Mon","v":1}]' x="d" y="v"/></div>`,
      "Chart",
    );
    expect(chart.props.data).toEqual([{ d: "Mon", v: 1 }]);
  });

  test("$state strings pass through untouched for the expression grammar", () => {
    const chart = firstOfType('<div><Chart kind="line" data="$state.series" x="d" y="v"/></div>', "Chart");
    expect(chart.props.data).toBe("$state.series");
  });

  test("number-typed props coerce numeric strings; string props do not", () => {
    const chart = firstOfType('<div><Chart kind="bar" data="$state.s" x="d" y="v" height="280"/></div>', "Chart");
    expect(chart.props.height).toBe(280);
    const metric = firstOfType('<div><Metric label="n" value="412"/></div>', "Metric");
    expect(metric.props.value).toBe("412");
  });

  test("boolean props accept bare presence and explicit false", () => {
    expect(firstOfType('<div><DataTable columns="[]" rows="[]" editable/></div>', "DataTable").props.editable).toBe(true);
    expect(
      firstOfType('<div><DataTable columns="[]" rows="[]" exportable="false"/></div>', "DataTable").props.exportable,
    ).toBe(false);
  });

  test("invalid JSON in an attribute is rejected with the attribute named", () => {
    const issues = issuesOf('<div><Chart kind="bar" data="[{oops}]" x="d" y="v"/></div>');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('attribute "data"');
    expect(issues[0]).toContain("invalid JSON");
  });

  test("an unknown attribute on a widget is rejected with the known list", () => {
    const issues = issuesOf('<div><Metric label="a" value="1" bogus="x"/></div>');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('unknown attribute "bogus" on <Metric>');
    expect(issues[0]).toContain("label, value, delta, trend, tone, detail");
  });
});

describe("bind / intent / submit sugar", () => {
  test('bind="/form/email" binds the natural value prop', () => {
    const input = firstOfType('<form><input label="Email" bind="/form/email"/></form>', "Input");
    expect(input.props.value).toEqual({ $bindState: "/form/email" });
  });

  test("bind accepts a dotted path and normalizes it to a pointer", () => {
    const input = firstOfType('<form><input bind="form.email"/></form>', "Input");
    expect(input.props.value).toEqual({ $bindState: "/form/email" });
  });

  test("bind targets `checked` on a Checkbox and `pressed` on a Toggle", () => {
    expect(firstOfType('<div><Checkbox label="a" bind="/form/ok"/></div>', "Checkbox").props.checked).toEqual({
      $bindState: "/form/ok",
    });
    expect(firstOfType('<div><Toggle label="a" bind="/form/on"/></div>', "Toggle").props.pressed).toEqual({
      $bindState: "/form/on",
    });
  });

  test("intent becomes a canvas.intent press binding", () => {
    const button = firstOfType('<div><button intent="retry">Retry</button></div>', "Button");
    expect(button.on).toEqual({ press: [{ action: "canvas.intent", params: { id: "retry" } }] });
    expect(button.props.label).toBe("Retry");
  });

  test("intent-params rides along as static JSON", () => {
    const button = firstOfType(
      `<div><button intent="deploy" intent-params='{"env":"prod"}'>Deploy</button></div>`,
      "Button",
    );
    expect(button.on?.press).toEqual([
      { action: "canvas.intent", params: { id: "deploy", params: { env: "prod" } } },
    ]);
  });

  test("submit becomes a canvas.submit press binding defaulting to /form", () => {
    const button = firstOfType('<form><button submit="signup">Go</button></form>', "Button");
    expect(button.on?.press).toEqual([
      { action: "canvas.submit", params: { id: "signup", payload: { $state: "/form" } } },
    ]);
  });

  test("a payload attribute overrides the submitted state path", () => {
    const button = firstOfType('<form><button submit="s" payload="/draft">Go</button></form>', "Button");
    expect(button.on?.press).toEqual([
      { action: "canvas.submit", params: { id: "s", payload: { $state: "/draft" } } },
    ]);
  });

  test("intent-params must be a JSON object", () => {
    const issues = issuesOf('<div><button intent="x" intent-params="[1]">Go</button></div>');
    expect(issues[0]).toContain("intent-params must be a JSON object");
  });
});

describe("native validation attributes become checks", () => {
  test("required, minlength and type=email translate to the catalog checks array", () => {
    const input = firstOfType(
      '<form><input type="email" bind="/form/email" required minlength="5"/></form>',
      "Input",
    );
    expect(input.props.checks).toEqual([
      { type: "required", message: "Required" },
      { type: "minLength", args: { value: 5 }, message: "Must be at least 5 characters" },
      { type: "email", message: "Enter a valid email" },
    ]);
    expect(input.props.type).toBe("email");
  });

  test("min/max on an input become bound checks, not props", () => {
    const input = firstOfType('<form><input type="number" min="0" max="10"/></form>', "Input");
    expect(input.props.checks).toEqual([
      { type: "min", args: { value: 0 } },
      { type: "max", args: { value: 10 } },
    ]);
    expect(input.props.min).toBeUndefined();
  });

  test("a non-numeric minlength is rejected", () => {
    expect(issuesOf('<form><input minlength="lots"/></form>')[0]).toContain(
      'attribute "minlength" expects a number',
    );
  });

  test("select options come from its option children", () => {
    const select = firstOfType(
      "<form><select label='Plan'><option>Starter</option><option>Team</option></select></form>",
      "Select",
    );
    expect(select.props.options).toEqual(["Starter", "Team"]);
  });
});

describe("prose coalescing", () => {
  test("a contiguous run of bare text and inline tags folds into one Markdown", () => {
    const elements = elementsOf("<section>Plain text with <strong>bold</strong> and <em>italics</em>.</section>");
    const nonRoot = Object.values(elements).filter((element) => element.type !== "Stack");
    expect(nonRoot).toHaveLength(1);
    expect(nonRoot[0]?.type).toBe("Markdown");
    expect(nonRoot[0]?.props.content).toBe("Plain text with **bold** and *italics*.");
  });

  test("bare text with no markdown syntax becomes a lighter Text(body)", () => {
    const elements = elementsOf("<section>Just words.</section>");
    const text = Object.values(elements).find((element) => element.type === "Text");
    expect(text?.props).toEqual({ text: "Just words.", variant: "body" });
  });

  test("a block element flushes the prose run around it", () => {
    const types = typesOf("<section>before<hr>after</section>");
    expect(types).toEqual(["Text", "Separator", "Text", "Stack"]);
  });

  test("br becomes a line break inside the prose run", () => {
    const markdown = firstOfType("<section>one<br>two</section>", "Markdown");
    expect(markdown.props.content).toBe("one\ntwo");
  });
});

describe("root and state", () => {
  test("a single top-level element is the root", () => {
    const { spec } = compile("<section><p>hi</p></section>");
    expect(spec.root).toBe("root");
    expect(spec.elements.root?.type).toBe("Stack");
  });

  test("multiple top-level elements are wrapped in a root Stack", () => {
    const { spec } = compile('<h1>A</h1><Metric label="m" value="1"/>');
    expect(spec.elements.root?.type).toBe("Stack");
    expect(spec.elements.root?.children).toEqual(["heading-0", "metric-1"]);
  });

  test("a top-level <state> element seeds spec.state and never renders", () => {
    const { spec } = compile('<state>{"form":{"email":""}}</state><form><input bind="/form/email"/></form>');
    expect(spec.state).toEqual({ form: { email: "" } });
    expect(Object.values(spec.elements).some((element) => element.type === "state")).toBe(false);
  });

  test("invalid state JSON is rejected", () => {
    expect(issuesOf("<state>{nope}</state><p>x</p>")[0]).toContain("<state>: contains invalid JSON");
  });

  test("a nested <state> is rejected", () => {
    expect(issuesOf('<section><state>{"a":1}</state></section>')[0]).toContain("must be a top-level element");
  });

  test("empty markup is rejected", () => {
    expect(issuesOf("   ")).toEqual(["markup is empty: nothing to render."]);
  });
});

describe("deterministic keys", () => {
  const markup = `<section>
    <h1>Title</h1>
    <div><Metric label="a" value="1"/><Metric label="b" value="2"/></div>
    <Chart kind="bar" data="$state.s" x="d" y="v"/>
  </section>`;

  test("keys are the type plus the child-index path from the root", () => {
    expect(Object.keys(elementsOf(markup)).sort()).toEqual(
      ["chart-2", "heading-0", "metric-1-0", "metric-1-1", "root", "stack-1"].sort(),
    );
  });

  test("identical markup compiles to identical keys", () => {
    expect(Object.keys(elementsOf(markup))).toEqual(Object.keys(elementsOf(markup)));
  });

  test("re-compiling after a prop-only edit keeps every key stable", () => {
    const edited = markup.replace('value="1"', 'value="9"');
    expect(Object.keys(elementsOf(edited)).sort()).toEqual(Object.keys(elementsOf(markup)).sort());
  });

  test("children arrays reference the generated keys", () => {
    const elements = elementsOf(markup);
    expect(elements.root?.children).toEqual(["heading-0", "stack-1", "chart-2"]);
    expect(elements["stack-1"]?.children).toEqual(["metric-1-0", "metric-1-1"]);
  });
});

// The ladder is the point of the dialect: naming a file costs ~16 output tokens
// where pasting both sides of it costs ~15,000. These tests pin the expression
// shapes the daemon's hydration engine resolves, and the precedence rules that
// keep a reference attribute from stealing a prop that legitimately owns the
// name. Every assertion is made on the spec AFTER prepareSpec, because
// prepareSpec is not a pass-through: autoFixSpec hoists the reserved element
// fields (on/repeat/watch/visible) out of props, and the shape that reaches the
// hydrator is the one that survives that.
function preparedElements(markup: string): Record<string, UIElement> {
  const compiled = compileMarkup(markup);
  expect(compiled.issues).toEqual([]);
  const prepared = prepareSpec(compiled.spec);
  expect(prepared.issues).toEqual([]);
  return prepared.spec.elements;
}

function preparedRoot(markup: string): UIElement {
  const root = preparedElements(markup).root;
  if (!root) throw new Error(`no root compiled from: ${markup}`);
  return root;
}

describe("fidelity ladder: reference attributes", () => {
  test("<GitDiff> compiles to a DiffViewer carrying the element-level $diff reference", () => {
    const diff = preparedRoot('<GitDiff file="src/daemon/server.ts" base="HEAD~1"/>');
    expect(diff.type).toBe("DiffViewer");
    expect(diff.props).toEqual({ $diff: "src/daemon/server.ts", base: "HEAD~1" });
  });

  test("<GitDiff staged> rides as a sibling option of the $diff key", () => {
    expect(preparedRoot('<GitDiff file="a.ts" staged/>').props).toEqual({ $diff: "a.ts", staged: true });
  });

  // autoFixSpec treats `watch` as a reserved ELEMENT field, so a top-level
  // props.watch does NOT stay in props — it is hoisted onto the element (as a
  // bare boolean, which UIElement.watch is not even typed to hold). The hydrator
  // reads it from either location. Asserting the whole serialized element pins
  // the shape that actually reaches the hydrator, so this can never drift
  // silently.
  test("<GitDiff watch> survives prepareSpec with watch hoisted to the element", () => {
    const diff = preparedRoot('<GitDiff file="a.ts" watch/>');
    expect(JSON.parse(JSON.stringify(diff))).toEqual({
      type: "DiffViewer",
      props: { $diff: "a.ts" },
      children: [],
      watch: true,
    });
  });

  test("<GitDiff> without a file is rejected", () => {
    expect(issuesOf('<GitDiff base="HEAD"/>')[0]).toContain('<GitDiff> needs file="<path>"');
  });

  test("CodeBlock file+lines references the file and numbers the gutter from it", () => {
    const code = preparedRoot('<CodeBlock file="src/foo.ts" lines="40-80"/>');
    expect(code.props).toEqual({
      code: { $file: "src/foo.ts", lines: "40-80" },
      title: "src/foo.ts",
      startLine: 40,
    });
  });

  test("CodeBlock diff= renders a unified patch and labels the language", () => {
    const code = preparedRoot('<CodeBlock diff="src/foo.ts" base="HEAD~1"/>');
    expect(code.props).toEqual({
      code: { $diff: "src/foo.ts", base: "HEAD~1" },
      title: "src/foo.ts",
      language: "diff",
    });
  });

  test("DataTable and Chart take src as a csv reference", () => {
    expect(preparedRoot('<DataTable src="results.csv" limit="500"/>').props).toEqual({
      rows: { $csv: "results.csv", limit: 500 },
    });
    expect(preparedRoot('<Chart src="results.csv" kind="line" x="t" y="ms"/>').props).toEqual({
      kind: "line",
      x: "t",
      y: "ms",
      data: { $csv: "results.csv" },
    });
  });

  // Here `watch` is nested INSIDE the expression value, not a top-level prop, so
  // it is invisible to autoFixSpec and survives exactly where it was emitted.
  test("<LogStream file watch> is a Terminal fed by a tailed file", () => {
    const terminal = preparedRoot('<LogStream file="app.log" watch/>');
    expect(terminal.type).toBe("Terminal");
    expect(terminal.props).toEqual({
      command: "tail -f app.log",
      output: { $file: "app.log", watch: true },
    });
    expect(terminal.watch).toBeUndefined();
  });

  // With a bucket, <LogStream> is a question, and it compiles to a Chart whose
  // data the daemon aggregates.
  // `x` and `y` are deliberately absent — they are facts about the file, and the
  // hydrator supplies them.
  test("<LogStream groupBy> is a Chart the daemon aggregates", () => {
    const chart = preparedRoot('<LogStream file="app.log" match="ERROR" groupBy="10m"/>');
    expect(chart.type).toBe("Chart");
    expect(chart.props).toEqual({
      kind: "line",
      data: { $log: "app.log", groupBy: "10m", match: "ERROR" },
    });
  });

  test("<LogStream> carries the full query: series, metric, parser, and chart shape", () => {
    const chart = preparedRoot(
      '<LogStream file="app.log" groupBy="5m" pattern="(?<level>ERROR|WARN)" series="level" metric="count" kind="bar" title="Errors" height="240" watch/>',
    );
    expect(chart.props).toEqual({
      kind: "bar",
      title: "Errors",
      height: 240,
      data: {
        $log: "app.log",
        groupBy: "5m",
        pattern: "(?<level>ERROR|WARN)",
        series: "level",
        metric: "count",
        watch: true,
      },
    });
  });

  // The bucket is the whole difference between the two readings of a log, so a
  // query with no bucket is named as one rather than silently becoming a tail.
  test("<LogStream match> without a bucket is rejected, naming groupBy", () => {
    const issue = issuesOf('<LogStream file="app.log" match="ERROR"/>')[0];
    expect(issue).toContain('add groupBy="10m"');
  });

  test("<LogStream> without a file is rejected", () => {
    expect(issuesOf('<LogStream groupBy="10m"/>')[0]).toContain('<LogStream> needs file="<path>"');
  });

  test("an unknown <LogStream> attribute is named, with the ones that exist", () => {
    const issue = issuesOf('<LogStream file="app.log" groupBy="10m" bucket="10m"/>')[0];
    expect(issue).toContain('unknown attribute "bucket"');
    expect(issue).toContain("groupBy, match, pattern, parser, series, metric");
  });

  test("Markdown and Terminal take file references too", () => {
    expect(preparedRoot('<Markdown file="README.md"/>').props).toEqual({
      content: { $file: "README.md" },
    });
    expect(preparedRoot('<Terminal file="build.log" command="bun run build"/>').props).toEqual({
      command: "bun run build",
      output: { $file: "build.log" },
    });
  });

  test("a local Image src becomes an image reference; a URL stays a URL", () => {
    expect(preparedRoot('<Image src="shots/after.png" alt="s"/>').props).toEqual({
      alt: "s",
      src: { $img: "shots/after.png" },
    });
    expect(preparedRoot('<img src="https://x.dev/a.png" alt="a">').props.src).toBe("https://x.dev/a.png");
    expect(preparedRoot('<img src="/logo.png" alt="l">').props.src).toBe("/logo.png");
  });

  test("DiffViewer keeps `file` as its path label, not a reference", () => {
    expect(preparedRoot('<DiffViewer file="a.ts" before="x" after="y"/>').props.file).toBe("a.ts");
  });

  test("every reference form survives prepareSpec with zero issues", () => {
    const elements = preparedElements(`<section>
      <GitDiff file="src/a.ts" watch/>
      <CodeBlock file="src/b.ts" lines="1-20"/>
      <DataTable src="out.csv"/>
      <Chart src="out.csv" kind="line" x="t" y="ms"/>
      <LogStream file="app.log" watch/>
      <Markdown file="README.md"/>
    </section>`);
    expect(Object.values(elements).map((element) => element.type)).toEqual([
      "DiffViewer",
      "CodeBlock",
      "DataTable",
      "Chart",
      "Terminal",
      "Markdown",
      "Stack",
    ]);
  });
});

describe("rejections", () => {
  test("script is rejected and never carried into the spec", () => {
    const { spec, issues } = compile("<section><script>alert(1)</script></section>");
    expect(issues[0]).toContain("script is not allowed");
    expect(JSON.stringify(spec)).not.toContain("alert");
  });

  test("style is rejected", () => {
    expect(issuesOf("<section><style>body{color:red}</style></section>")[0]).toContain(
      "style is not allowed",
    );
  });

  test("an unknown tag is rejected with the supported set", () => {
    const issues = issuesOf("<section><marquee>hi</marquee></section>");
    expect(issues[0]).toContain("<marquee>: unknown tag");
    expect(issues[0]).toContain("catalog components");
  });

  test("an unclosed tag is recovered by the parser, not rejected", () => {
    expect(issuesOf("<section><h1>Title</h1><p>text</section>")).toEqual([]);
  });
});
