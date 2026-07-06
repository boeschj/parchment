import { useCallback, useMemo, useRef, useState } from "react";
import { JSONUIProvider, Renderer, type Spec } from "@json-render/react";
import type { Slot, WsEvent } from "../shared/types.ts";
import { SessionStatus, SlotStatus } from "../shared/types.ts";
import { registry } from "./registry.ts";
import { SlotContextProvider } from "./SlotContext.tsx";
import { LeftRail } from "./components/LeftRail.tsx";
import { SlotKindIcon } from "./components/icons.tsx";
import { SlotErrorBoundary } from "./components/SlotErrorBoundary.tsx";
import { TranscriptView } from "./components/TranscriptView.tsx";
import { BoardView } from "./components/BoardView.tsx";
import { ExplorerView } from "./components/trace/ExplorerView.tsx";
import { GraphView } from "./components/trace/GraphView.tsx";
import { CostsView } from "./components/trace/CostsView.tsx";
import { ContextView } from "./components/trace/ContextView.tsx";
import { SafetyView } from "./components/trace/SafetyView.tsx";
import { SessionSwitcher } from "./components/SessionSwitcher.tsx";
import { useSessions } from "./useSessions.ts";
import type { SessionSummary } from "../shared/types.ts";
import { createBoardOpsListener } from "./board/ops-listener.ts";
import { createSlotOpsListener } from "./slot-ops/ops-listener.ts";
import { useWsEventSubscription } from "./useWsEventSubscription.ts";
import type { TranscriptModel } from "./transcript/parse.ts";
import type { WsEventListener } from "./ws.ts";
import { useCanvasWebSocket } from "./ws.ts";
import { readSessionIdFromUrl, shortSessionLabel } from "./session.ts";
import { deleteSlot, resetSession } from "./api.ts";
import { ThemeProvider, useThemeToggle } from "./theme.ts";
import {
  Surface,
  dynamicSlots,
  latestPlanSlot,
  newestSlotUpdatedAt,
  resolveView,
  type CanvasView,
  type ViewChoice,
} from "./view.ts";
import {
  buildCanvasActionHandlers,
  postStateChanges,
  type StateChange,
} from "./canvas-actions.ts";

const STATE_CHANGE_DEBOUNCE_MS = 300;

export function App() {
  const sessionId = readSessionIdFromUrl();
  const { slots, transcript, connected, subscribeToEvents } = useCanvasWebSocket(sessionId);
  const sessions = useSessions();
  const { theme, toggleTheme } = useThemeToggle();
  const [viewChoice, setViewChoice] = useState<ViewChoice | null>(null);

  const view = resolveView(viewChoice, slots);
  const railSlots = dynamicSlots(slots);
  const planSlot = latestPlanSlot(slots);
  const currentSession = sessions.find((session) => session.sessionId === sessionId);
  const isClaudeWorking = currentSession?.status === SessionStatus.Working;

  // Claude's board and slot ops execute at app level so drawing and slot
  // snapshots work no matter which surface is showing.
  useWsEventSubscription(subscribeToEvents, createBoardOpsListener(sessionId));
  useWsEventSubscription(subscribeToEvents, createSlotOpsListener(sessionId));

  // On the first snapshot, land on the transcript and mark every slot already
  // present as "seen". Otherwise a stale plan from earlier in the session hits
  // the Jarvis follow-rule on load and hijacks the view. Only slots pushed
  // AFTER load (newer than this baseline) pull focus.
  const didSeedViewRef = useRef(false);
  useWsEventSubscription(
    subscribeToEvents,
    useCallback((event: WsEvent) => {
      if (didSeedViewRef.current || event.kind !== "snapshot") return;
      didSeedViewRef.current = true;
      setViewChoice({
        view: { type: "surface", surface: Surface.Transcript },
        newestSeenUpdatedAt: newestSlotUpdatedAt(event.data.slots),
      });
    }, []),
  );

  const selectView = (next: CanvasView): void => {
    setViewChoice({ view: next, newestSeenUpdatedAt: newestSlotUpdatedAt(slots) });
  };

  return (
    <ThemeProvider value={theme}>
      <div className="h-screen flex flex-col bg-background text-foreground">
        <TopBar sessions={sessions} currentSessionId={sessionId} />
        <div className="flex-1 flex min-h-0">
          <LeftRail
            slots={railSlots}
            view={view}
            onSelectView={selectView}
            hasPlan={planSlot !== null}
            theme={theme}
            onToggleTheme={toggleTheme}
            newestSeenUpdatedAt={viewChoice?.newestSeenUpdatedAt ?? newestSlotUpdatedAt(slots)}
          />
          <div className="flex-1 min-w-0 flex flex-col">
            <ViewContent
              sessionId={sessionId}
              view={view}
              slots={slots}
              planSlot={planSlot}
              transcript={transcript}
              connected={connected}
              isClaudeWorking={isClaudeWorking}
              subscribeToEvents={subscribeToEvents}
            />
          </div>
        </div>
      </div>
    </ThemeProvider>
  );
}

