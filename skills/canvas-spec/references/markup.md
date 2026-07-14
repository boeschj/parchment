# Markup dialect

Pass `markup` to `canvas_render` instead of `spec`. It is HTML with the canvas
widgets as custom elements, compiled to the same spec — so everything the spec
grammar does (`$state`, `repeat`, `on`) still applies, and errors come back in
the same issue list.

```html
<state>{"ci": [{"day": "Mon", "minutes": 41}, {"day": "Tue", "minutes": 36}]}</state>

<section>
  <h1>CI health</h1>
  <Metric label="p99 build" value="412ms" delta="-38%" trend="down" tone="success"/>
  <Chart kind="bar" data="$state.ci" x="day" y="minutes" height="280"/>
</section>
```

## The fidelity ladder — read this first

Output tokens are what you pay for. The way to spend fewer is not shorter syntax,
it is **naming content instead of emitting it**. Every capability has rungs:

| | rung 0 — you emit everything | rung 1 — named widget, you still emit the DATA | rung 2 — named REFERENCE, the daemon fetches the bytes |
|---|---|---|---|
| code | `<pre>…paste…</pre>` | `<CodeBlock>…paste…</CodeBlock>` | `<CodeBlock file="src/a.ts" lines="40-80"/>` |
| diff | paste both versions | `<DiffViewer before="…" after="…"/>` | `<GitDiff file="src/a.ts"/>` |
| table | `<table>…rows…</table>` | `<DataTable rows="[…]"/>` | `<DataTable src="results.csv"/>` |
| chart | — | `<Chart data="[…]" …/>` | `<Chart src="results.csv" …/>` |
| logs | paste output | `<Terminal>…paste…</Terminal>` | `<LogStream file="app.log" watch/>` |
| prose | `<p>…paste…</p>` | `<Markdown>…paste…</Markdown>` | `<Markdown file="README.md"/>` |
| image | — | — | `<Image src="shot.png"/>` |

**Always take the highest rung available. Never paste content that exists on
disk.** A `<GitDiff>` is ~16 tokens; pasting both sides of that file is ~15,000 —
a 473x difference on one element. Paste inline **only** when the content exists
nowhere on disk (you are inventing it).

```html
<GitDiff file="src/daemon/server.ts" base="HEAD~1"/>   <!-- the whole diff -->
<DataTable src="bench/results.csv"/>                   <!-- the whole table -->
<LogStream file="logs/app.log" watch/>                 <!-- a live tail -->
```

Reference options: `lines="40-80"` (also `"40"`, `"40-"`, `"-80"`) · `base="HEAD~1"`
· `staged` · `watch` (live-update) · `limit="500"` (csv rows).
Paths are project-relative and root-confined.

## Tags

**Semantic HTML** compiles to the catalog:

| Tag | Becomes |
|---|---|
| `h1`–`h4` | `Heading` (level from the tag; h5/h6 clamp to h4) |
| `p`, bare text | `Text` (one plain line) or `Markdown` (any inline markup) |
| `section` `div` `article` `main` `aside` `header` `footer` `nav` | `Stack` |
| `form` | `Card` |
| `table` | `DataTable` when regular (one `<th>` header row, even rows, no colspan) — else `Table` |
| `ul` `ol` `blockquote` | `Markdown` (list / quote) |
| `pre` | `CodeBlock` (language from `<code class="language-x">`) |
| `hr` · `img` · `a` · `button` | `Separator` · `Image` · `Link` · `Button` |
| `input` `textarea` `select` | `Input` `Textarea` `Select` |

**Widgets** are custom elements, case-insensitive, self-closing allowed. Attributes
are the component's props (see the component inventory in the skill core):
`<Metric>` `<Chart>` `<DataTable>` `<Callout>` `<CodeBlock>` `<Terminal>` `<Steps>`
`<Sparkline>` `<DiffViewer>` `<MermaidEditor>` `<PlanFile>` `<Upload>` `<TestResults>`
`<FileChange>` `<Markdown>` `<Grid>` `<Card>` `<Stack>` `<Tabs>` `<Badge>` `<Progress>` …

Reference-first aliases: **`<GitDiff file base staged watch/>`** (a DiffViewer the
daemon fills from git) and **`<LogStream file watch/>`** (a Terminal tailing a file).

`<script>`, `<style>`, and unknown tags are rejected. Nothing is ever executed.

## Attributes

- **JSON** — a value starting with `[` or `{` is parsed as JSON:
  `<Steps items='[{"title":"Build","status":"done"}]'/>`
- **State** — `"$state.path"` reads state: `<Chart data="$state.ci" …/>`
- **Numbers/booleans** are coerced to the prop's type: `height="280"` → `280`;
  bare `editable` → `true`.
- **camelCase props** may be written any case — `highlightLines`, `highlightlines`
  both work.
- **Text content** fills the component's text prop: `CodeBlock`→`code`,
  `Terminal`→`output`, `MermaidEditor`→`source` (raw), `Callout`→`body`,
  `Markdown`→`content`, `Heading`/`Text`→`text`, `Button`→`label`. Code and mermaid
  are kept verbatim and dedented — escape a literal `<` as `&lt;`.

### Interaction sugar

| Attribute | Compiles to |
|---|---|
| `bind="/form/email"` | `{"$bindState": "/form/email"}` on the value prop (`checked` for Checkbox/Switch, `pressed` for Toggle) |
| `intent="retry"` + `intent-params='{"env":"prod"}'` | an `on.press` → `canvas.intent` (params must be static JSON) |
| `submit="signup"` (+ `payload="/form"`) | an `on.press` → `canvas.submit`, payload defaults to `{"$state":"/form"}` |
| `required` `minlength` `maxlength` `min` `max` `pattern`, `type="email"` | entries in the component's `checks` array |

### State

One top-level `<state>` element, JSON text. Seed every path you bind.

```html
<state>{"form": {"email": "", "plan": "Starter"}}</state>
```

### Keys

Element keys are generated from tree position (`heading-0`, `metric-1-0`), so the
same document always compiles to the same keys — `canvas_patch` can address them
across re-pushes.

## Worked example — signup form

```html
<state>{"form": {"name": "", "email": "", "password": "", "plan": "Starter"}}</state>

<form title="Create your account">
  <input label="Name" bind="/form/name" required/>
  <input label="Email" type="email" bind="/form/email" required/>
  <input label="Password" type="password" bind="/form/password" required minlength="8"/>
  <select label="Plan" bind="/form/plan">
    <option>Starter</option>
    <option>Team</option>
  </select>
  <p>By signing up you agree to the <a href="https://ex.com/terms">terms</a>.</p>
  <button submit="signup" variant="primary">Sign up</button>
</form>
```

## Worked example — review dashboard (all high-rung)

Not one byte of the diff, the source, the benchmark rows, or the log is emitted:

```html
<section>
  <h1>Cache fix — review</h1>
  <p>The TTL now tracks the sync interval. One file changed.</p>

  <GitDiff file="src/api/cache.ts" base="HEAD~1"/>

  <h2>The hot path it touches</h2>
  <CodeBlock file="src/api/cache.ts" lines="40-80"/>

  <h2>Benchmark</h2>
  <DataTable src="bench/results.csv"/>
  <Chart src="bench/results.csv" kind="line" x="run" y="p99_ms" title="p99 across runs"/>

  <h2>Live</h2>
  <LogStream file="logs/app.log" watch/>

  <button intent="merge-pr" intent-params='{"pr":412}'>Merge</button>
</section>
```
