import { describe, it, expect, beforeAll } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareSpec } from "../spec-validation.ts";
import { compileMarkup } from "../markup/index.ts";
import {
  DataTableAlign,
  DataTableColumnType,
} from "../../shared/catalog/extensions/DataTable.ts";
import type { JsonRenderSpec } from "../../shared/types.ts";
import { parseLineRange, resolveReferencePath } from "./paths.ts";
import { dataTableColumnsFromCsv } from "./columns.ts";
import { parseCsv } from "./csv.ts";
import { resolveCsvReference, resolveFileReference, resolveImgReference } from "./resolve.ts";
import { resolveDiffSides } from "./git.ts";
import { allowBlobPath, buildBlobUrl, serveBlob } from "./blob.ts";
import { hydrateSpec, HydrationMode } from "./index.ts";

const FIXTURES = join(import.meta.dir, "__fixtures__");
const LINES_TXT = join(FIXTURES, "lines.txt");
const RESULTS_CSV = join(FIXTURES, "results.csv");
const APP_LOG = join(FIXTURES, "app.log");

const stubBlobUrl = (absPath: string): string => buildBlobUrl(absPath, "test-token");

function tmpDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

function tmpFile(name: string, contents: string | Buffer): string {
  const path = join(tmpDir("hydrate-fix-"), name);
  writeFileSync(path, contents);
  return path;
}

// A throwaway git repo that doubles as a session cwd: one committed file that
// then diverges in the working tree, plus the text and CSV fixtures copied in
// (root confinement means every reference must live under the session cwd).
type Workspace = { cwd: string; filePath: string; relPath: string };

async function makeWorkspace(): Promise<Workspace> {
  const cwd = tmpDir("hydrate-git-");
  const run = (args: string[]): Promise<void> =>
    Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "ignore" }).exited.then(
      () => undefined,
    );
  await run(["init"]);
  await run(["config", "user.email", "t@t.co"]);
  await run(["config", "user.name", "t"]);
  const relPath = "app.ts";
  const filePath = join(cwd, relPath);
  writeFileSync(filePath, "export const version = 1;\n");
  await run(["add", relPath]);
  await run(["commit", "-m", "init"]);
  writeFileSync(filePath, "export const version = 2;\nexport const flag = true;\n");

  writeFileSync(join(cwd, "lines.txt"), readFileSync(LINES_TXT, "utf8"));
  writeFileSync(join(cwd, "results.csv"), readFileSync(RESULTS_CSV, "utf8"));
  writeFileSync(join(cwd, "app.log"), readFileSync(APP_LOG, "utf8"));
  return { cwd, filePath, relPath };
}

describe("parseLineRange", () => {
  it("parses A-B, A, A-, and -B forms inclusively", () => {
    expect(parseLineRange("2-4")).toEqual({ ok: true, range: { start: 2, end: 4 } });
    expect(parseLineRange("5")).toEqual({ ok: true, range: { start: 5, end: 5 } });
    expect(parseLineRange("3-")).toEqual({
      ok: true,
      range: { start: 3, end: Number.POSITIVE_INFINITY },
    });
    expect(parseLineRange("-4")).toEqual({ ok: true, range: { start: 1, end: 4 } });
  });

  it("rejects a backwards or unparseable range", () => {
    expect(parseLineRange("9-2").ok).toBe(false);
    expect(parseLineRange("nonsense").ok).toBe(false);
  });
});

describe("root confinement", () => {
  it("resolves a relative path against the session cwd", () => {
    const cwd = tmpDir("confine-");
    writeFileSync(join(cwd, "a.txt"), "hi\n");
    const result = resolveReferencePath(cwd, "a.txt");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.absPath).toBe(join(cwd, "a.txt"));
  });

  it("rejects an absolute path outside the session root", () => {
    const cwd = tmpDir("confine-");
    const outside = tmpFile("secret.txt", "nope\n");
    const result = resolveReferencePath(cwd, outside);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("outside the session root");
  });

  it("rejects a traversal that climbs out of the root", () => {
    const cwd = tmpDir("confine-");
    const result = resolveReferencePath(cwd, "../../etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("outside the session root");
  });

  it("rejects a symlink inside the root that points outside it", () => {
    const cwd = tmpDir("confine-");
    const outside = tmpFile("target.txt", "secret\n");
    const link = join(cwd, "innocent.txt");
    symlinkSync(outside, link);
    const result = resolveReferencePath(cwd, "innocent.txt");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("outside the session root");
  });

  it("rejects any path when the session has no cwd", () => {
    const result = resolveReferencePath("", "/etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no session working directory");
  });
});

