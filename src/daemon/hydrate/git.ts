// git access for the $diff reference. Every git invocation is an ARGS ARRAY
// spawned with the session cwd — never a shell string — so an agent-supplied
// path or base can never break out into shell. git's own stderr is surfaced
// verbatim on failure so the agent sees exactly what git saw.

import { basename, dirname, join, relative } from "node:path";
import { safeRealpath } from "./paths.ts";

const GIT_TIMEOUT_MS = 10_000;

export type DiffOptions = { base: string | null; staged: boolean };

export type DiffSides = { before: string; after: string; file: string };

type GitRun = { code: number; stdout: string; stderr: string };

async function runGit(cwd: string, args: string[]): Promise<GitRun> {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const killTimer = setTimeout(() => child.kill(), GIT_TIMEOUT_MS);
  try {
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const code = await child.exited;
    return { code, stdout, stderr };
  } finally {
    clearTimeout(killTimer);
  }
}

export type RepoContext = { repoRoot: string; relPath: string };

export type RepoResolution = { ok: true; context: RepoContext } | { ok: false; error: string };

// THE REPO IS RESOLVED FROM THE FILE, NEVER FROM THE SESSION'S cwd.
//
// A file can live in a repository BELOW cwd — a submodule, a vendored checkout,
// a cloned fixture. Asking git about the cwd then answers for the OUTER repo, and
// the file's path relative to that outer root is a path the outer repo has never
// heard of. `git show <rev>:<that path>` fails, contentAtRevision reads the
// failure as "the file did not exist at this revision", and the DiffViewer
// renders with an EMPTY before side: a one-sided diff, silently, with no error.
//
// A <GitDiff> over a nested repository exposed this: it came back with before=""
// and after=<the whole file>. Searching from the file's own directory finds the
// innermost repository that actually contains it, which
// is the only repo whose revisions can answer for it. For the common case (the
// file is in cwd's own repo) this resolves to the same root, so nothing changes.
async function resolveRepoContext(absPath: string): Promise<RepoResolution> {
  const searchDir = safeRealpath(dirname(absPath));
  const topLevel = await runGit(searchDir, ["rev-parse", "--show-toplevel"]);
  if (topLevel.code !== 0) {
    return {
      ok: false,
      error: `not a git repository at ${searchDir}: ${firstLine(topLevel.stderr) || "git rev-parse failed"}`,
    };
  }
  const repoRoot = topLevel.stdout.trim();
  return { ok: true, context: { repoRoot, relPath: repoRelativePath(repoRoot, absPath) } };
}

// git rev-parse resolves symlinks in the repo root (on macOS /var → /private/var),
// so a plain relative() against an unresolved absPath drifts. Normalize both
// sides through the file's containing directory, which exists even when the
// file itself was deleted from the working tree.
function repoRelativePath(repoRoot: string, absPath: string): string {
  const realDir = safeRealpath(dirname(absPath));
  const realAbs = join(realDir, basename(absPath));
  return relative(safeRealpath(repoRoot), realAbs);
}

// Content of a path at a revision, or "" when the path does not exist there
// (a newly added file has no "before"). The revision is verified up front so a
// bad `base` surfaces as an error rather than silently reading as an empty side.
async function contentAtRevision(
  repoRoot: string,
  revision: string,
  relPath: string,
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const verified = await runGit(repoRoot, ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`]);
  if (verified.code !== 0) {
    // No such commit — but for HEAD specifically that just means an unborn
    // branch (a repo with no commits), where an empty "before" is correct.
    if (revision === "HEAD") return { ok: true, content: "" };
    return { ok: false, error: `"${revision}" is not a valid git revision` };
  }
  const show = await runGit(repoRoot, ["show", `${revision}:${relPath}`]);
  if (show.code !== 0) return { ok: true, content: "" };
  return { ok: true, content: show.stdout };
}

async function stagedContent(repoRoot: string, relPath: string): Promise<string> {
  const show = await runGit(repoRoot, ["show", `:${relPath}`]);
  return show.code === 0 ? show.stdout : "";
}

// The two file versions a DiffViewer needs. Default: HEAD (or `base`) vs the
// working tree. Staged: HEAD vs the index. An added file reads before="";
// a deleted file reads after="".
export async function resolveDiffSides(
  cwd: string,
  absPath: string,
  relDisplayPath: string,
  options: DiffOptions,
): Promise<{ ok: true; sides: DiffSides } | { ok: false; error: string }> {
  const repo = await resolveRepoContext(absPath);
  if (!repo.ok) return repo;
  const { repoRoot, relPath } = repo.context;

  const baseRevision = options.base ?? "HEAD";
  const before = await contentAtRevision(repoRoot, baseRevision, relPath);
  if (!before.ok) return before;

  const after = options.staged
    ? await stagedContent(repoRoot, relPath)
    : await workingTreeContent(absPath);

  if (before.content === "" && after === "") {
    return { ok: false, error: `nothing to diff for ${relDisplayPath} — not found at ${baseRevision} or in the working tree.` };
  }
  return { ok: true, sides: { before: before.content, after, file: relDisplayPath } };
}

// The raw unified patch, for a $diff used as a prop value (a CodeBlock or
// Markdown of the change) rather than a two-sided DiffViewer.
export async function resolveDiffPatch(
  cwd: string,
  absPath: string,
  relDisplayPath: string,
  options: DiffOptions,
): Promise<{ ok: true; patch: string } | { ok: false; error: string }> {
  const repo = await resolveRepoContext(absPath);
  if (!repo.ok) return repo;
  const args = ["diff", "--no-color"];
  if (options.staged) args.push("--staged");
  if (options.base) args.push(options.base);
  args.push("--", repo.context.relPath);
  const diff = await runGit(repo.context.repoRoot, args);
  if (diff.code !== 0) {
    return { ok: false, error: `git diff failed for ${relDisplayPath}: ${firstLine(diff.stderr) || "unknown error"}` };
  }
  return { ok: true, patch: diff.stdout };
}

async function workingTreeContent(absPath: string): Promise<string> {
  const handle = Bun.file(absPath);
  if (!(await handle.exists())) return "";
  return handle.text();
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}
