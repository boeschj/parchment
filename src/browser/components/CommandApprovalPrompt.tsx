// The consent gate for command-poll sources.
//
// A coding agent can ask the daemon to run a shell command on a timer, forever,
// across restarts. That is not something to discover later in a log, so it is
// shown here: the EXACT command text, unabbreviated and unstyled, the interval,
// and the slot it feeds. Nothing runs until someone clicks.
//
// The three choices are deliberately unequal. "Approve" writes the command's
// hash to ~/.parchment/approved-commands.json and survives restarts. "This
// session only" is remembered in daemon memory and is forgotten on restart.
// "Deny" forgets the source entirely.

import type { LiveSourceView } from "../../shared/types.ts";
import { CommandApprovalScope } from "../../shared/types.ts";
import { formatInterval, slotLabel } from "../live-source-format.ts";
import type { Slot } from "../../shared/types.ts";

type CommandApprovalPromptProps = {
  pending: LiveSourceView[];
  slots: Slot[];
  onApprove: (source: LiveSourceView, scope: CommandApprovalScope) => void;
  onDeny: (source: LiveSourceView) => void;
};

export function CommandApprovalPrompt({
  pending,
  slots,
  onApprove,
  onDeny,
}: CommandApprovalPromptProps) {
  if (pending.length === 0) return null;

  return (
    <section
      className="shrink-0 mx-7 mb-4 border border-amber-500/60 bg-amber-500/10 overflow-hidden"
      style={{ borderRadius: "var(--radius)" }}
      aria-label="Command approval required"
    >
      <header className="px-5 pt-4 pb-2 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-amber-500" />
        <h2 className="text-sm font-semibold m-0">
          {headline(pending.length)}
        </h2>
      </header>
      <p className="px-5 pb-3 m-0 text-[12.5px] leading-relaxed text-muted-foreground">
        Claude asked parchment to run a command on a repeating timer. It will keep running in the
        background — across daemon restarts, if you approve it permanently — until you stop it.
        Nothing has run yet.
      </p>
      <ul className="list-none m-0 p-0">
        {pending.map((source) => (
          <PendingCommand
            key={`${source.slotId}:${source.sourceId}`}
            source={source}
            slots={slots}
            onApprove={onApprove}
            onDeny={onDeny}
          />
        ))}
      </ul>
    </section>
  );
}

function PendingCommand({
  source,
  slots,
  onApprove,
  onDeny,
}: {
  source: LiveSourceView;
  slots: Slot[];
  onApprove: (source: LiveSourceView, scope: CommandApprovalScope) => void;
  onDeny: (source: LiveSourceView) => void;
}) {
  const target = slotLabel(source.slotId, slots);
  const cadence = formatInterval(source.intervalMs);

  return (
    <li className="px-5 py-4 border-t border-amber-500/25">
      <pre className="m-0 mb-3 p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-all bg-background/70 text-foreground" style={{ borderRadius: "var(--radius-md)" }}>
        {source.target}
      </pre>
      <p className="m-0 mb-3 font-mono text-[11px] text-muted-foreground">
        every {cadence} · feeds {target} at {source.statePath}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onApprove(source, CommandApprovalScope.Persistent)}
          className="h-8 px-3.5 rounded-full bg-foreground text-background text-[12.5px] font-medium hover:opacity-90 transition-opacity"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => onApprove(source, CommandApprovalScope.Session)}
          className="h-8 px-3.5 rounded-full bg-popover text-[12.5px] text-foreground hover:bg-muted transition-colors"
        >
          Approve for this session
        </button>
        <button
          type="button"
          onClick={() => onDeny(source)}
          className="h-8 px-3.5 rounded-full bg-popover text-[12.5px] text-destructive hover:bg-destructive/10 transition-colors"
        >
          Deny
        </button>
      </div>
    </li>
  );
}

function headline(count: number): string {
  if (count === 1) return "Approve this recurring command?";
  return `Approve ${count} recurring commands?`;
}
