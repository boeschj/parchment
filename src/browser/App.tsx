import { useState } from "react";
import { Renderer, type Spec } from "@json-render/react";
import type { Slot } from "../shared/types.ts";
import { SlotKind, SlotStatus } from "../shared/types.ts";
import { registry } from "./registry.ts";
import { SlotContextProvider } from "./SlotContext.tsx";
import { SlotErrorBoundary } from "./components/SlotErrorBoundary.tsx";
import { useCanvasWebSocket } from "./ws.ts";
import { readSessionIdFromUrl, shortSessionLabel } from "./session.ts";
import { deleteSlot, resetSession } from "./api.ts";

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
  if (status === SlotStatus.Error) return { text: "error", className: "text-canvas-error" };
  if (status === SlotStatus.Rendering) return { text: "rendering", className: "text-canvas-warning" };
  return { text: "ready", className: "text-canvas-success" };
}

export function App() {
  const sessionId = readSessionIdFromUrl();
  const { slots, connected } = useCanvasWebSocket(sessionId);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);

  const activeSlot: Slot | null =
    slots.find((slot) => slot.id === activeSlotId) ?? slots[slots.length - 1] ?? null;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-canvas-border bg-canvas-surface px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-canvas-fg">clawd-canvas</h1>
          <span className="text-xs text-canvas-muted canvas-mono">
            session {shortSessionLabel(sessionId)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs canvas-mono ${connected ? "text-canvas-success" : "text-canvas-warning"}`}
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
              className="text-xs px-2 py-1 rounded-md text-canvas-muted hover:bg-canvas-accent/5"
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
          <nav className="flex gap-1 border-b border-canvas-border bg-canvas-surface px-2 overflow-x-auto">
            {slots.map((slot) => {
              const badge = statusBadge(slot.status);
              const isActive = (activeSlot?.id ?? null) === slot.id;
              return (
                <button
                  key={slot.id}
                  onClick={() => setActiveSlotId(slot.id)}
                  className={`px-3 py-2 text-sm flex items-center gap-2 whitespace-nowrap ${
                    isActive ? "canvas-tab-active" : "hover:bg-canvas-bg"
                  }`}
                >
                  <span className="canvas-mono">{kindGlyph(slot.kind)}</span>
                  <span className="font-medium">{slot.title}</span>
                  <span className={`text-[10px] ${badge.className}`}>{badge.text}</span>
                  <span
                    role="button"
                    aria-label={`Close ${slot.title}`}
                    className="ml-2 text-canvas-muted hover:text-canvas-error"
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
          <section className="flex-1 p-4 overflow-auto">
            {activeSlot ? (
              <SlotErrorBoundary slotId={activeSlot.id}>
                <SlotContextProvider sessionId={sessionId} slotId={activeSlot.id}>
                  <Renderer spec={activeSlot.spec as Spec} registry={registry} />
                </SlotContextProvider>
              </SlotErrorBoundary>
            ) : null}
          </section>
        </main>
      )}
    </div>
  );
}

function EmptyState({ sessionId }: { sessionId: string }) {
  return (
    <section className="flex-1 flex items-center justify-center">
      <div className="canvas-card max-w-lg p-8 text-center">
        <h2 className="text-base font-semibold text-canvas-fg">
          👋 clawd-canvas is connected
        </h2>
        <p className="text-sm text-canvas-muted mt-2">
          session <code className="canvas-mono">{shortSessionLabel(sessionId)}</code> — waiting for Claude to push something here.
        </p>
        <p className="text-xs text-canvas-muted mt-4">
          Try in your Claude Code terminal:
        </p>
        <pre className="canvas-mono text-xs bg-canvas-surface border border-canvas-border rounded-md p-3 mt-2 text-left">
{`"Show me a quick plan for adding caching to my API.
Render it to the canvas as an editable plan."`}
        </pre>
        <p className="text-xs text-canvas-muted mt-3">
          Or whenever Claude has something rich to show (a diff, a diagram, a
          dashboard) it'll call <code className="canvas-mono">canvas_*</code> tools and that slot will appear here.
        </p>
      </div>
    </section>
  );
}
