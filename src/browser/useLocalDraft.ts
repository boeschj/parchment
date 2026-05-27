import { useCallback, useEffect, useState } from "react";

const STORAGE_PREFIX = "clawd-canvas:draft:";

function storageKey(sessionId: string, slotId: string, elementId: string): string {
  return `${STORAGE_PREFIX}${sessionId}:${slotId}:${elementId}`;
}

function safeRead(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage full / disabled — drop the draft silently
  }
}

function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // best-effort
  }
}

export function useLocalDraft(
  sessionId: string,
  slotId: string,
  elementId: string,
  initial: string,
): {
  draft: string;
  setDraft: (next: string) => void;
  clearDraft: () => void;
} {
  const key = storageKey(sessionId, slotId, elementId);
  const [draft, setDraftState] = useState<string>(() => safeRead(key) ?? initial);

  useEffect(() => {
    setDraftState(safeRead(key) ?? initial);
  }, [key, initial]);

  const setDraft = useCallback(
    (next: string) => {
      setDraftState(next);
      safeWrite(key, next);
    },
    [key],
  );

  const clearDraft = useCallback(() => {
    safeRemove(key);
  }, [key]);

  return { draft, setDraft, clearDraft };
}
