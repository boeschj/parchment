// http-poll source: GET a URL on an interval and pump the parsed body into
// slot state. One request in flight at a time; failures are reported on the
// source record instead of clobbering good data.

import { applySourceValue } from "./apply.ts";
import { parsePolledText } from "./parse.ts";
import type { SlotStatePump } from "./pump.ts";
import type { HttpPollSourceConfig, SourceErrorReporter } from "./types.ts";

const HTTP_TIMEOUT_MS = 10_000;
const MAX_BODY_CHARS = 1024 * 1024;

export function startHttpPoll(
  config: HttpPollSourceConfig,
  pump: SlotStatePump,
  reportError: SourceErrorReporter,
): () => void {
  let inFlight = false;
  let stopped = false;

  async function pollOnce(): Promise<void> {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const response = await fetch(config.url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!response.ok) {
        reportError(`HTTP ${response.status} from ${config.url}`);
        return;
      }
      const body = await response.text();
      if (stopped) return;

      const outcome = parsePolledText(body.slice(0, MAX_BODY_CHARS));
      if (!outcome.ok) {
        reportError("response body was empty");
        return;
      }
      applySourceValue(pump, config, outcome.value);
      reportError(null);
    } catch (caught) {
      reportError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      inFlight = false;
    }
  }

  void pollOnce();
  const timer = setInterval(() => void pollOnce(), config.intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
