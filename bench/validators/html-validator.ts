// Ground truth for the HTML arm: does the written file actually contain the
// structural elements the scenario asked for? Deliberately regex-based rather
// than a full DOM parse — the harness stays dependency-free, and every
// requirement here is a simple "does this tag/text appear at least N times"
// check, which a full parser would not make any more reliable.

import { readFileSync } from "node:fs";
import type { HtmlRequirement } from "../scenarios/types.ts";
import type { ValidationResult } from "../types.ts";

export function validateHtmlFile(filePath: string, requirements: HtmlRequirement[]): ValidationResult {
  const html = readFileSync(filePath, "utf8");
  return validateHtml(html, requirements);
}

export function validateHtml(html: string, requirements: HtmlRequirement[]): ValidationResult {
  const reasons = requirements.flatMap((requirement) => {
    const matchCount = countMatches(html, requirement.pattern);
    if (matchCount >= requirement.minimumMatches) return [];
    return [
      `${requirement.description}: expected >= ${requirement.minimumMatches} match(es), found ${matchCount}`,
    ];
  });

  return { passed: reasons.length === 0, reasons };
}

function countMatches(html: string, pattern: RegExp): number {
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  return [...html.matchAll(globalPattern)].length;
}
