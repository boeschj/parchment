// Subscribe a component to raw WebSocket events for their side effects
// (imperative API calls, never React state). The listener is kept in a ref
// so the subscription itself never churns — this effect synchronizes with
// an external event source.

import { useEffect, useRef } from "react";
import type { WsEventListener } from "./ws.ts";

export function useWsEventSubscription(
  subscribe: (listener: WsEventListener) => () => void,
  listener: WsEventListener,
): void {
  const listenerRef = useRef<WsEventListener>(listener);
  listenerRef.current = listener;

  useEffect(() => {
    return subscribe((event) => listenerRef.current(event));
  }, [subscribe]);
}
