// Every live source the daemon is running for this session, and a way to kill
// each one. Background work the user cannot see is background work the user
// cannot revoke, so nothing here is hidden behind a disclosure: kind, target,
// cadence, the slot it feeds, and its health, in one list.

import type { LiveSourceView, Slot } from "../../shared/types.ts";
import { LiveSourceStatus } from "../../shared/types.ts";
import { formatInterval, isExecutingSource, kindLabel, slotLabel } from "../live-source-format.ts";

type LiveSourcesPanelProps = {
  sources: LiveSourceView[];
  slots: Slot[];
  onStop: (source: LiveSourceView) => void;
};

export function LiveSourcesPanel({ sources, slots, onStop }: LiveSourcesPanelProps) {
  const hasSources = sources.length > 0;

  return (
    <section className="flex-1 px-7 pb-7 overflow-auto scroll-fade-top">
      <header className="pt-1 pb-4">
        <h2 className="h-display text-2xl m-0 mb-1">Live sources</h2>
        <p className="m-0 text-[13px] text-muted-foreground">
          Background work the daemon is doing for this session. Stopping a source kills it — and its
          child process — immediately.
        </p>
      </header>

      {hasSources ? (
        <ul className="list-none m-0 p-0 flex flex-col gap-2">
          {sources.map((source) => (
            <LiveSourceRow
              key={`${source.slotId}:${source.sourceId}`}
              source={source}
              slots={slots}
              onStop={onStop}
            />
          ))}
        </ul>
      ) : (
        <EmptyState />
      )}
    </section>
  );
}

function LiveSourceRow({
  source,
  slots,
  onStop,
}: {
  source: LiveSourceView;
  slots: Slot[];
  onStop: (source: LiveSourceView) => void;
}) {
  const isPending = source.status === LiveSourceStatus.PendingApproval;
  const executes = isExecutingSource(source);
  const cadence = formatInterval(source.intervalMs);
  const feeds = slotLabel(source.slotId, slots);
  const stopLabel = isPending ? "Deny" : "Stop";

  return (
    <li className="bg-card p-4 flex items-start gap-4" style={{ borderRadius: "var(--radius)" }}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {kindLabel(source.kind)}
          </span>
          <StatusBadge status={source.status} executes={executes} />
        </div>
        <p className="m-0 font-mono text-[12.5px] break-all text-foreground">{source.target}</p>
        <p className="m-0 mt-1.5 font-mono text-[11px] text-muted-foreground">
          {source.sourceId} · every {cadence} · feeds {feeds} at {source.statePath}
        </p>
        {source.lastError ? (
          <p className="m-0 mt-1.5 font-mono text-[11px] text-destructive">{source.lastError}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onStop(source)}
        className="h-8 px-3.5 shrink-0 rounded-full bg-popover text-[12.5px] text-muted-foreground hover:text-destructive transition-colors"
      >
        {stopLabel}
      </button>
    </li>
  );
}

function StatusBadge({ status, executes }: { status: LiveSourceStatus; executes: boolean }) {
  const isPending = status === LiveSourceStatus.PendingApproval;
  const dotClass = isPending ? "bg-amber-500" : "bg-success";
  const text = isPending ? "awaiting approval" : "running";
  const executesNote = executes && !isPending ? " · executes a shell command" : "";

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] leading-none text-muted-foreground">
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
      {text}
      {executesNote}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="bg-card p-8" style={{ borderRadius: "var(--radius)" }}>
      <p className="m-0 text-[13px] text-muted-foreground">
        Nothing is streaming. Live sources appear here when Claude attaches one to a slot with
        canvas_live — tailing a file, polling an endpoint, or (with your approval) running a shell
        command on a timer.
      </p>
    </div>
  );
}
