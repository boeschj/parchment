// Google A2UI (a2ui.org, Apache-2.0), v1.0.
//
// The strongest JSON rival in the matrix, and it is strong for a specific reason:
// its component encoding is materially LEANER than json-render's for the same
// information. Props sit inline on the component object — {"id":"t","component":
// "Text","text":"hi"} — where json-render writes {"type":"Text","props":{"text":
// "hi"},"children":[]}. If "JSON is verbose" were the whole story, A2UI would not
// exist. It is the arm most likely to beat us on the control scenarios, and it is
// meant to be.
//
// WHAT IT IS GIVEN, EXACTLY:
//   - a CUSTOM catalog (evals/catalog/a2ui-catalog.ts). Its basic catalog has no
//     Chart and no Table, so the basic catalog would have failed the charting
//     tasks for reasons that are not its format's. Custom catalogs are what their
//     own spec tells production users to build.
//   - their DEFAULT_WORKFLOW_RULES, verbatim except for the one rule that is about
//     their chat transport rather than their format (see below).
//   - the real v1.0 envelope: createSurface / updateComponents / updateDataModel.
//   - an explicit instruction to MINIFY. This matters: we have publicly criticised
//     OpenUI for benchmarking a competitor's JSON pretty-printed, and an arm that
//     emitted `JSON.stringify(x, null, 2)` here would be losing 40% of its tokens
//     to whitespace by OUR omission. Every JSON arm in this matrix is minified.
//
// WHAT IT DOES NOT GET, BECAUSE THE FORMAT DOES NOT HAVE IT: any way to name
// content instead of carrying it. Verified, not assumed — an exhaustive search of
// the v1.0 schema set (server_to_client.json, common_types.json, catalog.json) for
// uri|url|src|resource|dataSource|fetch|lazy|endpoint|remote returns exactly four
// hits, and all four are media: Image.url, Video.url, AudioPlayer.url, and
// openUrl's argument. Text, numbers and table rows must be emitted by the model,
// inline, into the data model. That absence is A2UI's finding, and we did not
// impose it.

import { ArmId, AuthoringSurface, Fidelity, type Arm, type EvalScenario } from "../types.ts";
import { renderA2uiCatalog } from "../catalog/a2ui-catalog.ts";
import { buildRepairPrompt } from "./repair-prompt.ts";
import { PASTE_ONLY_INSTRUCTION, buildTaskPrompt } from "./task-encoding.ts";

export const A2UI_VERSION = "v1.0";
export const A2UI_SURFACE_ID = "canvas";

// Their DEFAULT_WORKFLOW_RULES (a2ui_agent/src/a2ui/schema/constants.py), verbatim
// but for the first two bullets, which govern how a block is delimited inside a
// CHAT MESSAGE ("wrap each block in <a2ui-json> tags", "conversational text may
// surround them"). We author into a tool call, not a chat message, so those two
// are replaced by the transport rule below and nothing else is touched. The rule
// that matters — top-down ordering, root first, parents before children — is
// theirs and is reproduced word for word.
const WORKFLOW_RULES = [
  "# Workflow",
  "",
  "The generated response MUST follow these rules:",
  "- The response MUST be a single, raw JSON array of A2UI messages.",
  "- Top-Down Component Ordering: Within the `components` list of a message:",
  "    - The 'root' component MUST be the FIRST element.",
  "    - Parent components MUST appear before their child components.",
  "    This specific ordering allows the streaming parser to yield and render the UI",
  "    incrementally as it arrives.",
].join("\n");

const WIRE_FORMAT = [
  "# Wire format",
  "",
  `A2UI ${A2UI_VERSION}. You emit a JSON array of envelope messages. Each message carries a`,
  '"version" and exactly one of "createSurface", "updateComponents" or "updateDataModel".',
  "",
  "The UI is a FLAT list of components. The tree is built from ID references: a container",
  'names its children by id. Exactly one component must have "id": "root".',
  "",
  "Props sit INLINE on the component object — there is no props wrapper:",
  '  {"id":"title","component":"Heading","text":"Error rate","level":"h2"}',
  "",
  "A component may bind a prop to the data model instead of carrying a literal, by giving it",
  "a JSON Pointer into the data model:",
  '  {"id":"tbl","component":"DataTable","rows":{"path":"/results"}}',
  "The data model is populated by YOU, with updateDataModel:",
  '  {"version":"v1.0","updateDataModel":{"surfaceId":"canvas","path":"/results","value":[…]}}',
  "",
  "A complete stream:",
  '  [{"version":"v1.0","createSurface":{"surfaceId":"canvas","catalogId":"parchment"}},',
  '   {"version":"v1.0","updateComponents":{"surfaceId":"canvas","components":[',
  '     {"id":"root","component":"Card","title":"Errors","children":["c"]},',
  '     {"id":"c","component":"Chart","kind":"bar","data":{"path":"/points"},"x":"bucket","y":"count"}]}},',
  '   {"version":"v1.0","updateDataModel":{"surfaceId":"canvas","path":"/points",',
  '     "value":[{"bucket":"09:00","count":0},{"bucket":"09:10","count":1}]}}]',
].join("\n");

// The minification rule. We caught a rival benchmarking a competitor's JSON at
// `JSON.stringify(x, null, 2)` and called it dishonest; shipping this arm without
// this line would be the same act, committed against a rival, in our own favour.
const OUTPUT_RULES = [
  "# Output",
  "",
  "Send the message array to the canvas_render tool as { title, markup }. The `markup`",
  "argument carries the JSON array as text.",
  "",
  "- MINIFIED. One line, no indentation, no whitespace between tokens.",
  "- The array and nothing else: no prose, no markdown fences.",
].join("\n");

const SYSTEM_PROMPT = [WIRE_FORMAT, WORKFLOW_RULES, renderA2uiCatalog(), OUTPUT_RULES].join("\n\n");

export const a2uiArm: Arm = {
  id: ArmId.A2ui,
  // Low, and not by our choice: A2UI has no mechanism to name content it does not
  // carry. The rung is a property of the format, verified against its schema.
  fidelity: Fidelity.Low,
  surface: AuthoringSurface.CanvasTool,
  systemPrompt: SYSTEM_PROMPT,
  // The same closing paragraph the other paste-only arms get, word for word.
  encodeTask: (scenario: EvalScenario) => buildTaskPrompt(scenario, PASTE_ONLY_INSTRUCTION),
  repairPrompt: buildRepairPrompt,
};
