# Benchmarks

> **There are no performance numbers on this page right now.**
> Every number we previously published here was produced by a rubric that did
> not check whether anything rendered. We withdrew them, rebuilt the rubric so a
> browser decides what counts as correct, and re-scored the old runs with it:
> **1 of the 24 archived runs we called "passing" actually renders its data.**
> New numbers will be published once the re-measurement completes — whatever
> they say. This page documents the rubric first, on purpose: a benchmark whose
> acceptance test you cannot audit is worth nothing, and ours wasn't.

## What was wrong

The old harness accepted a parchment run if the daemon's session state contained
the right *count of component types*. That is the entire check it performed. It
never looked at props, data, bindings, events, or a single painted pixel.

So a `Chart` with props `{chartType, xKey, series}` — not one of which is a real
Chart prop (they are `kind`, `data`, `x`, `y`) — counted as a passing "Chart".
In the browser, that component throws `Cannot read properties of undefined` and
paints nothing at all.

Then we optimized the product against that rubric. Textbook Goodhart: the
measure became a target, and stopped being a measure. The "24/24 first-pass"
claim, the tokens-to-first-paint tables, the win/loss counts — all of it rested
on a definition of "correct" that a blank page could satisfy.

The arms were also judged unequally (the HTML arm was regex-checked for tags;
parchment was type-counted), n was 2–3, some HTML runs were reused across
non-contemporaneous passes, and no human ever looked at the output.

## The integrity number: 1 / 24

`bench/acceptance/replay.ts` takes every archived parchment run, pulls the spec
out of that run's own session transcript, renders it exactly as the product did
(`prepareSpec`, then `POST /slots` — the real pipeline, repairs included), and
judges the painted page in a real browser. It calls no model; it costs nothing.

| | Old validator | Browser rubric |
|---|---|---|
| Archived runs passing | 24 / 24 | **1 / 24** |

The failures are not close calls:

| Scenario | What the model wrote | What the user saw |
|---|---|---|
| architecture-diagram | `MermaidEditor{code: "graph LR…"}` — the prop is `source` | Mermaid got no source, threw, drew no diagram. Old rubric: `MermaidEditor: 1` → pass. |
| incident-report | `Callout{variant,text}` (real: `tone`,`body`), `Steps{steps}` (real: `items`), `Markdown{text}` (real: `content`) | Every component rendered empty. Old rubric: `Callout: 1, Steps: 1` → pass. |
| status-dashboard | `Chart{chartType,xKey,series}` | The chart crashes on undefined and paints no `<svg>` at all. Old rubric: `Chart: 2` → pass. |
| live-log-dashboard | chart + table bindings wrong | Neither the chart nor the table is in the DOM. |
| validated-form | `Input` with no label/name, or validation that never fires | The form accepts an empty required name and `"abc"` as a password. |

Three independent signals agree, which is why we believe the number:

1. **The browser** says the data is not on screen.
2. **The product's own (since hardened) spec validation** raises 2–13 issues on
   every one of these specs today.
3. **Reading the raw specs by hand** shows the props are simply not the declared
   ones.

And a **positive control** (`bench/acceptance/parchment-control.test.ts`) proves
a *correct* parchment spec passes the rubric on all six scenarios. So this is
the specs failing, not the rubric being unsatisfiable.

Raw data, screenshots and per-run reasons:
`bench/results/2026-07-14T04-52-44-442Z-rubric-replay/`.

## The rubric

Acceptance is **browser-real** and **independent of our own validator**. Nothing
in the checking path may import parchment's schema, its validators, or
`prepareSpec` — that circularity is what caused this. An assertion must be
satisfiable, in principle, by any technology that can paint a page.

Every arm is reduced to the same `DomFacts` by the same in-page probe, and then
the same per-scenario assertions run against it. There is no per-arm branch in
the checking path.

The scenario specs are data, not code. Here is `status-dashboard` **verbatim**
(`bench/acceptance/specs.ts`):

