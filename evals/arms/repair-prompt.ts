// The repair turn, phrased identically for every arm.
//
// This module exists so that it is IMPOSSIBLE to hand a parchment arm a hint an
// HTML arm does not get. Every arm's repairPrompt is literally this function, so
// the only thing that varies between arms is the CONTENT of the signal — the
// markup compiler's issues, the spec validator's issues, the browser's console
// errors — never the framing, never the coaching.
//
// `missingFromPage` is derived only from failed rubric assertions, so it says no
// more than a human would learn by looking at the page.

import type { RepairSignal } from "../types.ts";

const HEADLINE = "The page you rendered was not accepted.";
const TOOLCHAIN_HEADING = "Your toolchain reported:";
const MISSING_HEADING = "The page is missing:";
const CLOSING = "Fix these and render again.";
const BULLET = "- ";

export function buildRepairPrompt(signal: RepairSignal): string {
  const sections = [
    HEADLINE,
    ...bulletedSection(TOOLCHAIN_HEADING, signal.toolchainIssues),
    ...bulletedSection(MISSING_HEADING, signal.missingFromPage),
    CLOSING,
  ];
  return sections.join("\n\n");
}

function bulletedSection(heading: string, items: readonly string[]): readonly string[] {
  if (items.length === 0) return [];
  const bullets = items.map((item) => `${BULLET}${item}`);
  return [[heading, ...bullets].join("\n")];
}