describe("resolveFileReference", () => {
  it("returns the whole file with no range", () => {
    const result = resolveFileReference(LINES_TXT, null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.split("\n")[0]).toBe("line one");
  });

  it("applies a 1-based inclusive line range", () => {
    const result = resolveFileReference(LINES_TXT, "2-4");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("line two\nline three\nline four");
  });

  it("errors on a missing file", () => {
    const result = resolveFileReference(join(FIXTURES, "does-not-exist.txt"), null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no file at");
  });

  it("rejects a binary file and points at $img", () => {
    const binary = tmpFile("blob.bin", Buffer.from([0x00, 0x01, 0x02, 0x00, 0x03]));
    const result = resolveFileReference(binary, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("$img");
  });

  it("rejects an oversize file and suggests a line range", () => {
    const big = tmpFile("big.txt", "x".repeat(600 * 1024));
    const result = resolveFileReference(big, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("line range");
  });
});

describe("parseCsv + resolveCsvReference", () => {
  it("parses quoted fields and coerces numeric cells", () => {
    const parsed = parseCsv('a,b\n"x, y",42\n');
    expect(parsed.columns).toEqual(["a", "b"]);
    expect(parsed.rows).toEqual([{ a: "x, y", b: 42 }]);
  });

  it("reads the fixture CSV into typed rows", () => {
    const result = resolveCsvReference(RESULTS_CSV, null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rows).toHaveLength(3);
      expect(result.value.rows[0]).toEqual({ name: "Alpha", score: 91, note: "fast, stable" });
    }
  });

  it("caps rows and notes the truncation, keeping the header of the rows it kept", () => {
    const body = Array.from({ length: 20 }, (_, i) => String(i)).join("\n");
    const csv = tmpFile("many.csv", `n\n${body}\n`);
    const result = resolveCsvReference(csv, 5);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rows).toHaveLength(5);
      expect(result.value.columns).toEqual(["n"]);
      expect(result.note).toContain("capped to 5 of 20");
    }
  });
});

// The CSV header IS the table's shape. This is what lets a model write
// `<DataTable src="results.csv"/>` for a file it has never opened: it names the
// file, and the daemon — which reads it — supplies the columns.
describe("dataTableColumnsFromCsv", () => {
  it("derives a column per header cell, in file order, keyed as the rows are keyed", () => {
    const columns = dataTableColumnsFromCsv(parseCsv("name,note\nAlpha,fast\n"));
    expect(columns).toEqual([
      { key: "name", header: "name" },
      { key: "note", header: "note" },
    ]);
  });

  // parseCsv already coerced numeric cells to numbers; a column whose cells all
  // came back numbers sorts numerically and sits right-aligned — exactly what a
  // hand-authored DataTable would say about it.
  it("types and right-aligns the columns whose cells parsed as numbers", () => {
    const columns = dataTableColumnsFromCsv(parseCsv("name,score\nAlpha,91\nBravo,84\n"));
    expect(columns[1]).toEqual({
      key: "score",
      header: "score",
      type: DataTableColumnType.Number,
      align: DataTableAlign.Right,
    });
  });

  // A version string ("1.10.2") and an id ("r001") are not numbers; neither is a
  // column that is empty everywhere.
  it("leaves a mixed, non-numeric, or empty column as a plain string column", () => {
    const columns = dataTableColumnsFromCsv(parseCsv("id,version,blank\nr001,1.10.2,\n"));
    expect(columns).toEqual([
      { key: "id", header: "id" },
      { key: "version", header: "version" },
      { key: "blank", header: "blank" },
    ]);
  });
});

