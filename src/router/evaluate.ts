import { routeVisual } from "./route.ts";
import { VisualRoute, type RouteInput, type VisualRoute as VisualRouteType } from "./types.ts";

type ManifestRow = {
  id: string;
  expected: VisualRouteType;
  input: RouteInput;
};

const manifestPath = Bun.argv[2];
if (!manifestPath) {
  process.stderr.write("Usage: bun run src/router/evaluate.ts <manifest.jsonl>\n");
  process.exit(2);
}

const source = await Bun.file(manifestPath).text();
const rows = source
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line, index) => parseRow(line, index + 1));

const routeCounts = new Map<string, number>();
const mismatches: Array<{
  id: string;
  expected: VisualRouteType;
  actual: VisualRouteType;
  reason: string;
}> = [];

for (const row of rows) {
  const decision = routeVisual(row.input);
  const transition = `${row.expected} -> ${decision.route}`;
  routeCounts.set(transition, (routeCounts.get(transition) ?? 0) + 1);
  if (decision.route !== row.expected) {
    mismatches.push({
      id: row.id,
      expected: row.expected,
      actual: decision.route,
      reason: decision.reason,
    });
  }
}

const passed = rows.length - mismatches.length;
process.stdout.write(`${JSON.stringify({
  manifest: manifestPath,
  total: rows.length,
  passed,
  accuracy: rows.length === 0 ? 0 : Number((passed / rows.length).toFixed(4)),
  transitions: Object.fromEntries([...routeCounts].sort(([left], [right]) => left.localeCompare(right))),
  mismatches,
}, null, 2)}\n`);

if (mismatches.length > 0) process.exitCode = 1;

function parseRow(line: string, lineNumber: number): ManifestRow {
  const value = JSON.parse(line) as Partial<ManifestRow>;
  if (typeof value.id !== "string" || value.id.length === 0) throw new Error(`Line ${lineNumber}: id must be a non-empty string.`);
  if (!isVisualRoute(value.expected)) throw new Error(`Line ${lineNumber}: expected is not a visual route.`);
  if (typeof value.input !== "object" || value.input === null) throw new Error(`Line ${lineNumber}: input must be a RouteInput object.`);
  return { id: value.id, expected: value.expected, input: value.input as RouteInput };
}

function isVisualRoute(value: unknown): value is VisualRouteType {
  return typeof value === "string" && Object.values(VisualRoute).includes(value as VisualRouteType);
}
