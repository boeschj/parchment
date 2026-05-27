import { useEffect, useRef, useState } from "react";
import type { Slot, WsEvent } from "../shared/types.ts";

const CONNECT_BASE_DELAY_MS = 500;
const CONNECT_MAX_DELAY_MS = 8000;

export type CanvasState = {
  sessionId: string;
  slots: Slot[];
  connected: boolean;
};

function reduceEvent(state: CanvasState, event: WsEvent): CanvasState {
  switch (event.kind) {
    case "snapshot":
      return { ...state, slots: event.data.slots };
    case "slot-added":
      return { ...state, slots: [...state.slots, event.data] };
    case "slot-updated":
      return {
        ...state,
        slots: state.slots.map((slot) => (slot.id === event.data.id ? event.data : slot)),
      };
    case "slot-removed":
      return { ...state, slots: state.slots.filter((slot) => slot.id !== event.data.slotId) };
    case "edit-recorded":
      return state;
    case "reset":
      return { ...state, slots: [] };
    default:
      return state;
  }
}

export function useCanvasWebSocket(sessionId: string): CanvasState {
  const [state, setState] = useState<CanvasState>({ sessionId, slots: [], connected: false });
  const reconnectAttemptRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect(): void {
      if (disposed) return;
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${protocol}://${window.location.host}/ws?session=${encodeURIComponent(sessionId)}`;
      const socket = new WebSocket(url);
      wsRef.current = socket;
      socket.onopen = () => {
        reconnectAttemptRef.current = 0;
        setState((prev) => ({ ...prev, connected: true }));
      };
      socket.onmessage = (messageEvent) => {
        try {
          const parsed = JSON.parse(messageEvent.data) as WsEvent;
          setState((prev) => reduceEvent(prev, parsed));
        } catch {
          // Ignore malformed frames; the server only emits valid JSON.
        }
      };
      socket.onclose = () => {
        setState((prev) => ({ ...prev, connected: false }));
        if (disposed) return;
        reconnectAttemptRef.current += 1;
        const delay = Math.min(
          CONNECT_MAX_DELAY_MS,
          CONNECT_BASE_DELAY_MS * 2 ** Math.min(reconnectAttemptRef.current, 5),
        );
        reconnectTimer = setTimeout(connect, delay);
      };
      socket.onerror = () => {
        socket.close();
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, [sessionId]);

  return state;
}
