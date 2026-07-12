import { useCallback, useEffect, useState } from "react";
import type { LibraryListing } from "../shared/types.ts";
import { fetchLibraryEntries } from "./api.ts";

const POLL_INTERVAL_MS = 4000;

export function useLibraryEntries(): { entries: LibraryListing[]; refresh: () => void } {
  const [entries, setEntries] = useState<LibraryListing[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const next = await fetchLibraryEntries();
        if (active) setEntries(next);
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
  }, [refreshToken]);

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  return { entries, refresh };
}