describe("resolveDiffSides", () => {
  let workspace: Workspace;
  beforeAll(async () => {
    workspace = await makeWorkspace();
  });

  it("returns HEAD content as before and the working tree as after", async () => {
    const result = await resolveDiffSides(workspace.cwd, workspace.filePath, workspace.relPath, {
      base: null,
      staged: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sides.before).toBe("export const version = 1;\n");
      expect(result.sides.after).toContain("version = 2");
      expect(result.sides.file).toBe(workspace.relPath);
    }
  });

  it("errors outside a git repository", async () => {
    const notRepo = tmpDir("hydrate-nogit-");
    const filePath = join(notRepo, "x.ts");
    writeFileSync(filePath, "hi\n");
    const result = await resolveDiffSides(notRepo, filePath, "x.ts", { base: null, staged: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not a git repository");
  });

  // THE ONE-SIDED DIFF. The repo used to be resolved from the session's cwd, so a
  // file living in a repo BELOW cwd—a submodule or vendored checkout—was looked
  // up in the OUTER repo, where its path
  // does not exist at any revision. `git show` failed, the failure was read as
  // "the file is new, so it has no before", and the DiffViewer rendered with a
  // BLANK before side. No error, half a diff.
  //
  // A model seeing the one-sided render reasonably abandoned the reference and
  // pasted the whole file, making the failure both incorrect and expensive.
  it("resolves the repo from the FILE, so a nested repo below cwd still diffs both sides", async () => {
    const outer = tmpDir("hydrate-outer-");
    const outerRun = (args: string[]): Promise<void> =>
      Bun.spawn(["git", ...args], { cwd: outer, stdout: "ignore", stderr: "ignore" }).exited.then(
        () => undefined,
      );
    // cwd is itself a git repo — the outer one — and the file lives in an inner
    // repo underneath it. This is a submodule, in miniature.
    await outerRun(["init"]);
    await outerRun(["config", "user.email", "t@t.t"]);
    await outerRun(["config", "user.name", "t"]);
    writeFileSync(join(outer, "outer.txt"), "outer\n");
    await outerRun(["add", "."]);
    await outerRun(["commit", "-m", "outer"]);

    const inner = await makeWorkspace();
    const nestedPath = join(outer, "vendored");
    symlinkSync(inner.cwd, nestedPath);

    const filePath = join(nestedPath, inner.relPath);
    const result = await resolveDiffSides(outer, filePath, `vendored/${inner.relPath}`, {
      base: null,
      staged: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both sides, from the INNER repo's history — not an empty string from the
    // outer repo, which has never heard of this path.
    expect(result.sides.before).toBe("export const version = 1;\n");
    expect(result.sides.after).toContain("version = 2");
  });
});

describe("$img blob route", () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  it("resolves to a token-bearing blob url", () => {
    const png = tmpFile("shot.png", PNG);
    const result = resolveImgReference(png, (p) => buildBlobUrl(p, "secret"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("/api/blob?path=");
      expect(result.value).toContain("token=secret");
    }
  });

  it("serves a hydrated image with a sniffed content-type", async () => {
    const png = tmpFile("shot.png", PNG);
    allowBlobPath(png);
    const response = await serveBlob(new URL(`http://localhost${buildBlobUrl(png, "secret")}`), "secret");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  });

  it("rejects a wrong token", async () => {
    const png = tmpFile("shot.png", PNG);
    allowBlobPath(png);
    const response = await serveBlob(new URL(`http://localhost${buildBlobUrl(png, "wrong")}`), "secret");
    expect(response.status).toBe(401);
  });

  // The token alone must not be an arbitrary-file read: only paths a $img
  // reference actually hydrated are servable.
  it("refuses a valid-token request for a path that was never hydrated", async () => {
    const unhydrated = tmpFile("private.png", PNG);
    const response = await serveBlob(
      new URL(`http://localhost${buildBlobUrl(unhydrated, "secret")}`),
      "secret",
    );
    expect(response.status).toBe(403);
  });

  it("404s a missing file", async () => {
    const response = await serveBlob(
      new URL(`http://localhost${buildBlobUrl("/no/such/file.png", "secret")}`),
      "secret",
    );
    expect(response.status).toBe(404);
  });
});

describe("hydrateSpec — golden: $file + $diff + $csv", () => {
  it("rewrites props to $state, seeds /hydrated, and prepares to a valid spec", async () => {
    const workspace = await makeWorkspace();
    const spec: JsonRenderSpec = {
      root: "page",
      elements: {
        page: { type: "Stack", props: {}, children: ["snippet", "change", "table"] },
        snippet: {
          type: "CodeBlock",
          props: { code: { $file: "lines.txt", lines: "2-4" }, language: "text", title: "lines.txt" },
          children: [],
        },
        change: { type: "DiffViewer", props: { $diff: "app.ts" }, children: [] },
        table: {
          type: "DataTable",
          props: {
            rows: { $csv: "results.csv" },
            columns: [
              { key: "name", header: "Name" },
              { key: "score", header: "Score", type: "number" },
            ],
          },
          children: [],
        },
      },
    };

    const result = await hydrateSpec({ spec, cwd: workspace.cwd, buildBlobUrl: stubBlobUrl });
    expect(result.errors).toEqual([]);

    const hydrated = result.spec.state?.hydrated as Record<string, unknown>;
    expect(hydrated["snippet__code"]).toBe("line two\nline three\nline four");
    expect(hydrated["change__eldiff"]).toMatchObject({ before: "export const version = 1;\n" });
    expect(hydrated["table__rows"]).toHaveLength(3);

    expect(result.spec.elements.snippet!.props.code).toEqual({ $state: "/hydrated/snippet__code" });
    expect(result.spec.elements.change!.props.before).toEqual({
      $state: "/hydrated/change__eldiff/before",
    });
    expect(result.spec.elements.change!.props).not.toHaveProperty("$diff");
    expect(result.spec.elements.table!.props.rows).toEqual({ $state: "/hydrated/table__rows" });

    // Every plain reference is a snapshot, stamped with a hash + capture time.
    const meta = result.spec.state?.hydratedMeta as Record<string, { mode: string; hash: string }>;
    expect(meta["snippet__code"]!.mode).toBe(HydrationMode.Snapshot);
    expect(meta["snippet__code"]!.hash).toMatch(/^[0-9a-f]{16}$/);

    const prepared = prepareSpec(result.spec);
    expect(prepared.issues).toEqual([]);
  });

  it("marks a {watch:true} reference live and emits a reference-refresh source", async () => {
    const workspace = await makeWorkspace();
    const spec: JsonRenderSpec = {
      root: "change",
      elements: {
        change: { type: "DiffViewer", props: { $diff: "app.ts", watch: true }, children: [] },
      },
    };
    const result = await hydrateSpec({ spec, cwd: workspace.cwd, buildBlobUrl: stubBlobUrl });
    expect(result.errors).toEqual([]);
    expect(result.watchSources).toHaveLength(1);
    expect(result.watchSources[0]).toMatchObject({
      kind: "reference-refresh",
      statePath: "/hydrated/change__eldiff",
    });
    const meta = result.spec.state?.hydratedMeta as Record<string, { mode: string }>;
    expect(meta["change__eldiff"]!.mode).toBe(HydrationMode.Live);
  });

  // The real MCP path is prepareSpec (in the MCP process) THEN hydrateSpec (in
  // the daemon). autoFixSpec relocates a `watch` key out of props to the
  // element level, so a $diff watch flag authored as a sibling prop arrives at
  // the daemon in a different place than it was written. If the hydrator only
  // read props.watch, the killer feature would silently degrade to a snapshot.
  it("still registers a watcher when the spec has been through prepareSpec first", async () => {
    const workspace = await makeWorkspace();
    const authored: JsonRenderSpec = {
      root: "change",
      elements: {
        change: { type: "DiffViewer", props: { $diff: "app.ts", watch: true }, children: [] },
      },
    };
    const prepared = prepareSpec(authored);
    expect(prepared.issues).toEqual([]);
    // Precondition: autoFixSpec really did move the flag out of props.
    expect(prepared.spec.elements.change!.props.watch).toBeUndefined();

    const result = await hydrateSpec({
      spec: prepared.spec,
      cwd: workspace.cwd,
      buildBlobUrl: stubBlobUrl,
    });
    expect(result.errors).toEqual([]);
    expect(result.watchSources).toHaveLength(1);

    const meta = result.spec.state?.hydratedMeta as Record<string, { mode: string }>;
    expect(meta["change__eldiff"]!.mode).toBe(HydrationMode.Live);
    // The relocated flag must not survive as an invalid element-level watch map.
    expect(result.spec.elements.change!.watch).toBeUndefined();
  });

  // The gap this closed: a Chart whose data, x and y are ALL facts about a file
  // the model never opened. It writes the question; the daemon writes the answer.
  it("fills a Chart's data, x and y from an aggregated $log", async () => {
    const workspace = await makeWorkspace();
    const compiled = compileMarkup(
      '<section><LogStream file="app.log" match="ERROR" groupBy="10m"/></section>',
    );
    expect(compiled.issues).toEqual([]);
    // Validation runs BEFORE hydration and must not report x/y missing — it
    // reads the same PropValueReferences contract the hydrator fills them from.
    const prepared = prepareSpec(compiled.spec);
    expect(prepared.issues).toEqual([]);

    const result = await hydrateSpec({
      spec: prepared.spec,
      cwd: workspace.cwd,
      buildBlobUrl: stubBlobUrl,
    });
    expect(result.errors).toEqual([]);

    const chart = result.spec.elements["chart-0"]!;
    expect(chart.props.data).toEqual({ $state: "/hydrated/chart_0__data" });
    expect(chart.props.x).toEqual({ $state: "/hydrated/chart_0__x" });
    expect(chart.props.y).toEqual({ $state: "/hydrated/chart_0__y" });

    const hydrated = result.spec.state?.hydrated as Record<string, unknown>;
    expect(hydrated["chart_0__x"]).toBe("bucket");
    expect(hydrated["chart_0__y"]).toBe("count");
    expect(hydrated["chart_0__data"]).toEqual([
      { bucket: "09:00", count: 1 },
      { bucket: "09:10", count: 0 },
      { bucket: "09:20", count: 2 },
    ]);
  });

  // A watched $log re-aggregates the whole file, and the series list is itself a
  // fact about the file — a level that first appears after the push has to grow
  // a line of its own, so it gets a source of its own.
  it("watches an aggregated $log, refreshing both the rows and the series list", async () => {
    const workspace = await makeWorkspace();
    const compiled = compileMarkup(
      '<section><LogStream file="app.log" groupBy="10m" pattern="\\s(?<level>ERROR|WARN)\\s" series="level" watch/></section>',
    );
    expect(compiled.issues).toEqual([]);
    const result = await hydrateSpec({
      spec: compiled.spec,
      cwd: workspace.cwd,
      buildBlobUrl: stubBlobUrl,
    });
    expect(result.errors).toEqual([]);

    const hydrated = result.spec.state?.hydrated as Record<string, unknown>;
    expect(hydrated["chart_0__y"]).toEqual(["ERROR", "WARN"]);

    expect(result.watchSources).toHaveLength(2);
    expect(result.watchSources).toEqual([
      expect.objectContaining({
        statePath: "/hydrated/chart_0__data",
        target: expect.objectContaining({ kind: "log", select: "rows" }),
      }),
      expect.objectContaining({
        statePath: "/hydrated/chart_0__y",
        target: expect.objectContaining({ kind: "log", select: "seriesKeys" }),
      }),
    ]);

    const meta = result.spec.state?.hydratedMeta as Record<string, { mode: string }>;
    expect(meta["chart_0__data"]!.mode).toBe(HydrationMode.Live);
  });

  it("rejects the push when the log cannot answer the question asked of it", async () => {
    const workspace = await makeWorkspace();
    const spec: JsonRenderSpec = {
      root: "chart",
      elements: {
        chart: {
          type: "Chart",
          props: { kind: "line", data: { $log: "app.log", groupBy: "ten minutes" } },
          children: [],
        },
      },
    };
    const result = await hydrateSpec({ spec, cwd: workspace.cwd, buildBlobUrl: stubBlobUrl });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("elements/chart/props/data");
    expect(result.errors[0]).toContain("is not an interval");
  });

  // Root confinement is a property of the reference mechanism, not of any one
  // kind: a $log gets the same answer a $file does.
  it("refuses a $log outside the session root", async () => {
    const workspace = await makeWorkspace();
    const spec: JsonRenderSpec = {
      root: "chart",
      elements: {
        chart: {
          type: "Chart",
          props: { kind: "line", data: { $log: "../escape.log", groupBy: "10m" } },
          children: [],
        },
      },
    };
    const result = await hydrateSpec({ spec, cwd: workspace.cwd, buildBlobUrl: stubBlobUrl });
    expect(result.errors[0]).toContain("resolves outside the session root");
  });

  it("collects a precise error for a missing $file", async () => {
    const cwd = tmpDir("hydrate-missing-");
    const spec: JsonRenderSpec = {
      root: "snippet",
      elements: {
        snippet: { type: "CodeBlock", props: { code: { $file: "missing.ts" } }, children: [] },
      },
    };
    const result = await hydrateSpec({ spec, cwd, buildBlobUrl: stubBlobUrl });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("elements/snippet/props/code");
    expect(result.errors[0]).toContain("no file at");
  });

  it("enforces a per-slot hydration budget across references", async () => {
    const cwd = tmpDir("hydrate-budget-");
    const chunk = "y".repeat(500 * 1024);
    for (let index = 0; index < 5; index += 1) {
      writeFileSync(join(cwd, `part${index}.txt`), chunk);
    }
    const elements: JsonRenderSpec["elements"] = {
      page: { type: "Stack", props: {}, children: [] },
    };
    for (let index = 0; index < 5; index += 1) {
      elements[`c${index}`] = {
        type: "CodeBlock",
        props: { code: { $file: `part${index}.txt` } },
        children: [],
      };
    }
    const result = await hydrateSpec({
      spec: { root: "page", elements },
      cwd,
      buildBlobUrl: stubBlobUrl,
    });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join("\n")).toContain("per-slot budget");
  });
});

// The flagship reference form, end to end on the path canvas_render takes:
// prepareSpec (which must NOT ask for a `columns` array the model cannot write)
// then hydrateSpec (which must supply it from the file it read). The model wrote
// one attribute; the table it gets back is fully shaped.
describe("hydrateSpec — a $csv supplies DataTable's columns", () => {
  it("compiles, validates and hydrates <DataTable src=…/> into a fully shaped table", async () => {
    const workspace = await makeWorkspace();
    const compiled = compileMarkup('<DataTable src="results.csv" caption="Scores"/>');
    expect(compiled.issues).toEqual([]);

    const prepared = prepareSpec(compiled.spec);
    expect(prepared.issues).toEqual([]);

    const result = await hydrateSpec({
      spec: prepared.spec,
      cwd: workspace.cwd,
      buildBlobUrl: stubBlobUrl,
    });
    expect(result.errors).toEqual([]);

    const table = result.spec.elements.root!;
    expect(table.props.rows).toEqual({ $state: "/hydrated/root__rows" });
    expect(table.props.columns).toEqual({ $state: "/hydrated/root__columns" });

    const hydrated = result.spec.state?.hydrated as Record<string, unknown>;
    expect(hydrated["root__columns"]).toEqual([
      { key: "name", header: "name" },
      { key: "score", header: "score", type: DataTableColumnType.Number, align: DataTableAlign.Right },
      { key: "note", header: "note" },
    ]);
    expect(hydrated["root__rows"]).toHaveLength(3);

    // The hydrated spec is what the browser renders, so it must itself be valid.
    expect(prepareSpec(result.spec).issues).toEqual([]);
  });

  it("never overwrites a columns array the author wrote", async () => {
    const workspace = await makeWorkspace();
    const authored = [{ key: "name", header: "Contender" }];
    const spec: JsonRenderSpec = {
      root: "table",
      elements: {
        table: {
          type: "DataTable",
          props: { rows: { $csv: "results.csv" }, columns: authored },
          children: [],
        },
      },
    };

    const result = await hydrateSpec({ spec, cwd: workspace.cwd, buildBlobUrl: stubBlobUrl });
    expect(result.errors).toEqual([]);
    expect(result.spec.elements.table!.props.columns).toEqual(authored);
  });

  // A Chart fed by the same file takes rows and nothing else: it has no columns
  // to fill, and the contract table is what says so.
  it("supplies nothing to a Chart reading the same csv", async () => {
    const workspace = await makeWorkspace();
    const compiled = compileMarkup('<Chart src="results.csv" kind="bar" x="name" y="score"/>');
    expect(prepareSpec(compiled.spec).issues).toEqual([]);

    const result = await hydrateSpec({
      spec: prepareSpec(compiled.spec).spec,
      cwd: workspace.cwd,
      buildBlobUrl: stubBlobUrl,
    });
    expect(result.errors).toEqual([]);
    expect(result.spec.elements.root!.props.data).toEqual({ $state: "/hydrated/root__data" });
    expect(Object.keys(result.spec.state?.hydrated as Record<string, unknown>)).toEqual([
      "root__data",
    ]);
  });
});
