// command-poll source: run an agent-supplied shell command on an interval and
// pump its stdout into slot state. Same trust level as the agent's own Bash
// access — but bounded anyway: interval floor enforced upstream, one run in
// flight at a time, hard timeout, output cap, child killed on stop.

import { applySourceValue } from "./apply.ts";
import { parsePolledText } from "./parse.ts";
import type { SlotStatePump } from "./pump.ts";
import type { CommandPollSourceConfig, SourceErrorReporter } from "./types.ts";

const COMMAND_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_CHARS = 1024 * 1024;

export function startCommandPoll(
  config: CommandPollSourceConfig,
  pump: SlotStatePump,
  reportError: SourceErrorReporter,
): () => void {
  let currentChild: ReturnType<typeof Bun.spawn> | null = null;
  let stopped = false;

  async function runOnce(): Promise<void> {
    if (stopped || currentChild) return;
    try {
      const child = Bun.spawn(["/bin/sh", "-c", config.command], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
      });
      currentChild = child;
      const killTimer = setTimeout(() => child.kill(), COMMAND_TIMEOUT_MS);
      const stdout = await new Response(child.stdout).text();
      await child.exited;
      clearTimeout(killTimer);
      currentChild = null;
      if (stopped) return;

      const outcome = parsePolledText(stdout.slice(0, MAX_OUTPUT_CHARS));
      if (!outcome.ok) {
        reportError("command produced no output");
        return;
      }
      applySourceValue(pump, config, outcome.value);
      reportError(null);
    } catch (caught) {
      currentChild = null;
      reportError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  void runOnce();
  const timer = setInterval(() => void runOnce(), config.intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
    currentChild?.kill();
  };
}
