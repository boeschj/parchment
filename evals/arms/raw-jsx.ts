// One self-contained React component file, WITH A REAL CHART LIBRARY.
//
// This is the arm that asks the question a hostile reader asks first: "what does
// a component catalog actually buy you over just writing the component?" A model
// that may `import { BarChart } from "recharts"` collapses a hand-drawn SVG into
// one element — the single most valuable affordance in the whole matrix, and the
// one most likely to beat us.
//
// SO IT IS GRANTED, DELIBERATELY, AND IT IS THE STRONGER ARM FOR IT. The earlier
// version of this file allowed React and nothing else ("no chart libraries"),
// which measured JSX's syntax cost against a catalog that ships charts — a
// comparison rigged in our favour by omission. recharts is bundled from the
// repo's own node_modules (it is already a parchment dependency, and
// render/materialize.ts builds inside the repo so the resolution works), so the
// no-network rule the raw-html arm lives under is not violated: nothing is
// fetched, the library is compiled into the page.
//
// What it still cannot do is name a file and have someone else fetch it. That is
// the structural ceiling raw-jsx shares with raw-html, and it is the finding —
// not a handicap the eval imposed. recharts makes it cheap to DRAW a chart; it
// does nothing to make it cheap to CARRY the data the chart plots.

import { ArmId, type Arm } from "../types.ts";
import { createWrittenFileArm } from "./written-file-arm.ts";

export const RAW_JSX_OUTPUT_FILE = "Page.tsx";

const SYSTEM_PROMPT = [
  "# Rendering",
  "",
  `Write ONE self-contained React component file to ${RAW_JSX_OUTPUT_FILE} with the Write`,
  "tool. It is compiled and mounted in a browser.",
  "",
  "# In scope",
  "",
  "- `react` — import normally.",
  "- `recharts` — import normally. BarChart, LineChart, AreaChart, PieChart, Pie, Cell,",
  "  Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer.",
  "",
  "# Constraints",
  "",
  "- Default-export one React component that takes no props.",
  "- Nothing else is in scope: no other component libraries, no CDN scripts, no external",
  "  stylesheets, no remote images, no fetching.",
  "- Everything the page needs — markup, styles, data — must be inside the file.",
].join("\n");

export const rawJsxArm: Arm = createWrittenFileArm({
  id: ArmId.RawJsx,
  outputFile: RAW_JSX_OUTPUT_FILE,
  systemPrompt: SYSTEM_PROMPT,
});
