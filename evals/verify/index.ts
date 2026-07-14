// Acceptance, composed: paint the artifact in a real browser, then judge the
// painted result against the scenario's rubric. Nothing between those two steps
// consults parchment's spec schema, its validators, or prepareSpec — the whole
// point of the rebuild is that our own validator never gets a vote on whether
// our own output was good.

import {
  AssertionKind,
  type AcceptanceResult,
  type AcceptanceSpec,
  type Artifact,
  type FormValidationAssertion,
} from "../../bench/acceptance/types.ts";
import { probeArtifact, type InvalidSubmitRequest, type ProbeOptions } from "./browser.ts";
import { evaluateAssertions } from "./checks.ts";

export { closeBrowser, openBrowser, probeArtifact } from "./browser.ts";
export { evaluateAssertions } from "./checks.ts";

const UNSAFE_FILENAME_CHARS = /[^a-zA-Z0-9._-]+/g;
const FILENAME_SEPARATOR = "-";

export type CheckAcceptanceOptions = {
  screenshotDir: string;
};

export async function checkAcceptance(
  artifact: Artifact,
  spec: AcceptanceSpec,
  options: CheckAcceptanceOptions,
): Promise<AcceptanceResult> {
  const { facts, screenshotPath } = await probeArtifact(artifact, probeOptionsFor(spec, options));
  const reasons = evaluateAssertions(facts, spec.assertions);

  return {
    scenarioId: spec.scenarioId,
    passed: reasons.length === 0,
    reasons,
    screenshotPath,
    domFacts: facts,
  };
}

// A FormValidation assertion is the one assertion the browser cannot answer by
// looking: the page has to be USED before it can be judged. The spec is what
// tells the driver which nonsense to type, so it is read here and nowhere else.
function probeOptionsFor(spec: AcceptanceSpec, options: CheckAcceptanceOptions): ProbeOptions {
  const baseOptions: ProbeOptions = {
    screenshotDir: options.screenshotDir,
    screenshotName: toScreenshotName(spec.scenarioId),
  };

  const invalidSubmit = invalidSubmitRequestFor(spec);
  if (invalidSubmit === null) return baseOptions;

  return { ...baseOptions, invalidSubmit };
}

function invalidSubmitRequestFor(spec: AcceptanceSpec): InvalidSubmitRequest | null {
  const formValidation = spec.assertions.find(isFormValidationAssertion);
  if (formValidation === undefined) return null;

  return {
    invalidFills: formValidation.invalidFills,
    submitButtonText: formValidation.submitButtonText,
  };
}

function isFormValidationAssertion(assertion: AcceptanceSpec["assertions"][number]): assertion is FormValidationAssertion {
  return assertion.kind === AssertionKind.FormValidation;
}

function toScreenshotName(scenarioId: string): string {
  return scenarioId.replace(UNSAFE_FILENAME_CHARS, FILENAME_SEPARATOR);
}
