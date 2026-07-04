import { useState } from "react";
import { SessionStatus, type SessionSummary } from "../../shared/types.ts";
import { shortSessionLabel } from "../session.ts";

const STATUS_META = {
  [SessionStatus.Complete]: { dot: "bg-success", label: "complete" },
  [SessionStatus.Working]: { dot: "bg-amber-500", label: "working" },
  [SessionStatus.Blocked]: { dot: "bg-destructive", label: "blocked" },
} as const;

export function SessionSwitcher({
  sessions,
  currentSessionId,
}: {
  sessions: SessionSummary[];
  currentSessionId: string;
}) {
  const [open, setOpen] = useState(false);

  const ordered = [...sessions].sort((a, b) => b.lastPing - a.lastPing);
  const current = sessions.find((session) => session.sessionId === currentSessionId);
  const currentMeta = statusMeta(current?.status);

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
        <span className="font-mono">{shortSessionLabel(currentSessionId)}</span>
        <span className="text-[10px] opacity-70" aria-hidden>
          ▾
        </span>
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
  const highlightClass = isCurrent ? "bg-accent" : "hover:bg-accent";

  return (
    <button
      type="button"
      onClick={() => onSelect(session.sessionId)}
      className={`flex items-center gap-2.5 px-2 py-2 text-left transition-colors ${highlightClass}`}
      style={{ borderRadius: "var(--radius-sm)" }}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`} title={meta.label} />
      <span className="font-mono text-[12.5px] shrink-0">{shortSessionLabel(session.sessionId)}</span>
      <span className="text-[12px] text-muted-foreground truncate">{cwdLabel(session.cwd)}</span>
      <span className="flex-1" />
      <span className="text-[11px] text-muted-foreground font-mono shrink-0">{meta.label}</span>
    </button>
  );
}

function statusMeta(status: SessionStatus | undefined): { dot: string; label: string } {
  if (status && status in STATUS_META) return STATUS_META[status];
  return STATUS_META[SessionStatus.Complete];
}

function cwdLabel(cwd: string): string {
  if (!cwd) return "—";
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}