function ViewContent({
  sessionId,
  view,
  slots,
  planSlot,
  transcript,
  connected,
  isClaudeWorking,
  subscribeToEvents,
}: {
  sessionId: string;
  view: CanvasView;
  slots: Slot[];
  planSlot: Slot | null;
  transcript: TranscriptModel;
  connected: boolean;
  isClaudeWorking: boolean;
  subscribeToEvents: (listener: WsEventListener) => () => void;
}) {
  if (view.type === "slot") {
    const slot = slots.find((candidate) => candidate.id === view.slotId);
    if (!slot) return <WelcomeCard sessionId={sessionId} connected={connected} />;
    return <SlotView sessionId={sessionId} slot={slot} connected={connected} />;
  }

  if (view.surface === Surface.Plan) {
    if (!planSlot) {
      return (
        <SurfacePlaceholder
          title="No plan yet."
          body="The moment Claude exits plan mode — or renders one with canvas_plan — it appears here, editable."
        />
      );
    }
    return <SlotView sessionId={sessionId} slot={planSlot} connected={connected} />;
  }

  if (view.surface === Surface.Board) {
    return <BoardView sessionId={sessionId} subscribeToEvents={subscribeToEvents} />;
  }

  if (view.surface === Surface.Explorer) {
    return <ExplorerView sessionId={sessionId} />;
  }

  if (view.surface === Surface.Graph) {
    return <GraphView sessionId={sessionId} />;
  }

  if (view.surface === Surface.Costs) {
    return <CostsView sessionId={sessionId} />;
  }

  if (view.surface === Surface.Context) {
    return <ContextView sessionId={sessionId} />;
  }

  if (view.surface === Surface.Safety) {
    return <SafetyView sessionId={sessionId} />;
  }

  if (transcript.items.length === 0) {
    return <WelcomeCard sessionId={sessionId} connected={connected} />;
  }
  return <TranscriptView transcript={transcript} isWorking={isClaudeWorking} />;
}

function SlotView({
  sessionId,
  slot,
  connected,
}: {
  sessionId: string;
  slot: Slot;
  connected: boolean;
}) {
  return (
    <>
      <SlotHeader sessionId={sessionId} slot={slot} connected={connected} />
      <section className="flex-1 px-7 pb-7 overflow-auto scroll-fade-top">
        <SlotRenderer sessionId={sessionId} slot={slot} />
      </section>
    </>
  );
}

function SurfacePlaceholder({ title, body }: { title: string; body: string }) {
  return (
    <section className="flex-1 flex items-center justify-center px-6 py-12">
      <div className="bg-card max-w-xl p-10 text-left" style={{ borderRadius: "var(--radius)" }}>
        <h2 className="h-display text-3xl mb-3">{title}</h2>
        <p className="text-base leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </section>
  );
}

function TopBar({
  sessions,
  currentSessionId,
}: {
  sessions: SessionSummary[];
  currentSessionId: string;
}) {
  return (
    <header className="h-[72px] shrink-0 px-8 flex items-center gap-3">
      <Mark />
      <span className="text-[19px] font-semibold tracking-tight leading-none">clawd</span>
      <span className="text-[19px] font-light text-muted-foreground tracking-tight leading-none">
        canvas
      </span>
      <div className="flex-1" />
      <SessionSwitcher sessions={sessions} currentSessionId={currentSessionId} />
    </header>
  );
}

// Logo mark — per Style Guide.html SVG, rounded square outline + two
// horizontal "lines" suggesting a doc/canvas.
function Mark() {
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 shrink-0">
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
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

// Slot header row per the diagram mockup's file header — kind icon + title
// on the left, status pills beside them, actions pushed right.
function SlotHeader({
  sessionId,
  slot,
  connected,
}: {
  sessionId: string;
  slot: Slot;
  connected: boolean;
}) {
  const status = slotStatusPill(slot.status);

  return (
    <div className="shrink-0 px-7 pb-4 pt-1 flex items-center gap-3">
      <SlotKindIcon kind={slot.kind} width={16} height={16} className="text-muted-foreground" />
      <span className="text-sm font-medium">{slot.title}</span>
      <StatusPill text={status.text} dotClass={status.dotClass} />
      {connected ? null : <StatusPill text="reconnecting" dotClass="bg-amber-500" />}
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => {
          if (window.confirm("Clear all canvas slots and pending edits?")) {
            void resetSession(sessionId);
          }
        }}
        className="h-8 px-3.5 rounded-full bg-popover text-[12.5px] text-muted-foreground hover:text-foreground transition-colors"
      >
        Clear canvas
      </button>
      <button
        type="button"
        aria-label={`Close ${slot.title}`}
        onClick={() => void deleteSlot(sessionId, slot.id)}
        className="w-8 h-8 rounded-full bg-popover flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
      >
        ✕
      </button>
    </div>
  );
}

function slotStatusPill(status: string): { text: string; dotClass: string } {
  if (status === SlotStatus.Error) return { text: "error", dotClass: "bg-destructive" };
  if (status === SlotStatus.Rendering) return { text: "rendering", dotClass: "bg-amber-500" };
  return { text: "synced", dotClass: "bg-success" };
}

// Small mono status chip per the mockups' Pill — 11px Geist Mono on a card
// surface with a leading state dot.
function StatusPill({ text, dotClass }: { text: string; dotClass: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-card font-mono text-[11px] leading-none text-muted-foreground whitespace-nowrap">
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
      {text}
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

  // key={slot.id}: without a remount, json-render's ActionProvider keeps the
  // first-mounted slot's handler closures when the user switches tabs, so
  // canvas.submit would record edits against the previous slot's id.
  return (
    <SlotErrorBoundary key={slot.id} slotId={slot.id}>
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

// Welcome state for a session with no transcript entries yet (or a slot
// view whose slot vanished).
function WelcomeCard({ sessionId, connected }: { sessionId: string; connected: boolean }) {
  return (
    <section className="flex-1 flex items-center justify-center px-6 py-12">
      <div className="bg-card max-w-xl p-10 text-left" style={{ borderRadius: "var(--radius)" }}>
        <div className="flex items-center justify-between">
          <span className="label">01 / Welcome</span>
          <StatusPill
            text={connected ? "live" : "reconnecting"}
            dotClass={connected ? "bg-success" : "bg-amber-500"}
          />
        </div>
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
