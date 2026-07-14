// The acceptance module's public surface.
//
// One call decides whether a run counts as a correct render:
//
//   const browser = await createAcceptanceBrowser();
//   const result = await acceptArtifact({
//     scenarioId: "status-dashboard",
//     artifact: { kind: ArtifactKind.ParchmentCanvas, canvasUrl },   // or
//     artifact: { kind: ArtifactKind.HtmlFile, filePath },
//     screenshotPath: "…/run-01.png",
//     browser,
//   });
//   result.passed   // ← the headline metric's definition of "correct"
//   result.reasons  // ← why not, in sentences, with observed values
//   result.domFacts // ← the evidence, archived per run
//   await browser.close();
//
// Any harness can import this: the old CLI runner, the SDK-driven matrix, or a
// one-off replay of an archived spec. It takes a URL or a file path and returns
// a verdict — it knows nothing about models, tokens, prompts, or arms.

import { createAcceptanceBrowser, type AcceptanceBrowser, type FormInteraction } from "./browser.ts";
import { evaluateAssertions } from "./checks.ts";
import { acceptanceSpecFor } from "./specs.ts";
import { AssertionKind, type AcceptanceResult, type AcceptanceSpec, type Artifact } from "./types.ts";

export { createAcceptanceBrowser, type AcceptanceBrowser } from "./browser.ts";
export { ACCEPTANCE_SPECS, acceptanceSpecFor } from "./specs.ts";
export { evaluateAssertions } from "./checks.ts";
export {
  ArtifactKind,
  AssertionKind,
  ContentRoot,
  type AcceptanceResult,
  type AcceptanceSpec,
  type Artifact,
  type Assertion,
  type DomFacts,
} from "./types.ts";

export type AcceptArtifactInput = {
  scenarioId: string;
  artifact: Artifact;
  screenshotPath: string;
  // Reuse one chromium across a matrix. Omit it and one is launched and closed
  // for this single call.
  browser?: AcceptanceBrowser;
};

export async function acceptArtifact(input: AcceptArtifactInput): Promise<AcceptanceResult> {
  const spec = acceptanceSpecFor(input.scenarioId);
  const ownsBrowser = input.browser === undefined;
  const browser = input.browser ?? (await createAcceptanceBrowser());

  try {
    const domFacts = await browser.probe(
      input.artifact,
      input.screenshotPath,
      formInteractionFor(spec),
    );
    const reasons = evaluateAssertions([...spec.assertions], domFacts);
    return {
      scenarioId: spec.scenarioId,
      passed: reasons.length === 0,
      reasons,
      screenshotPath: input.screenshotPath,
      domFacts,
    };
  } finally {
    if (ownsBrowser) await browser.close();
  }
}

// A scenario that asserts validation needs the driver to actually drive the
// form; every other scenario is a passive read of the painted page.
function formInteractionFor(spec: AcceptanceSpec): FormInteraction | undefined {
  const assertion = spec.assertions.find(
    (candidate) => candidate.kind === AssertionKind.FormValidation,
  );
  if (!assertion || assertion.kind !== AssertionKind.FormValidation) return undefined;
  return { invalidFills: assertion.invalidFills, submitButtonText: assertion.submitButtonText };
}
