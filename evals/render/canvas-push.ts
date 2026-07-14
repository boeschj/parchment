// The one push. Both the eval's canvas MCP server (what the model calls at RUN
// time) and the materializer (what re-renders the artifact for the browser at
// MEASURE time) go through this function, so the two cannot drift apart — and
// neither can drift from the product, because this is the same
// POST /api/sessions/<id>/slots that src/daemon/canvas-client.ts makes.
//
// THE cwd IS LOAD-BEARING AND IS NOT AN IMPLEMENTATION DETAIL. Reference
// hydration runs in the DAEMON, at push time, against the session's cwd
// (src/daemon/server.ts) — that is where {$diff}/{$csv}/{$log} become bytes, and
// where the root confinement that stops a model reading /etc/passwd is enforced.
// A push without a cwd hydrates against nothing. The eval therefore hands the
// daemon the run's own working directory, which is where the fixtures were
// copied and where the model's "repo/src/server.ts" actually resolves.
//
// The daemon's refusal comes back as an ISSUE LIST, never an exception: an
// unresolvable reference is the arm's own toolchain telling it what it got
// wrong, and it feeds the repair loop verbatim (evals/repair.ts).

import { SlotKind, SlotOrigin, type JsonRenderSpec } from "../../src/shared/types.ts";

const TOKEN_HEADER = "x-canvas-token";
const PUSH_TIMEOUT_MS = 30_000;
const ERROR_DETAIL_LIMIT = 600;

export type PushSpecInput = {
  baseUrl: string;
  token: string;
  sessionId: string;
  // The directory the spec's reference paths resolve against, and the root the
  // daemon confines them to.
  cwd: string;
  kind: SlotKind;
  title: string;
  spec: JsonRenderSpec;
  slotId?: string | undefined;
};

export type PushSpecResult =
  | { ok: true; slotId: string }
  | { ok: false; issues: readonly string[] };

export async function pushSpecToDaemon(input: PushSpecInput): Promise<PushSpecResult> {
  const response = await fetchSlotPush(input);
  if (response instanceof Error) return { ok: false, issues: [response.message] };

  if (!response.ok) {
    return { ok: false, issues: await daemonIssuesOf(response) };
  }

  const payload = (await response.json()) as { slot?: { id?: string } };
  return { ok: true, slotId: payload.slot?.id ?? "unknown" };
}

async function fetchSlotPush(input: PushSpecInput): Promise<Response | Error> {
  try {
    return await fetch(`${input.baseUrl}/api/sessions/${encodeURIComponent(input.sessionId)}/slots`, {
      method: "POST",
      headers: { "content-type": "application/json", [TOKEN_HEADER]: input.token },
      body: JSON.stringify({
        kind: input.kind,
        title: input.title,
        cwd: input.cwd,
        spec: input.spec,
        origin: SlotOrigin.McpTool,
        ...(input.slotId === undefined ? {} : { slotId: input.slotId }),
      }),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    return new Error(`the canvas daemon did not answer the push: ${detail}`);
  }
}

// The daemon answers a bad push with {error, message}, and the message is where
// a failed reference explains itself ("reference hydration failed: - elements/…").
// That text is the arm's error signal, so it is preserved rather than summarized.
async function daemonIssuesOf(response: Response): Promise<readonly string[]> {
  const body = await response.text();
  const message = parseDaemonMessage(body);
  if (message === null) {
    return [`the canvas daemon refused the slot (${response.status}): ${body.slice(0, ERROR_DETAIL_LIMIT)}`];
  }
  return splitBulletedIssues(message);
}

function parseDaemonMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    return typeof parsed.message === "string" ? parsed.message : null;
  } catch {
    return null;
  }
}

const ISSUE_BULLET = "- ";

// "reference hydration failed:\n- a\n- b" is a headline plus a list. The repair
// loop wants the list.
function splitBulletedIssues(message: string): readonly string[] {
  const bulleted = message
    .split("\n")
    .filter((line) => line.startsWith(ISSUE_BULLET))
    .map((line) => line.slice(ISSUE_BULLET.length));

  if (bulleted.length === 0) return [message];
  return bulleted;
}

export { SlotKind };
