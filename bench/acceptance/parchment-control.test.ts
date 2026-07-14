// THE POSITIVE CONTROL.
//
// The replay of the archived suite (bench/acceptance/replay.ts) finds that 23 of
// 24 previously-"passing" parchment runs do not actually render their data. The
// first thing a hostile reader should ask is: "is your rubric even POSSIBLE for
// parchment to pass, or did you just build a machine that fails your own arm?"
//
// This test answers that. It hand-writes a CORRECT parchment spec for every one
// of the six scenarios — correct meaning "uses the props the catalog actually
// declares" — renders each through the product's real pipeline into a real
// daemon, and judges it with the exact same acceptance specs the HTML arm faces.
//
// All six must pass. If they do, then every archived failure is a failure of the
// SPEC THE MODEL WROTE, not of the rubric. If one of these ever starts failing,
// either the product regressed or the rubric became unsatisfiable — and both are
// things we want a red test for.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { createServer } from "node:net";
import { startBenchDaemon, type BenchDaemon } from "../daemon-harness.ts";
import { acceptArtifact, createAcceptanceBrowser, type AcceptanceBrowser } from "./index.ts";
import { renderSpecToDaemon, RenderOutcome } from "./render-spec.ts";
import { ArtifactKind } from "./types.ts";

const SCREENSHOT_DIR = join(import.meta.dir, "..", ".runs", "parchment-control");
const FIRST_CONTROL_PORT = 7866;

let daemon: BenchDaemon;
let browser: AcceptanceBrowser;

beforeAll(async () => {
  daemon = await startBenchDaemon({ port: await findFreePort(FIRST_CONTROL_PORT) });
  browser = await createAcceptanceBrowser();
});

afterAll(async () => {
  await browser.close();
  await daemon.stop();
});

// Renders a correct spec the way canvas_render does, then judges the painted
// page the way every arm is judged.
async function renderAndJudge(scenarioId: string, spec: unknown) {
  const sessionId = `control-${scenarioId}`;
  const rendered = await renderSpecToDaemon({
    daemonBaseUrl: daemon.baseUrl,
    daemonToken: daemon.token,
    sessionId,
    title: scenarioId,
    spec: spec as never,
    // A control spec must be clean under the product's own validation too: if it
    // is not, the test fails loudly here rather than quietly measuring a
    // repaired artifact.
    honourValidationIssues: true,
  });

  expect(rendered.validationIssues).toEqual([]);
  expect(rendered.outcome).toBe(RenderOutcome.Rendered);
  expect(rendered.canvasUrl).not.toBeNull();

  return acceptArtifact({
    scenarioId,
    artifact: { kind: ArtifactKind.ParchmentCanvas, canvasUrl: rendered.canvasUrl! },
    screenshotPath: join(SCREENSHOT_DIR, `${scenarioId}.png`),
    browser,
  });
}

const WEEKDAY_SERIES = [
  { day: "Mon", mins: 12, deploys: 3 },
  { day: "Tue", mins: 8, deploys: 5 },
  { day: "Wed", mins: 15, deploys: 2 },
  { day: "Thu", mins: 9, deploys: 6 },
  { day: "Fri", mins: 20, deploys: 4 },
  { day: "Sat", mins: 7, deploys: 7 },
  { day: "Sun", mins: 11, deploys: 3 },
];

