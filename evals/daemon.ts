// The eval's own parchment daemon: one process, one scratch HOME, one port.
//
// Isolation is the whole job. The daemon derives its entire state directory
// (~/.parchment: port/token/pid files, session slots) from os.homedir(), which
// resolves from $HOME — so overriding HOME for the spawned daemon, and ONLY for
// it, gives the eval a private state dir that can never touch the operator's
// live daemon on 7801. The outer `claude -p` processes keep the real HOME
// (they need it for the subscription's OAuth credentials); the daemon and its
// MCP server get the scratch one.
//
// Adapted from bench/daemon-harness.ts rather than imported: that file belongs
// to the benchmark and may move under it. The health check here is stricter —
// it demands the daemon IDENTIFY as parchment, because "something answers 200
// on this port" is not the same fact as "our daemon is up".

import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DAEMON_ENTRY } from "../src/cli/paths.ts";
import { DAEMON_APP_NAME } from "../src/daemon/state.ts";
import { DAEMON_PORT, EvalPaths } from "./config.ts";

const HEALTH_POLL_INTERVAL_MS = 200;
const HEALTH_POLL_TIMEOUT_MS = 15_000;
const HEALTH_PROBE_TIMEOUT_MS = 1_000;

// The operator's real daemon. Booting on it would write eval slots into their
// live canvas; the check below refuses rather than trusting config.ts to stay
// correct forever.
const OPERATOR_DAEMON_PORTS = [7800, 7801] as const;

const PARCHMENT_STATE_DIRNAME = ".parchment";
const TOKEN_FILENAME = "server.token";

export type EvalDaemon = {
  baseUrl: string;
  token: string;
  homeDir: string;
  // Where the browser rubric points itself to see what an arm rendered.
  canvasUrlFor: (sessionId: string) => string;
  stop: () => Promise<void>;
};

export async function startEvalDaemon(): Promise<EvalDaemon> {
  assertPortIsNotTheOperators(DAEMON_PORT);
  const homeDir = assertScratchHomeIsNotTheOperators(EvalPaths.scratchHome);

  const stateDir = join(homeDir, PARCHMENT_STATE_DIRNAME);
  mkdirSync(stateDir, { recursive: true });

  const baseUrl = `http://127.0.0.1:${DAEMON_PORT}`;
  const daemonProcess = await spawnUnlessAlreadyRunning(baseUrl, homeDir);
  await waitForParchmentDaemon(baseUrl);

  const token = readFileSync(join(stateDir, TOKEN_FILENAME), "utf8").trim();

  const stop = async (): Promise<void> => {
    if (daemonProcess === null) return;
    daemonProcess.kill();
    await daemonProcess.exited;
  };

  return {
    baseUrl,
    token,
    homeDir,
    canvasUrlFor: (sessionId) => canvasUrlFor(baseUrl, sessionId),
    stop,
  };
}

export function canvasUrlFor(baseUrl: string, sessionId: string): string {
  return `${baseUrl}/?session=${encodeURIComponent(sessionId)}`;
}

// A daemon left running by a previous eval is reused rather than duplicated:
// the one it spawned would see the live PID file under the same scratch HOME
// and exit immediately anyway, which would leave us waiting on a process that
// is already gone. Returning null records that we do not own this one.
async function spawnUnlessAlreadyRunning(
  baseUrl: string,
  homeDir: string,
): Promise<Bun.Subprocess | null> {
  const alreadyRunning = await isParchmentDaemonHealthy(baseUrl);
  if (alreadyRunning) return null;

  return Bun.spawn({
    cmd: ["bun", "run", DAEMON_ENTRY],
    env: daemonEnvironment(homeDir),
    stdout: "ignore",
    stderr: "ignore",
  });
}

// PARCHMENT_STATE_DIR is stripped, not merely overridden: it is the one env var
// that outranks HOME for the daemon's state directory, and an operator who has
// it exported would otherwise get eval slots in their real canvas.
function daemonEnvironment(homeDir: string): Record<string, string> {
  const inherited = { ...process.env };
  delete inherited.PARCHMENT_STATE_DIR;
  return { ...inherited, HOME: homeDir, CANVAS_PORT: String(DAEMON_PORT) };
}

async function waitForParchmentDaemon(baseUrl: string): Promise<void> {
  const deadline = Date.now() + HEALTH_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await isParchmentDaemonHealthy(baseUrl)) return;
    await Bun.sleep(HEALTH_POLL_INTERVAL_MS);
  }

  throw new Error(
    `eval daemon at ${baseUrl} never identified itself as "${DAEMON_APP_NAME}" within ` +
      `${HEALTH_POLL_TIMEOUT_MS / 1000}s. Check that \`bun run ${DAEMON_ENTRY}\` starts, and that ` +
      `port ${DAEMON_PORT} is not held by another program.`,
  );
}

async function isParchmentDaemonHealthy(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return false;

    const payload = (await response.json()) as { ok?: boolean; app?: string };
    const isHealthy = payload.ok === true;
    const isParchment = payload.app === DAEMON_APP_NAME;
    return isHealthy && isParchment;
  } catch {
    return false;
  }
}

function assertPortIsNotTheOperators(port: number): void {
  const isOperatorPort = OPERATOR_DAEMON_PORTS.some((operatorPort) => operatorPort === port);
  if (!isOperatorPort) return;

  throw new Error(
    `refusing to boot the eval daemon on port ${port}: that is the operator's own parchment daemon. ` +
      `DAEMON_PORT (evals/config.ts) must stay well clear of ${OPERATOR_DAEMON_PORTS.join(", ")}.`,
  );
}

function assertScratchHomeIsNotTheOperators(scratchHome: string): string {
  const resolvedScratchHome = resolve(scratchHome);
  const resolvedRealHome = resolve(homedir());
  if (resolvedScratchHome !== resolvedRealHome) return resolvedScratchHome;

  throw new Error(
    `refusing to boot the eval daemon with HOME=${resolvedScratchHome}: that is the operator's real HOME, ` +
      `so the daemon would read and write their real ~/.parchment.`,
  );
}
