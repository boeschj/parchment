import { useCallback, useEffect, useRef, useState } from "react";
import { immutableSetByPath } from "@json-render/core/store-utils";
import type { Slot, SlotStateChange, WsEvent } from "../shared/types.ts";
import { appendEntries, emptyTranscript, type TranscriptModel } from "./transcript/parse.ts";

const CONNECT_BASE_DELAY_MS = 500;
const CONNECT_MAX_DELAY_MS = 8000;

export type CanvasState = {
  sessionId: string;
  slots: Slot[];
  transcript: TranscriptModel;
  connected: boolean;
};

// Transient events (slot ops) are commands, not state — components that act
// on them imperatively subscribe here instead of going through the reducer.
export type WsEventListener = (event: WsEvent) => void;

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
    case "slot-state":
      return {
        ...state,
        slots: state.slots.map((slot) =>
          slot.id === event.data.slotId ? withStateChanges(slot, event.data.changes) : slot,
        ),
      };
    case "edit-recorded":
      return state;
    case "reset":
      return { ...state, slots: [] };
    case "transcript-snapshot":
      return { ...state, transcript: appendEntries(emptyTranscript, event.data.entries) };
    case "transcript-append":
      return { ...state, transcript: appendEntries(state.transcript, event.data.entries) };
    default:
      return state;
  }
}

// Fold daemon-pushed live data into the slot's state with structural sharing.
// The new state object reaches JSONUIProvider as `initialState`; json-render's
// StateProvider diffs it against the previous one and writes only the changed
// paths into its store — no remount, no full-spec re-render, and no echo back
// through onStateChange (the diff bypasses it by design).
function withStateChanges(slot: Slot, changes: SlotStateChange[]): Slot {
  let nextState = slot.state;
  for (const change of changes) {
    nextState = immutableSetByPath(nextState, change.path, change.value);
  }
  return { ...slot, state: nextState };
}

export function useCanvasWebSocket(
  sessionId: string,
): CanvasState & { subscribeToEvents: (listener: WsEventListener) => () => void } {
  const [state, setState] = useState<CanvasState>({
    sessionId,
    slots: [],
    transcript: emptyTranscript,
    connected: false,
  });
  const listenersRef = useRef<Set<WsEventListener>>(new Set());

  const subscribeToEvents = useCallback((listener: WsEventListener): (() => void) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);
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
          for (const listener of listenersRef.current) listener(parsed);
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

  return { ...state, subscribeToEvents };
}