describe("the rubric is satisfiable by parchment on every scenario", () => {
  test("status-dashboard", async () => {
    const result = await renderAndJudge("status-dashboard", {
      root: "page",
      elements: {
        page: { type: "Stack", props: { gap: "lg" }, children: ["kpis", "bar", "line"] },
        kpis: { type: "Grid", props: { columns: 3, gap: "md" }, children: ["m1", "m2", "m3"] },
        m1: { type: "Metric", props: { label: "Build Pass Rate", value: "94%" }, children: [] },
        m2: { type: "Metric", props: { label: "Avg Build Time", value: "4m12s" }, children: [] },
        m3: { type: "Metric", props: { label: "Open Incidents", value: "2" }, children: [] },
        bar: {
          type: "Chart",
          props: { kind: "bar", title: "Build duration (min)", data: WEEKDAY_SERIES, x: "day", y: ["mins"] },
          children: [],
        },
        line: {
          type: "Chart",
          props: { kind: "line", title: "Deploys per day", data: WEEKDAY_SERIES, x: "day", y: ["deploys"] },
          children: [],
        },
      },
    });
    expect(result.reasons).toEqual([]);
    expect(result.passed).toBe(true);
  });

  test("csv-data-table", async () => {
    const result = await renderAndJudge("csv-data-table", {
      root: "table",
      elements: {
        table: {
          type: "DataTable",
          props: {
            caption: "Tickets closed",
            columns: [
              { key: "name", header: "Name" },
              { key: "role", header: "Role" },
              { key: "tickets", header: "Tickets closed", type: "number" },
            ],
            rows: [
              { name: "Ada Lovelace", role: "Engineer", tickets: 42 },
              { name: "Grace Hopper", role: "Engineer", tickets: 58 },
              { name: "Alan Turing", role: "Lead", tickets: 31 },
              { name: "Margaret Hamilton", role: "Manager", tickets: 19 },
            ],
          },
          children: [],
        },
      },
    });
    expect(result.reasons).toEqual([]);
    expect(result.passed).toBe(true);
  });

  test("architecture-diagram", async () => {
    // `source`, not `code` — the prop every archived run got wrong.
    const result = await renderAndJudge("architecture-diagram", {
      root: "diagram",
      elements: {
        diagram: {
          type: "MermaidEditor",
          props: {
            title: "Three-tier architecture",
            source: "graph TD\n  Client[Client] --> API[API]\n  API --> Database[(Database)]",
          },
          children: [],
        },
      },
    });
    expect(result.reasons).toEqual([]);
    expect(result.passed).toBe(true);
  });

  test("incident-report", async () => {
    // Callout takes tone/body (not variant/text); Steps takes items (not steps);
    // Markdown takes content (not text). Every archived run got all three wrong.
    const result = await renderAndJudge("incident-report", {
      root: "page",
      elements: {
        page: { type: "Stack", props: { gap: "lg" }, children: ["title", "verdict", "timeline", "actions"] },
        title: { type: "Heading", props: { text: "Incident Report", level: "h1" }, children: [] },
        verdict: {
          type: "Callout",
          props: {
            tone: "danger",
            title: "Verdict",
            body: "Checkout API returned 500s for 12 minutes due to a database connection pool exhaustion.",
          },
          children: [],
        },
        timeline: {
          type: "Steps",
          props: {
            items: [
              { title: "14:02", description: "Deploy raised connection pool size to 5." },
              { title: "14:10", description: "Traffic spike exhausted the pool." },
              { title: "14:12", description: "Alerts fired." },
              { title: "14:14", description: "Pool size reverted." },
              { title: "14:14", description: "Recovered." },
            ],
          },
          children: [],
        },
        actions: {
          type: "Markdown",
          props: {
            content:
              "## Action items\n\n1. Raise the default connection pool size.\n2. Add a pool-exhaustion alert.",
          },
          children: [],
        },
      },
    });
    expect(result.reasons).toEqual([]);
    expect(result.passed).toBe(true);
  });

  test("validated-form", async () => {
    // parchment expresses validation with `checks`, not with HTML5 `required` /
    // `minlength` attributes — which is precisely why the rubric asserts the
    // BEHAVIOUR (does the form refuse bad input?) rather than the markup.
    const result = await renderAndJudge("validated-form", {
      root: "form",
      state: { form: { name: "", email: "", password: "" } },
      elements: {
        form: { type: "Stack", props: { gap: "md" }, children: ["title", "name", "email", "password", "submit"] },
        title: { type: "Heading", props: { text: "Sign up", level: "h2" }, children: [] },
        name: {
          type: "Input",
          props: {
            label: "Name",
            name: "name",
            value: { $bindState: "/form/name" },
            checks: [{ type: "required", message: "Name is required" }],
            // "blur", NOT "submit". Measured: `validateOn: "submit"` never fires
            // when the submit Button is wired to canvas.submit — the checks
            // silently never run and the form accepts anything (see the product
            // bugs listed in docs/benchmarks.md). "blur" and "change" both work.
            // The control uses a trigger that works, to prove the rubric is
            // SATISFIABLE by parchment; whether a model picks a working trigger
            // on its own is what the benchmark measures.
            validateOn: "blur",
          },
          children: [],
        },
        email: {
          type: "Input",
          props: {
            label: "Email",
            name: "email",
            type: "email",
            value: { $bindState: "/form/email" },
            checks: [
              { type: "required", message: "Email is required" },
              { type: "email", message: "Enter a valid email" },
            ],
            // "blur", NOT "submit". Measured: `validateOn: "submit"` never fires
            // when the submit Button is wired to canvas.submit — the checks
            // silently never run and the form accepts anything (see the product
            // bugs listed in docs/benchmarks.md). "blur" and "change" both work.
            // The control uses a trigger that works, to prove the rubric is
            // SATISFIABLE by parchment; whether a model picks a working trigger
            // on its own is what the benchmark measures.
            validateOn: "blur",
          },
          children: [],
        },
        password: {
          type: "Input",
          props: {
            label: "Password",
            name: "password",
            type: "password",
            value: { $bindState: "/form/password" },
            checks: [
              { type: "required", message: "Password is required" },
              { type: "minLength", value: 8, message: "Password must be at least 8 characters" },
            ],
            // "blur", NOT "submit". Measured: `validateOn: "submit"` never fires
            // when the submit Button is wired to canvas.submit — the checks
            // silently never run and the form accepts anything (see the product
            // bugs listed in docs/benchmarks.md). "blur" and "change" both work.
            // The control uses a trigger that works, to prove the rubric is
            // SATISFIABLE by parchment; whether a model picks a working trigger
            // on its own is what the benchmark measures.
            validateOn: "blur",
          },
          children: [],
        },
        submit: {
          type: "Button",
          props: { label: "Sign up" },
          on: { press: { action: "canvas.submit" } },
          children: [],
        },
      },
    });
    expect(result.reasons).toEqual([]);
    expect(result.passed).toBe(true);
  });

  test("live-log-dashboard", async () => {
    const result = await renderAndJudge("live-log-dashboard", {
      root: "page",
      state: {
        series: [
          { minute: "1", errors: 2 },
          { minute: "2", errors: 3 },
          { minute: "3", errors: 1 },
          { minute: "4", errors: 4 },
          { minute: "5", errors: 2 },
        ],
      },
      elements: {
        page: { type: "Stack", props: { gap: "lg" }, children: ["chart", "logs"] },
        chart: {
          type: "Chart",
          props: {
            kind: "line",
            title: "Errors per minute",
            data: { $state: "/series" },
            x: "minute",
            y: ["errors"],
          },
          children: [],
        },
        logs: {
          type: "DataTable",
          props: {
            caption: "Recent log lines",
            columns: [
              { key: "level", header: "Level" },
              { key: "message", header: "Message" },
            ],
            rows: [
              { level: "ERROR", message: "db timeout" },
              { level: "WARN", message: "slow query 800ms" },
              { level: "INFO", message: "cache cleared" },
            ],
          },
          children: [],
        },
      },
    });
    expect(result.reasons).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

async function findFreePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 40; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`no free port found in [${startPort}, ${startPort + 40})`);
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}
