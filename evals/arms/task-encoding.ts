// The scenario, phrased for an arm.
//
// Every arm gets the SAME facts in the SAME order: the request, the inline data if
// the scenario carries any, the files the task is about. Only the final paragraph
// — how this arm authors, and what it can and cannot do about file content —
// differs, and each of those paragraphs is written to state a capability, never to
// nudge. A prompt that told the high-fidelity arm "prefer references" would be
// telling the model the answer we are trying to measure.

import type { EvalScenario, SourceFile } from "../types.ts";

const TITLE_PREFIX = "Title: ";
const INLINE_DATA_HEADING = "Data:";
const SOURCE_FILES_HEADING = "Files this task is about:";
const BULLET = "- ";

export function buildTaskPrompt(scenario: EvalScenario, authoringInstruction: string): string {
  const sections = [
    scenario.request,
    `${TITLE_PREFIX}${scenario.title}`,
    ...inlineDataSection(scenario.inlineData),
    ...sourceFilesSection(scenario.sourceFiles),
    authoringInstruction,
  ];
  return sections.join("\n\n");
}

function inlineDataSection(inlineData: string | null): readonly string[] {
  if (inlineData === null) return [];
  return [[INLINE_DATA_HEADING, inlineData].join("\n")];
}

function sourceFilesSection(sourceFiles: readonly SourceFile[]): readonly string[] {
  if (sourceFiles.length === 0) return [];
  const bullets = sourceFiles.map(
    (file) => `${BULLET}${file.relativePath} — ${file.description}`,
  );
  return [[SOURCE_FILES_HEADING, ...bullets].join("\n")];
}

// ---- The per-arm closing paragraph ------------------------------------------

// Both rungs are told, in the same words, that they may read the files. They
// differ only in what the RENDERER can do with a path — which is the independent
// variable, and is stated as a fact rather than as advice.

export const PASTE_ONLY_INSTRUCTION =
  "You can read the files above with Read. Nothing on the page can point at a file, so any " +
  "file content you want to show must be included in what you author.";

export const REFERENCE_CAPABLE_INSTRUCTION =
  "You can read the files above with Read. The page can also point at a file: the (reference) " +
  "props in your system prompt take a path, and the daemon reads it at render time.";

export function writtenFileInstruction(outputFile: string): string {
  return (
    `Write ONE self-contained file to ${outputFile}. ` +
    "You can read the files above with Read. Nothing on the page can point at a file, so any " +
    "file content you want to show must be included in what you author."
  );
}
