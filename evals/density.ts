// FORMAT DENSITY: how many bytes, and roughly how many tokens, one canonical
// correct artifact costs in each arm's notation. Static — no model is ever
// called from this file.
//
// WHY this table exists even though it is where parchment probably LOSES: a
// terse format (raw HTML, terse JSON) can and should win on pure notation
// density. Hiding that would be dishonest, and it is also unnecessary — the
// total-cost tables make the argument, because density is a per-character
// property while the fidelity ladder is a per-ELEMENT property. A format that
// spells a diff in 20% fewer characters still has to spell the whole diff.
//
// WHY the token counts are approximate: there is no tokenizer available on this
// machine's path (subscription-only Claude Code, no Console API key, no local
// BPE dependency), so exact model tokenization cannot be run offline. Bytes are
// EXACT and lead every table. Token columns are approximations, labelled as
// such everywhere they are printed, and no headline claim rests on them — the
// headline uses measured output tokens from the run transcripts.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { EvalPaths } from "./config.ts";
import { ArmId, type AttemptRecord, type RunRecord } from "./types.ts";

const TEXT_ENCODING = "utf8";

export const DEFAULT_REFERENCE_ARTIFACTS_DIR = join(EvalPaths.fixtures, "artifacts");

// ---- The approximation, stated in full ---------------------------------------

// Average characters a BPE tokenizer packs into one word piece. Common English
// words and common code identifiers land at 3-5 characters per piece; 4 is the
// figure the published rule-of-thumb uses.
const CHARS_PER_WORD_PIECE = 4;
// Indentation runs merge into single tokens in every modern BPE vocabulary
// (a 4-space indent is typically one token), so a run of spaces is not counted
// one-token-per-space.
const CHARS_PER_INDENT_TOKEN = 4;
// A lone space is absorbed into the piece that follows it ("␣the" is one token),
// so it must not be counted separately.
const TOKENS_PER_ABSORBED_SPACE = 0;
const TOKENS_PER_NEWLINE = 1;
const TOKENS_PER_SYMBOL = 1;
const BYTES_PER_TOKEN_RULE_OF_THUMB = 4;

const WORD_RUN = /[A-Za-z0-9_]+/y;
const WHITESPACE_RUN = /\s+/y;

export const TOKEN_APPROXIMATION = {
  label: "approx.",
  method:
    "Character-class segmentation. Word runs ([A-Za-z0-9_]+) cost ceil(length/4) tokens; a " +
    "lone space costs 0 (BPE absorbs it into the following piece); a run of 2+ spaces costs " +
    "ceil(length/4); each newline costs 1; every other character (punctuation, brackets, " +
    "operators, non-Latin) costs 1. The bytes/4 rule-of-thumb is printed beside it as a " +
    "second, cruder approximation so a reader can see how sensitive the number is to method.",
  knownError:
    "Against a real BPE tokenizer this typically lands within ~10-20% on JSON/HTML/JSX/markup. " +
    "It OVER-counts punctuation-dense text (real tokenizers merge sequences like `\");` or " +
    "`\",` into one token) and UNDER-counts unusual long identifiers, base64, and non-Latin " +
    "text (which split into more pieces than length/4). Bytes/4 errs the other way on markup. " +
    "Neither is exact, and no claim in this report depends on either: the headline numbers are " +
    "measured output tokens from the run transcripts, which are exact.",
} as const;

export function countBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function approximateTokensBySegmentation(text: string): number {
  let tokenCount = 0;
  let cursor = 0;

  while (cursor < text.length) {
    const wordRunLength = matchRunLength(WORD_RUN, text, cursor);
    if (wordRunLength > 0) {
      tokenCount += Math.ceil(wordRunLength / CHARS_PER_WORD_PIECE);
      cursor += wordRunLength;
      continue;
    }

    const whitespaceRunLength = matchRunLength(WHITESPACE_RUN, text, cursor);
    if (whitespaceRunLength > 0) {
      const whitespaceRun = text.slice(cursor, cursor + whitespaceRunLength);
      tokenCount += countWhitespaceTokens(whitespaceRun);
      cursor += whitespaceRunLength;
      continue;
    }

    tokenCount += TOKENS_PER_SYMBOL;
    cursor += 1;
  }

  return tokenCount;
}