```ts
export const statusDashboardAcceptance: AcceptanceSpec = {
  scenarioId: "status-dashboard",
  title: "CI status dashboard (KPI row + 2 charts)",
  assertions: [
    ...RENDERED_AT_ALL,
    {
      kind: AssertionKind.TextPresent,
      description: "the 3 KPI tiles show their label and value",
      // Each label is paired with its value in one string, so the assertion
      // cannot be satisfied by a stray digit elsewhere on the page.
      values: ["Build Pass Rate 94%", "Avg Build Time 4m12s", "Open Incidents 2"],
    },
    {
      kind: AssertionKind.Charts,
      description: "both charts plot their 7-day series and label the days",
      minCharts: 2,
      minDataPointsPerChart: MIN_DATA_POINTS_IN_A_7_POINT_SERIES,  // 5
      requiredAxisLabels: WEEKDAYS,  // Mon…Sun
    },
  ],
};
```

where `RENDERED_AT_ALL` is applied to every scenario:

```ts
const RENDERED_AT_ALL = [
  { kind: AssertionKind.ContentNonEmpty, minVisibleTextLength: 25, minContentHeightPx: 200 },
  { kind: AssertionKind.NoConsoleErrors },
  { kind: AssertionKind.NoErrorBoundary },
] as const;
```

The other scenarios assert, in the same style: every CSV row's values co-occur
inside **one** `<tr>` (a page that lists the names in one column and the numbers
somewhere else has not rendered the CSV); one `<svg>` carries all three diagram
node labels **and** the connectors between them; the incident report paints its
verdict, root cause and every timeline timestamp; the log dashboard plots its 5
seeded points and shows all 3 log lines as table rows.

### How a chart is checked

"Did the chart plot the data?" is the assertion the old rubric most needed and
least had. It is answered without reference to any charting library:

- **Data points.** For each `<svg>`, `dataPointCount` = the max of (rects,
  circles, paths, polylines, longest single path/polyline vertex run). A
  renderer encodes N points *either* as N marks *or* as one mark with N
  vertices; taking the max is neutral between those choices. Axis and grid
  `<line>` elements are never counted — both arms draw axes with them, so
  counting them would let an empty chart pass on its own gridlines.
- **Axis labels.** The category labels from the source data (`Mon`…`Sun`) must
  be painted as text inside the qualifying charts. This is what proves the axis
  was bound to the data rather than drawn blank.
- **A chart must also carry ≥ 2 text labels** to qualify at all, which is what
  stops a decorative icon (an `<svg>` whose single path has a dozen vertices)
  from being counted as a chart.

Measured, with the *same* thresholds on both arms:

| artifact | data points / chart | axis labels | console errors | svgs |
|---|---|---|---|---|
| parchment, correct spec | 7, 7 | 38, 24 | 0 | 2 |
| hand-written HTML, correct | 7, 7 | 7, 7 | 0 | 2 |
| parchment, bogus chart props | — | — | **3** | **0** |
| parchment, `data: []` | **1** | **0** | 0 | 1 |
| HTML, chart chrome but no marks | **0** | **0** | 1 | 1 |

### How the form is checked — behaviour, not markup

The tempting rubric is "the password input has `minlength=8` and `required`".
That is a **rubric artifact**, and asserting it would have repeated the original
sin with the arms reversed: parchment's `Input` does not accept `required` or
`minLength` at all (*"unknown prop — the renderer ignores it"*); it validates
through a `checks` prop. Scoring native HTML5 attributes would hand the HTML arm
a win on a rubric parchment cannot express.

So the harness does what a user would: it types an empty name, `not-an-email`,
and a 3-character password into the form, presses **Sign up**, and asserts the
form **refuses** — in any legible way (a native validity failure, an
`aria-invalid` field, or an error message naming the field).

Rejection is checked **per field**, not page-wide: a form whose only constraint
is `type="email"` refuses `not-an-email` all by itself, and would otherwise pass
while silently accepting the empty name and the 3-character password.

### Two thresholds we got wrong, and how we know

Both were caught by calibrating against measured renders instead of guessing —
and both would have *unfairly failed a correct artifact*:

- Counting bar-chart marks as `<rect>` scored a **correct** recharts bar chart at
  **4** data points, not 7: recharts v3 draws bars as `<path>`.
- Reading svg labels from `<text>`/`<tspan>` scored a **correct** mermaid diagram
  as *"no labels at all"*: mermaid v11 paints node labels into `<foreignObject>`
  divs.

