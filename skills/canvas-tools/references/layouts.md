# Named layouts

Start from one of these and adapt — each is an ordered composition that lands the
answer first and carries the mechanism visually.

- **Explainer** (default for "how does X work"): Heading → Callout TL;DR → Metric
  row (the load-bearing numbers) → MermaidEditor or Steps (the mechanism) → Grid of
  Cards (the parts) → CodeBlock (the one snippet that matters) → Callout (sharp edges).
- **PR walkthrough**: Heading → Callout (what & why) → Metric row (files, +/-,
  risk) → FileChange stack → MermaidEditor (architecture delta) → DiffViewer (the
  crux change, `editableSide: "none"` unless review is wanted) → TestResults →
  Chart (before/after benchmark if you measured).
- **Investigation / postmortem**: Callout verdict first → Steps (causal chain,
  `error` status on the break point) → Terminal (the smoking-gun output) →
  CodeBlock (the offending code, highlighted) → DataTable (evidence) → Callout (fix).
- **Benchmark dashboard**: Metric row (headline deltas) → Chart (the distribution
  or series) → DataTable (raw runs) → Callout (methodology + caveats).
- **Log / trace analysis**: Metric row (error rate, p99, window) → Chart
  (line/area over time; seed big series into `state` and reference it) → DataTable
  (worst offenders) → Callout (diagnosis).
- **Live dashboard** ("keep an eye on X", test suites, builds, agent fleets, logs):
  compose ONCE with canvas_render — state-bound Chart (`xScale: "time"`, `x: "t"`)
  + Metric via `$template` + DataTable/`repeat` rows — then ONE canvas_live call
  streams data in forever. See references/live-data.md.
- **Options comparison**: Heading → Grid columns 2–3, one Card per option
  (Badge verdict, Metric cost, bullet Markdown) → Callout recommendation.
- **Interactive form / mini-app**: seed `state` → Inputs with `$bindState` → live
  preview via `$template` → Button `on.press` → `canvas.submit`. See
  references/interactivity.md.

## Layout discipline

Outer `Stack` gap `lg`; ONE `Heading` level h1; metric tiles in `Grid` columns 3–4
(never stacked full-width); comparisons in `Grid` 2–3; charts and tables full-width.
Never nest a Metric inside a Card (it is already a tile). Never put a Table/DataTable
inside a Card (it draws its own surface).
