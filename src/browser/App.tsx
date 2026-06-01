import { useMemo, useRef, useState } from "react";
import { JSONUIProvider, Renderer, type Spec } from "@json-render/react";
import type { Slot } from "../shared/types.ts";
import { SlotKind, SlotStatus } from "../shared/types.ts";
import { registry } from "./registry.ts";
import { SlotContextProvider } from "./SlotContext.tsx";
import { SlotErrorBoundary } from "./components/SlotErrorBoundary.tsx";
import { useCanvasWebSocket } from "./ws.ts";
import { readSessionIdFromUrl, shortSessionLabel } from "./session.ts";
import { deleteSlot, resetSession } from "./api.ts";
import {
  buildCanvasActionHandlers,
  postStateChanges,
  type StateChange,
} from "./canvas-actions.ts";

const STATE_CHANGE_DEBOUNCE_MS = 300;

const SLOT_KIND_GLYPH: Record<string, string> = {
  [SlotKind.Plan]: "✎",
  [SlotKind.Diagram]: "▱",
  [SlotKind.Diff]: "⇄",
  [SlotKind.Dashboard]: "▦",
  [SlotKind.Table]: "⊞",
  [SlotKind.Report]: "¶",
  [SlotKind.Render]: "◇",
};

function kindGlyph(kind: string): string {
  return SLOT_KIND_GLYPH[kind] ?? "◇";
}

function statusBadge(status: string): { text: string; className: string } {
  if (status === SlotStatus.Error) return { text: "error", className: "text-destructive" };
  if (status === SlotStatus.Rendering) return { text: "rendering", className: "text-amber-600" };
  return { text: "ready", className: "text-emerald-600" };
}

export function App() {
  const sessionId = readSessionIdFromUrl();
  const { slots, connected } = useCanvasWebSocket(sessionId);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);

  const activeSlot: Slot | null =
    slots.find((slot) => slot.id === activeSlotId) ?? slots[slots.length - 1] ?? null;

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="border-b bg-card px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold">clawd-canvas</h1>
          <span className="text-xs text-muted-foreground font-mono">
            session {shortSessionLabel(sessionId)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs font-mono ${connected ? "text-emerald-600" : "text-amber-600"}`}
          >
            ● {connected ? "live" : "reconnecting…"}
          </span>
          {slots.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Clear all canvas slots and pending edits?")) {
                  void resetSession(sessionId);
                }
              }}
              className="text-xs px-2 py-1 rounded-md text-muted-foreground hover:bg-muted"
            >
              Clear canvas
            </button>
          ) : null}
        </div>
      </header>

      {slots.length === 0 ? (
        <EmptyState sessionId={sessionId} />
      ) : (
        <main className="flex-1 flex flex-col">
          <nav className="flex gap-1 border-b bg-card px-2 overflow-x-auto">
            {slots.map((slot) => {
              const badge = statusBadge(slot.status);
              const isActive = (activeSlot?.id ?? null) === slot.id;
              return (
                <button
                  key={slot.id}
                  onClick={() => setActiveSlotId(slot.id)}
                  className={`px-3 py-2 text-sm flex items-center gap-2 whitespace-nowrap transition-colors ${
                    isActive
                      ? "bg-background border-b-2 border-primary -mb-px"
                      : "hover:bg-muted"
                  }`}
                >
                  <span className="font-mono">{kindGlyph(slot.kind)}</span>
                  <span className="font-medium">{slot.title}</span>
                  <span className={`text-[10px] ${badge.className}`}>{badge.text}</span>
                  <span
                    role="button"
                    aria-label={`Close ${slot.title}`}
                    className="ml-2 text-muted-foreground hover:text-destructive"
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteSlot(sessionId, slot.id);
                    }}
                  >
                    ✕
                  </span>
                </button>
              );
            })}
          </nav>
          <section className="flex-1 p-6 overflow-auto bg-background">
            {activeSlot ? (
              <SlotRenderer sessionId={sessionId} slot={activeSlot} />
            ) : null}
          </section>
        </main>
      )}
    </div>
  );
}

// Renderer for a single active slot — wraps its own JSONUIProvider so each
// slot has an isolated state model + action handler closure (handlers close
// over slot.id, which changes when the user switches tabs).
function SlotRenderer({ sessionId, slot }: { sessionId: string; slot: Slot }) {
  const handlers = useMemo(
    () => buildCanvasActionHandlers(sessionId, slot),
    [sessionId, slot],
  );

  // Debounce onStateChange so a stream of edits coalesces into a single POST.
  // Single ref bucket per slot; flushes on the trailing edge.
  const pendingRef = useRef<StateChange[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleStateChange = (changes: Array<{ path: string; value: unknown }>): void => {
    pendingRef.current.push(...changes);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const drained = pendingRef.current;
      pendingRef.current = [];
      timerRef.current = null;
      void postStateChanges(sessionId, slot, drained);
    }, STATE_CHANGE_DEBOUNCE_MS);
  };

  return (
    <SlotErrorBoundary slotId={slot.id}>
      <SlotContextProvider sessionId={sessionId} slotId={slot.id}>
        <JSONUIProvider
          registry={registry}
          initialState={(slot.state ?? {}) as Record<string, unknown>}
          handlers={handlers}
          onStateChange={handleStateChange}
        >
          <Renderer
            spec={slot.spec as Spec}
            registry={registry}
            loading={slot.status === SlotStatus.Rendering}
          />
        </JSONUIProvider>
      </SlotContextProvider>
    </SlotErrorBoundary>
  );
}

function EmptyState({ sessionId }: { sessionId: string }) {
  return (
    <section className="flex-1 flex items-center justify-center p-8">
      <div className="bg-card border rounded-xl shadow-sm max-w-lg p-8 text-center">
        <h2 className="text-base font-semibold">
          👋 clawd-canvas is connected
        </h2>
        <p className="text-sm text-muted-foreground mt-2">
          session <code className="font-mono">{shortSessionLabel(sessionId)}</code> — waiting for Claude to push something here.
        </p>
        <p className="text-xs text-muted-foreground mt-4">
          Try in your Claude Code terminal:
        </p>
        <pre className="font-mono text-xs bg-muted border rounded-md p-3 mt-2 text-left">
{`"Show me a quick plan for adding caching to my API.
Render it to the canvas as an editable plan."`}
        </pre>
        <p className="text-xs text-muted-foreground mt-3">
          Or whenever Claude has something rich to show (a diff, a diagram, a
          dashboard) it'll call <code className="font-mono">canvas_*</code> tools and that slot will appear here.
        </p>
      </div>
    </section>
  );
}