export function approximateTokensByBytes(text: string): number {
  return Math.ceil(countBytes(text) / BYTES_PER_TOKEN_RULE_OF_THUMB);
}

function countWhitespaceTokens(whitespaceRun: string): number {
  const newlines = [...whitespaceRun].filter((character) => character === "\n");
  const horizontalRun = whitespaceRun.replace(/\n/g, "");
  const isLoneSpace = horizontalRun.length === 1;
  const horizontalTokens = isLoneSpace
    ? TOKENS_PER_ABSORBED_SPACE
    : Math.ceil(horizontalRun.length / CHARS_PER_INDENT_TOKEN);

  return newlines.length * TOKENS_PER_NEWLINE + horizontalTokens;
}

function matchRunLength(pattern: RegExp, text: string, cursor: number): number {
  pattern.lastIndex = cursor;
  const match = pattern.exec(text);
  if (!match) return 0;
  const [matched] = match;
  return matched.length;
}

// ---- Measurements ------------------------------------------------------------

export const ArtifactOrigin = {
  // A hand-written canonical artifact checked into the fixtures tree. Preferred:
  // it needs no runs, so `density` is reproducible at zero spend.
  ReferenceFile: "reference-file",
  // Pulled from the archive: the artifact of the accepted attempt of a real run.
  AcceptedRun: "accepted-run",
} as const;

export type ArtifactOrigin = (typeof ArtifactOrigin)[keyof typeof ArtifactOrigin];

export type ArtifactMeasurement = {
  armId: ArmId;
  scenarioId: string;
  origin: ArtifactOrigin;
  // Exact. This is the column that leads.
  bytes: number;
  approximateTokens: number;
  approximateTokensByBytesRule: number;
};

export function measureArtifact(params: {
  armId: ArmId;
  scenarioId: string;
  origin: ArtifactOrigin;
  source: string;
}): ArtifactMeasurement {
  return {
    armId: params.armId,
    scenarioId: params.scenarioId,
    origin: params.origin,
    bytes: countBytes(params.source),
    approximateTokens: approximateTokensBySegmentation(params.source),
    approximateTokensByBytesRule: approximateTokensByBytes(params.source),
  };
}

// Layout: <directory>/<scenarioId>/<armId>.<any extension>. Returns an empty
// list when the directory does not exist, so `density` degrades to the archive
// rather than throwing at a reader who has not written reference artifacts.
export function loadReferenceArtifacts(
  directory: string = DEFAULT_REFERENCE_ARTIFACTS_DIR,
): ArtifactMeasurement[] {
  if (!directoryExists(directory)) return [];

  const scenarioDirectories = readdirSync(directory, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory(),
  );

  return scenarioDirectories.flatMap((scenarioDirectory) => {
    const scenarioPath = join(directory, scenarioDirectory.name);
    const artifactFiles = readdirSync(scenarioPath, { withFileTypes: true }).filter((entry) =>
      entry.isFile(),
    );

    return artifactFiles.map((artifactFile) =>
      measureReferenceFile(scenarioDirectory.name, join(scenarioPath, artifactFile.name)),
    );
  });
}

function measureReferenceFile(scenarioId: string, filePath: string): ArtifactMeasurement {
  const fileStem = basename(filePath, extname(filePath));
  const armId = toArmId(fileStem);
  if (!armId) {
    throw new Error(
      `reference artifact ${filePath} is named for an unknown arm "${fileStem}" — ` +
        "a mislabelled file would silently drop out of the density table",
    );
  }

  return measureArtifact({
    armId,
    scenarioId,
    origin: ArtifactOrigin.ReferenceFile,
    source: readFileSync(filePath, TEXT_ENCODING),
  });
}

