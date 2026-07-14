// One self-contained React component file. JSX is as top-of-distribution as a
// format gets, so this is the strongest version of "the model already knows the
// syntax, why invent one" — with the same structural ceiling as raw HTML: a
// component the model writes by hand has no way to name a file and have someone
// else fetch it.

import { ArmId, type Arm } from "../types.ts";
import { createWrittenFileArm } from "./written-file-arm.ts";

export const RAW_JSX_OUTPUT_FILE = "Page.tsx";

const SYSTEM_PROMPT = [
  "# Rendering",
  "",
  `Write ONE self-contained React component file to ${RAW_JSX_OUTPUT_FILE} with the Write`,
  "tool. It is compiled and mounted in a browser.",
  "",
  "# Constraints",
  "",
  "- Default-export one React component that takes no props.",
  "- React is available. Nothing else is: no component libraries, no chart libraries, no CDN",
  "  scripts, no external stylesheets, no remote images, no fetching.",
  "- Everything the page needs — markup, styles, data — must be inside the file.",
].join("\n");

export const rawJsxArm: Arm = createWrittenFileArm({
  id: ArmId.RawJsx,
  outputFile: RAW_JSX_OUTPUT_FILE,
  systemPrompt: SYSTEM_PROMPT,
});
