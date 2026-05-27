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

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const schedule = (...args: TArgs): void => {
    lastArgsRef.current = args;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (lastArgsRef.current) callbackRef.current(...lastArgsRef.current);
    }, delayMs);
  };

  const flush = (): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (lastArgsRef.current) {
      callbackRef.current(...lastArgsRef.current);
      lastArgsRef.current = null;
    }
  };

  const cancel = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    lastArgsRef.current = null;
  };

  return { schedule, flush, cancel };
}
