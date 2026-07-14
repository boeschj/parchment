// One self-contained HTML file. The format with the lowest possible protocol cost
// — the model needs no catalog because it already knows HTML — and no way
// whatsoever to reference a file. Both halves of that trade are the finding.

import { ArmId, type Arm } from "../types.ts";
import { createWrittenFileArm } from "./written-file-arm.ts";

export const RAW_HTML_OUTPUT_FILE = "page.html";

const SYSTEM_PROMPT = [
  "# Rendering",
  "",
  `Write ONE self-contained HTML file to ${RAW_HTML_OUTPUT_FILE} with the Write tool. It is`,
  "opened directly in a browser.",
  "",
  "# Constraints",
  "",
  "- The page loads with no network access: no CDN scripts, no external stylesheets, no",
  "  remote images, no fonts, no fetching.",
  "- Everything the page needs — markup, styles, scripts, data — must be inside the file.",
].join("\n");

export const rawHtmlArm: Arm = createWrittenFileArm({
  id: ArmId.RawHtml,
  outputFile: RAW_HTML_OUTPUT_FILE,
  systemPrompt: SYSTEM_PROMPT,
});
