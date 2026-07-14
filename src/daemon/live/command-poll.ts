// command-poll source: run a USER-APPROVED command on an interval and pump its
// stdout into slot state. Bounded: interval floor enforced upstream, one run in
// flight at a time, hard timeout, output cap, child killed on stop.
//
// SECURITY: the command text is agent-supplied, so it is not run on the agent's
// authority. The engine refuses to start an unapproved source, and runOnce()
// re-checks approval immediately before every spawn — the check that matters is
// the one sitting next to the syscall, because that is the one no future
// refactor of the engine can accidentally bypass.

import { applySourceValue } from "./apply.ts";
import { isCommandApproved } from "./approved-commands.ts";
import { parsePolledText } from "./parse.ts";
import type { SlotStatePump } from "./pump.ts";
import type { CommandPollSourceConfig, SourceErrorReporter } from "./types.ts";

const COMMAND_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_CHARS = 1024 * 1024;
const SHELL_PATH = "/bin/sh";

// A command of bare words — no quoting, no metacharacters, no substitution —
// splits into argv unambiguously on spaces. Anything outside this alphabet
// (a pipe, a redirect, a quote, a $) means the user wrote something only a
// shell can interpret.
const BARE_WORD_COMMAND = /^[A-Za-z0-9_@:=+.,/-]+(?: [A-Za-z0-9_@:=+.,/-]+)*$/;

// The spawn vector for an approved command.
//
// SECURITY: nothing is ever concatenated into this. The string handed to the
// shell is byte-for-byte the string the user read in the approval prompt and
// whose sha256 is in the approval store — no interpolation of slot state, user
// content, app output, or any other value crosses into it. Dashboard one-liners
// are overwhelmingly pipelines (`ps aux | grep -c node`), so a shell is a real
// requirement, not a convenience; commands that do not need one skip it.
export function commandSpawnArgs(command: string): string[] {
  const needsShell = !BARE_WORD_COMMAND.test(command);
  if (needsShell) return [SHELL_PATH, "-c", command];
  return command.split(" ");
}

export function startCommandPoll(
  sessionId: string,
  config: CommandPollSourceConfig,
  pump: SlotStatePump,
  reportError: SourceErrorReporter,
): () => void {
  let currentChild: ReturnType<typeof Bun.spawn> | null = null;
  let stopped = false;

  async function runOnce(): Promise<void> {
    if (stopped || currentChild) return;
    if (!isCommandApproved(sessionId, config.command)) {
      reportError("command is not approved — refusing to run it");
      return;
    }
    try {
      const child = Bun.spawn(commandSpawnArgs(config.command), {
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
