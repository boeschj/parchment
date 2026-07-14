// Boots an isolated parchment daemon for the benchmark run and tears it down
// afterward. Isolation matters: a developer's real parchment daemon may
// already be running with live sessions (this one is — see bench/README.md).
//
// The daemon derives its state directory (port/token/pid files, session slots)
// from PARCHMENT_STATE_DIR if set, and otherwise from `homedir()/.parchment`
// (src/daemon/state.ts). We pin BOTH, for different reasons:
//
//   PARCHMENT_STATE_DIR — the explicit, supported lever. Pinning it is not
//     optional: `bunfig.toml`'s [test].preload sets this variable in any
//     `bun test` process, and Bun.spawn inherits the parent's environment — so
//     a bench daemon spawned from inside a test would silently write its token
//     and sessions into the TEST's temp dir, and the harness would then fail to
//     find server.token in the HOME it just created. (That is exactly what
//     happened; this line is the fix.)
//   HOME — belt and braces, so that anything in the daemon (or its deps) that
//     still reaches for `homedir()` lands in the throwaway directory too, never
//     in a developer's real ~/.parchment.
//
// The outer `claude -p` / SDK process keeps the REAL HOME — it needs it for
// auth. Only the spawned daemon is relocated.

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
  // Metric (d), time-to-first-canvas only: reuse an existing HOME instead of
  // minting a fresh one. Passing this is how the cold/warm boot comparison
  // shares one ~/.parchment between a "cold" first boot and a "warm" second
  // boot against already-initialized state. When set, stop() leaves this
  // directory on disk — the caller created it and owns its cleanup.
  homeDir?: string;
};

export async function startBenchDaemon({ port, homeDir }: StartBenchDaemonOptions): Promise<BenchDaemon> {
  const ownsHomeDir = homeDir === undefined;
  const resolvedHomeDir = homeDir ?? mkdtempSync(join(tmpdir(), "parchment-bench-home-"));
  const parchmentStateDir = join(resolvedHomeDir, ".parchment");
  mkdirSync(parchmentStateDir, { recursive: true });

  const daemonProcess = Bun.spawn({
    cmd: ["bun", "run", DAEMON_ENTRY],
    env: {
      ...process.env,
      HOME: resolvedHomeDir,
      PARCHMENT_STATE_DIR: parchmentStateDir,
      CANVAS_PORT: String(port),
    },
    stdout: "ignore",
    stderr: "ignore",
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForDaemonHealth(baseUrl);
  const token = readFileSync(join(parchmentStateDir, "server.token"), "utf8").trim();

  const stop = async (): Promise<void> => {
    daemonProcess.kill();
    await daemonProcess.exited;
    if (ownsHomeDir) rmSync(resolvedHomeDir, { recursive: true, force: true });
  };

  return { baseUrl, token, homeDir: resolvedHomeDir, stop };
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
