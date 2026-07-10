import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { SessionStatus, type SessionSummary } from "../../shared/types.ts";
import { shortSessionLabel } from "../session.ts";

const STATUS_META = {
  [SessionStatus.Complete]: { dot: "bg-success", label: "complete" },
  [SessionStatus.Working]: { dot: "bg-amber-500", label: "working" },
  [SessionStatus.Blocked]: { dot: "bg-destructive", label: "blocked" },
} as const;

const CURRENT_LABEL = "current";

export function SessionSwitcher({
  sessions,
  currentSessionId,
}: {
  sessions: SessionSummary[];
  currentSessionId: string;
}) {
  const [open, setOpen] = useState(false);

  const byRecency = [...sessions].sort((a, b) => b.lastPing - a.lastPing);
  const ordered = pinCurrentFirst(byRecency, currentSessionId);
  const current = sessions.find((session) => session.sessionId === currentSessionId);
  const currentMeta = statusMeta(current?.status);
  const currentShortId = shortSessionLabel(currentSessionId);
  const currentName = triggerLabel(current, currentShortId);

  const switchTo = (sessionId: string): void => {
    setOpen(false);
    if (sessionId !== currentSessionId) {
      window.location.search = `?session=${encodeURIComponent(sessionId)}`;
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-card text-[12.5px] text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Switch session"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${currentMeta.dot}`} />
        <span className="max-w-[14rem] truncate text-foreground">{currentName}</span>
        <span className="font-mono text-[11px] opacity-70">{currentShortId}</span>
        <ChevronDown size={13} className="opacity-70" aria-hidden />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 mt-2 z-20 w-80 bg-popover text-popover-foreground p-2 shadow-lg"
            style={{ borderRadius: "var(--radius-md)" }}
          >
            <div className="label px-2 py-1.5">Sessions</div>
            <div className="max-h-[60vh] overflow-y-auto flex flex-col">
              {ordered.map((session) => (
                <SessionRow
                  key={session.sessionId}
                  session={session}
                  isCurrent={session.sessionId === currentSessionId}
                  onSelect={switchTo}
                />
              ))}
              {ordered.length === 0 ? (
                <div className="px-2 py-3 text-sm text-muted-foreground">No sessions yet.</div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function SessionRow({
  session,
  isCurrent,
  onSelect,
}: {
  session: SessionSummary;
  isCurrent: boolean;
  onSelect: (sessionId: string) => void;
}) {
  const meta = statusMeta(session.status);
  const highlightClass = isCurrent
    ? "bg-primary/10 ring-1 ring-inset ring-primary/30"
    : "hover:bg-accent";
  const markerColor = isCurrent ? "var(--primary)" : "transparent";
  const labels = rowLabels(session);

  return (
    <button
      type="button"
      onClick={() => onSelect(session.sessionId)}
      className={`flex items-stretch gap-2.5 px-2 py-2 text-left transition-colors ${highlightClass}`}
      style={{ borderRadius: "var(--radius-sm)" }}
    >
      <span className="w-0.5 shrink-0 rounded-full" style={{ background: markerColor }} />
      <span className={`w-2 h-2 mt-1 rounded-full shrink-0 ${meta.dot}`} title={meta.label} />
      <span className="min-w-0 flex-1 flex flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className="text-[12.5px] text-foreground truncate flex-1">{labels.primary}</span>
          {isCurrent ? (
            <span className="label shrink-0 !text-primary">{CURRENT_LABEL}</span>
          ) : null}
        </span>
        {labels.secondary ? (
          <span className="text-[11px] text-muted-foreground font-mono truncate">{labels.secondary}</span>
        ) : null}
      </span>
      <span className="text-[11px] text-muted-foreground font-mono shrink-0 self-center">{meta.label}</span>
    </button>
  );
}

function pinCurrentFirst(
  sessions: SessionSummary[],
  currentSessionId: string,
): SessionSummary[] {
  const current = sessions.filter((session) => session.sessionId === currentSessionId);
  const rest = sessions.filter((session) => session.sessionId !== currentSessionId);
  return [...current, ...rest];
}

function statusMeta(status: SessionStatus | undefined): { dot: string; label: string } {
  if (status && status in STATUS_META) return STATUS_META[status];
  return STATUS_META[SessionStatus.Complete];
}

function triggerLabel(session: SessionSummary | undefined, shortId: string): string {
  if (session && session.name.length > 0) return session.name;
  return shortId;
}

function rowLabels(session: SessionSummary): { primary: string; secondary: string } {
  const shortId = shortSessionLabel(session.sessionId);
  if (session.summary.length > 0) {
    const secondary = session.name.length > 0 ? `${session.name} · ${shortId}` : shortId;
    return { primary: session.summary, secondary };
  }
  if (session.name.length > 0) {
    return { primary: session.name, secondary: shortId };
  }
  return { primary: shortId, secondary: "" };
}
