import { useEffect, useRef } from "react";

const DEFAULT_DEBOUNCE_MS = 250;

export function useDebouncedCallback<TArgs extends unknown[]>(
  callback: (...args: TArgs) => void,
  delayMs: number = DEFAULT_DEBOUNCE_MS,
): {
  schedule: (...args: TArgs) => void;
  flush: () => void;
  cancel: () => void;
} {
  const callbackRef = useRef(callback);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastArgsRef = useRef<TArgs | null>(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Unmount FLUSHES rather than drops — views unmount mid-edit all the time
  // (the canvas auto-follows new pushes), and a dropped trailing edit is
  // silent data loss.
  useEffect(() => {
    return () => flushRef.current();
  }, []);

  const schedule = (...args: TArgs): void => {
    lastArgsRef.current = args;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const pendingArgs = lastArgsRef.current;
      lastArgsRef.current = null;
      if (pendingArgs) callbackRef.current(...pendingArgs);
    }, delayMs);
  };

  const flush = (): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (lastArgsRef.current) {
      const pendingArgs = lastArgsRef.current;
      lastArgsRef.current = null;
      callbackRef.current(...pendingArgs);
    }
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const cancel = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    lastArgsRef.current = null;
  };

  return { schedule, flush, cancel };
}
