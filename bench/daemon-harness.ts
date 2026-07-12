// Boots an isolated parchment daemon for the benchmark run and tears it down
// afterward. Isolation matters: a developer's real parchment daemon may
// already be running with live sessions (this one is — see bench/README.md),
// and the daemon's state directory (~/.parchment: port/token/pid files,
// session slots) is NOT configurable via an environment variable in the
// current daemon code. `HOME` is the only lever: Node/Bun's `os.homedir()`
// resolves from `$HOME`, and the daemon derives its entire state directory
// from `homedir()`. Overriding `HOME` just for the spawned daemon process
// (never for the outer `claude -p` process, which still needs the real HOME
// for auth) gives the harness a fully separate ~/.parchment with zero risk
// of clobbering a developer's live daemon.

import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAEMON_ENTRY } from "./config.ts";

const HEALTH_POLL_INTERVAL_MS = 200;
const HEALTH_POLL_ATTEMPTS = 50;

export type BenchDaemon = {
  baseUrl: string;
  token: string;
  homeDir: string;
  stop: () => Promise<void>;
};

export type StartBenchDaemonOptions = {
  port: number;
};

export async function startBenchDaemon({ port }: StartBenchDaemonOptions): Promise<BenchDaemon> {
  const homeDir = mkdtempSync(join(tmpdir(), "parchment-bench-home-"));
  const parchmentStateDir = join(homeDir, ".parchment");
  mkdirSync(parchmentStateDir, { recursive: true });

  const daemonProcess = Bun.spawn({
    cmd: ["bun", "run", DAEMON_ENTRY],
    env: { ...process.env, HOME: homeDir, CANVAS_PORT: String(port) },
    stdout: "ignore",
    stderr: "ignore",
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForDaemonHealth(baseUrl);
  const token = readFileSync(join(parchmentStateDir, "server.token"), "utf8").trim();

  const stop = async (): Promise<void> => {
    daemonProcess.kill();
    await daemonProcess.exited;
    rmSync(homeDir, { recursive: true, force: true });
  };

  return { baseUrl, token, homeDir, stop };
}

async function waitForDaemonHealth(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < HEALTH_POLL_ATTEMPTS; attempt += 1) {
    if (await isHealthy(baseUrl)) return;
    await Bun.sleep(HEALTH_POLL_INTERVAL_MS);
  }
  throw new Error(
    `bench daemon at ${baseUrl} did not become healthy after ${(HEALTH_POLL_ATTEMPTS * HEALTH_POLL_INTERVAL_MS) / 1000}s`,
  );
}

async function isHealthy(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/health`);
    if (!response.ok) return false;
    const payload = (await response.json()) as { ok?: boolean };
    return payload.ok === true;
  } catch {
    return false;
  }
}