If a rubric can fail a correct artifact, it can also flatter a broken one. These
are recorded here because they are the kind of thing a reader should be checking
us for.

## Product bugs this found

Reported, not patched (`src/` is owned elsewhere):

1. **`validateOn: "submit"` never fires.** An `Input` with `checks` and
   `validateOn: "submit"`, submitted via a `Button` wired to `canvas.submit`,
   runs **no validation at all** — the form accepts anything. `validateOn:
   "blur"` and `"change"` both work correctly and render the message. Spec
   validation raises **zero** issues about it, so nothing warns the model. The
   natural way to write a validated form silently produces an unvalidated one.
2. **`Chart` with `data: []` passes validation and renders blank.** Zero issues
   from `prepareSpec`; one painted mark; no axis labels.

## What we do NOT claim

- **No performance comparison is being made on this page.** Not tokens, not
  cost, not wall-clock, not win/loss. The previous ones are withdrawn.
- The rubric does not score **aesthetics**. It scores whether the data the
  prompt supplied reached the screen without errors. A blinded human review is
  the intended companion to it, not a replacement for it.
- The rubric requires charts to be drawn as inline `<svg>`. A chart rasterized
  into a bitmap `<canvas>` cannot have its data verified by any DOM rubric — nor
  by find-in-page, nor by a screen reader — so both arms are told to use `<svg>`,
  and a run that ignores that fails with that reason printed.
- `1/24` is a statement about **24 archived runs of one product version under one
  set of prompts**. It is a strong claim about the old rubric's worthlessness and
  about those specs; it is not a general claim about how often parchment renders
  correctly today (validation has since been hardened, and would now reject most
  of those specs before they ever painted).

## How to falsify this

Everything below runs locally, calls no model, and costs nothing.

```bash
pnpm install
npx playwright install chromium

# The rubric, driven at fixtures built to fool a weaker check, plus the
# positive control (a correct parchment spec must pass all six scenarios).
bun test bench/acceptance/

# Re-score every archived run in the browser. Prints the integrity number.
bun run bench/acceptance/replay.ts
```

Where to look if you think we are wrong:

- **`bench/acceptance/specs.ts`** — the entire definition of "correct", as data.
  If an assertion here is unfair to an arm, the benchmark is unfair. Say so.
- **`bench/acceptance/checks.ts`** — the evaluators. Pure functions over
  `DomFacts`; no browser, no arm, no branch.
- **`bench/acceptance/dom-probe.ts`** — the one reduction both arms pass through.
  If it can see something on one arm that it cannot see on the other, that is a
  bug and it invalidates the comparison.
- **`bench/results/…-rubric-replay/`** — every replayed run's screenshot, the
  reasons it failed, and its `DomFacts`. Open the screenshots. The charts really
  are empty.
- **`bench/acceptance/parchment-control.test.ts`** — if you believe the rubric is
  rigged against parchment, this is the test to break: it hand-writes a correct
  parchment spec per scenario and requires all six to pass.

The fastest way to prove us dishonest would be to produce a parchment spec that
renders a correct, complete dashboard and is nonetheless failed by this rubric.
If you find one, that is a bug in the rubric and we want it.

## Reproducing the daemon-startup measurement

The only previously-published number that did **not** depend on the invalid
rubric (it involves no model and no rendering) is daemon boot time:

| | Mean | Median | Min | Max |
|---|---|---|---|---|
| Cold boot (fresh state dir) | 205 ms | 204 ms | 203 ms | 209 ms |
| Warm boot | 204 ms | 204 ms | 203 ms | 204 ms |

```bash
bun run bench/time-to-first-canvas.ts   # $0
```

## Raw data

Archived runs keep their full session transcripts. They are retained precisely
because they are the evidence for the invalidation:

- `bench/results/2026-07-14T04-52-44-442Z-rubric-replay/` — **the replay**:
  per-run verdicts, reasons, screenshots.
- `bench/results/2026-07-12T22-28-37-337Z/` — the 18-run sonnet parchment pass
  the old harness scored 18/18. **1** of these renders correctly
  (`csv-data-table`, rep 2).
- `bench/results/2026-07-12T22-32-01-708Z/` — the 6-run opus parchment pass the
  old harness scored 6/6. **0** of these render correctly.
