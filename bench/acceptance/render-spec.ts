// Puts a parchment spec back on screen so the browser can judge it.
//
// This is a RENDER path, not a CHECK path. It deliberately reuses the product's
// real pipeline — `prepareSpec` (the same validation + dialect repair
// canvas_render runs, see src/daemon/mcp-stdio.ts) followed by POST /slots —
// because the question a replay must answer is "what did the user actually
// see?", and the user saw the repaired spec. Judging the artifact remains the
// browser's job alone: nothing downstream of here asks parchment whether
// parchment did well.
//
// The acceptance module proper (index/checks/specs/dom-probe) does NOT import
// this file, and must never import prepareSpec. That separation is the whole
// point of the rebuild.

import { prepareSpec } from "../../src/daemon/spec-validation.ts";
import type { JsonRenderSpec } from "../../src/shared/types.ts";

const TOKEN_HEADER = "x-canvas-token";

export const RenderOutcome = {
  Rendered: "rendered",
  // Today's prepareSpec raised issues AND the caller asked us to honour them —
  // i.e. canvas_render would have bounced this spec back to the model instead
  // of painting it. A rejected spec never reaches a browser at all, which is a
  // different failure from "painted, but painted wrong".
  RejectedByValidation: "rejected-by-validation",
  // The daemon refused the POST (e.g. unresolvable intent bindings).
  RejectedByDaemon: "rejected-by-daemon",
} as const;

export type RenderOutcome = (typeof RenderOutcome)[keyof typeof RenderOutcome];

export type RenderSpecInput = {
  daemonBaseUrl: string;
  daemonToken: string;
  sessionId: string;
  title: string;
  spec: JsonRenderSpec;
  state?: Record<string, unknown>;
  // Replay of an ARCHIVED run sets this false: that spec was accepted by the
  // validation of its day and the user really did see it painted, so refusing
  // to render it now — because validation has since been hardened — would
  // silently convert "we shipped a broken chart" into "no data". We render it
  // anyway and let the browser tell the truth. `validationIssues` still records
  // what today's validation thinks, so both facts get reported.
  // A live harness run sets this true, mirroring canvas_render exactly.
  honourValidationIssues: boolean;
};

export type RenderSpecResult = {
  outcome: RenderOutcome;
  // What today's prepareSpec said. Recorded for the report; never consulted to
  // decide acceptance.
  validationIssues: string[];
  repairs: string[];
  canvasUrl: string | null;
  error: string | null;
};

export async function renderSpecToDaemon(input: RenderSpecInput): Promise<RenderSpecResult> {
  const { spec: preparedSpec, issues, repairs } = prepareSpec(input.spec);

  if (input.honourValidationIssues && issues.length > 0) {
    return {
      outcome: RenderOutcome.RejectedByValidation,
      validationIssues: issues,
      repairs,
      canvasUrl: null,
      error: issues.join("; "),
    };
  }

  const response = await fetch(
    `${input.daemonBaseUrl}/api/sessions/${encodeURIComponent(input.sessionId)}/slots`,
    {
      method: "POST",
      headers: { "content-type": "application/json", [TOKEN_HEADER]: input.daemonToken },
      body: JSON.stringify({
        kind: "render",
        title: input.title,
        spec: preparedSpec,
        ...(input.state !== undefined ? { state: input.state } : {}),
      }),
    },
  );

  if (!response.ok) {
    return {
      outcome: RenderOutcome.RejectedByDaemon,
      validationIssues: issues,
      repairs,
      canvasUrl: null,
      error: `POST /slots ${response.status}: ${(await response.text()).slice(0, 300)}`,
    };
  }

  return {
    outcome: RenderOutcome.Rendered,
    validationIssues: issues,
    repairs,
    canvasUrl: `${input.daemonBaseUrl}/?session=${encodeURIComponent(input.sessionId)}`,
    error: null,
  };
}
