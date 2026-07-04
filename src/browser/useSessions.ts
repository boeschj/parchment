import { useEffect, useState } from "react";
import type { SessionSummary } from "../shared/types.ts";
import { fetchSessions } from "./api.ts";

const POLL_INTERVAL_MS = 2500;

export function useSessions(): SessionSummary[] {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const next = await fetchSessions();
        if (active) setSessions(next);
      } catch {
        void 0;
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return sessions;
}