// The canonical artifact for a cell, taken from the archive: the accepted
// attempt of the cheapest passing run (fewest attempts, then fewest output
// tokens, then lowest replicate). Deterministic, so two readers regenerating
// the report from the same archive get the same density table.
export function collectCanonicalArtifacts(records: readonly RunRecord[]): ArtifactMeasurement[] {
  const bestRunByCell = new Map<string, RunRecord>();

  for (const record of records) {
    if (!record.passed) continue;
    if (!findAcceptedArtifact(record)) continue;

    const cellKey = `${record.armId}::${record.scenarioId}`;
    const incumbent = bestRunByCell.get(cellKey);
    if (!incumbent || isCheaperRun(record, incumbent)) {
      bestRunByCell.set(cellKey, record);
    }
  }

  return [...bestRunByCell.values()].flatMap((record) => {
    const source = findAcceptedArtifact(record);
    if (!source) return [];

    return [
      measureArtifact({
        armId: record.armId,
        scenarioId: record.scenarioId,
        origin: ArtifactOrigin.AcceptedRun,
        source,
      }),
    ];
  });
}

function findAcceptedArtifact(record: RunRecord): string | null {
  const acceptedAttempt = record.attempts.find((attempt) => attempt.accepted && attempt.artifact);
  return acceptedAttempt?.artifact?.source ?? null;
}

function isCheaperRun(candidate: RunRecord, incumbent: RunRecord): boolean {
  const candidateAttempts = candidate.attempts.length;
  const incumbentAttempts = incumbent.attempts.length;
  if (candidateAttempts !== incumbentAttempts) return candidateAttempts < incumbentAttempts;

  const candidateOutput = totalOutputTokens(candidate);
  const incumbentOutput = totalOutputTokens(incumbent);
  if (candidateOutput !== incumbentOutput) return candidateOutput < incumbentOutput;

  return candidate.replicate < incumbent.replicate;
}

function totalOutputTokens(record: RunRecord): number {
  return record.attempts.reduce(
    (runningTotal: number, attempt: AttemptRecord) => runningTotal + attempt.outputTokens,
    0,
  );
}

// ---- Auditing the approximation ----------------------------------------------

// A sanity band, not a calibration factor. For single-attempt accepted runs the
// artifact is the bulk of what the model emitted, so approximated artifact
// tokens should come in a little UNDER the measured output tokens (the model
// also emits prose and tool-call scaffolding). A ratio above 1.0 would mean the
// approximation is inflating artifacts, and a reader deserves to see that.
export type ApproximationAudit = {
  runsCompared: number;
  meanRatioToMeasuredOutput: number;
  minRatio: number;
  maxRatio: number;
};

export function auditApproximationAgainstTranscripts(
  records: readonly RunRecord[],
): ApproximationAudit | null {
  const ratios = records.flatMap((record) => {
    const isSingleAttemptPass = record.passed && record.attempts.length === 1;
    if (!isSingleAttemptPass) return [];

    const [attempt] = record.attempts;
    if (!attempt?.artifact) return [];
    if (attempt.outputTokens <= 0) return [];

    const approximateTokens = approximateTokensBySegmentation(attempt.artifact.source);
    return [approximateTokens / attempt.outputTokens];
  });

  const [firstRatio, ...remainingRatios] = ratios;
  if (firstRatio === undefined) return null;

  const allRatios = [firstRatio, ...remainingRatios];
  const total = allRatios.reduce((runningTotal, ratio) => runningTotal + ratio, 0);

  return {
    runsCompared: allRatios.length,
    meanRatioToMeasuredOutput: total / allRatios.length,
    minRatio: Math.min(...allRatios),
    maxRatio: Math.max(...allRatios),
  };
}

// ---- Internals ---------------------------------------------------------------

function toArmId(value: string): ArmId | null {
  const knownArmIds = Object.values(ArmId);
  return knownArmIds.find((armId) => armId === value) ?? null;
}

function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
