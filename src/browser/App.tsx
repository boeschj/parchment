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
      <header className="px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Mark />
          <span className="text-[20px] font-semibold tracking-tight leading-none">
            clawd
          </span>
          <span className="text-[20px] font-light text-muted-foreground tracking-tight leading-none">
            canvas
          </span>
          <span className="label ml-3">session · {shortSessionLabel(sessionId)}</span>
        </div>
        <div className="flex items-center gap-4">
          <span
            className={`label flex items-center gap-1.5 ${
              connected ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: "currentColor" }}
            />
            {connected ? "live" : "reconnecting"}
          </span>
          {slots.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Clear all canvas slots and pending edits?")) {
                  void resetSession(sessionId);
                }
              }}
              className="h-8 px-3 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              Clear canvas
            </button>
          ) : null}
        </div>
      </header>

      <hr className="hairline mx-6" />

      {slots.length === 0 ? (
        <EmptyState sessionId={sessionId} />
      ) : (
        <main className="flex-1 flex flex-col min-h-0">
          <nav className="flex gap-1 px-6 pt-4 pb-2 overflow-x-auto">
            {slots.map((slot) => {
              const badge = statusBadge(slot.status);
              const isActive = (activeSlot?.id ?? null) === slot.id;
              return (
                <button
                  key={slot.id}
                  onClick={() => setActiveSlotId(slot.id)}
                  className={`h-9 pl-3 pr-2 rounded-full text-sm flex items-center gap-2 whitespace-nowrap transition-colors ${
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  <span className="font-mono text-[15px] leading-none">
                    {kindGlyph(slot.kind)}
                  </span>
                  <span className="font-medium">{slot.title}</span>
                  <span className={`text-[10px] font-mono uppercase tracking-wider ${badge.className}`}>
                    {badge.text}
                  </span>
                  <span
                    role="button"
                    aria-label={`Close ${slot.title}`}
                    className="ml-1 w-5 h-5 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
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
          <section className="flex-1 px-6 pb-8 pt-2 overflow-auto">
            {activeSlot ? (
              <SlotRenderer sessionId={sessionId} slot={activeSlot} />
            ) : null}
          </section>
        </main>
      )}
    </div>
  );
}

// Logo mark — per Style Guide.html SVG, 28×28 rounded square outline + two
// horizontal "lines" suggesting a doc/canvas.
function Mark() {
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 shrink-0">
      <svg width="32" height="32" viewBox="0 0 28 28" fill="none" aria-hidden>
        <rect
          x="1.4"
          y="1.4"
          width="25.2"
          height="25.2"
          rx="6.4"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <rect x="7.5" y="11" width="13" height="1.6" rx="0.8" fill="currentColor" />
        <rect x="7.5" y="15.4" width="9" height="1.6" rx="0.8" fill="currentColor" />
      </svg>
    </span>
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
    <section className="flex-1 flex items-center justify-center px-6 py-12">
      <div className="bg-card max-w-xl p-10 text-left" style={{ borderRadius: "var(--radius)" }}>
        <span className="label">01 / Welcome</span>
        <h2 className="h-display text-3xl mt-3 mb-3">
          Ready when Claude is.
        </h2>
        <p className="text-base leading-relaxed text-muted-foreground">
          Session{" "}
          <code className="font-mono text-foreground/80">
            {shortSessionLabel(sessionId)}
          </code>{" "}
          is live. Whenever Claude has something richer than terminal text —
          a plan, a diff, a diagram, a dashboard — it'll surface here.
        </p>

        <hr className="hairline my-6" />

        <span className="label">Try in your terminal</span>
        <pre className="font-mono text-xs bg-muted p-4 mt-3 leading-relaxed" style={{ borderRadius: "var(--radius-md)" }}>
{`Show me a quick plan for adding
caching to my API. Render it to
the canvas as an editable plan.`}
        </pre>
      </div>
    </section>
  );
}
