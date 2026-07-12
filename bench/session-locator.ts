// Finds the session JSONL a `claude -p --session-id <uuid>` run just wrote.
//
// Claude Code stores transcripts at ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl,
// where the cwd-encoding scheme is undocumented and has drifted before (see
// @boeschj/claude-jsonl's own corpus-survey comment). Rather than reimplement
// that encoding and risk silent drift, this searches every project directory
// for a file named exactly `<session-id>.jsonl` — the session id is a UUID we
// generated ourselves, so an exact filename match is unambiguous regardless
// of how the cwd happens to be encoded.

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

export class SessionJsonlNotFoundError extends Error {
  constructor(sessionId: string) {
    super(
      `no session JSONL found for session id "${sessionId}" under ${PROJECTS_DIR}. ` +
        `Either the run failed before Claude Code opened a transcript, or --session-id was not honored.`,
    );
    this.name = "SessionJsonlNotFoundError";
  }
}

export function locateSessionJsonl(sessionId: string): string {
  if (!existsSync(PROJECTS_DIR)) throw new SessionJsonlNotFoundError(sessionId);

  const targetFilename = `${sessionId}.jsonl`;
  const projectDirs = readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory(),
  );

  for (const projectDir of projectDirs) {
    const candidate = join(PROJECTS_DIR, projectDir.name, targetFilename);
    if (existsSync(candidate)) return candidate;
  }

  throw new SessionJsonlNotFoundError(sessionId);
}
