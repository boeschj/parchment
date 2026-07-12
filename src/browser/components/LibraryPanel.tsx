// The "Library" surface — every saved UI (starter templates + anything the
// user asked Claude to save via canvas_library) as a card grid, with actions to
// open a copy into a slot or delete it. The daemon seeds a fresh install's
// library with the starter templates (see src/daemon/library.ts), so this
// panel is never empty on a first run.

import { useState } from "react";
import type { LibraryListing, Slot } from "../../shared/types.ts";
import { deleteLibraryEntry, openLibraryEntryInSlot } from "../api.ts";
import { formatRelativeAge } from "../time.ts";
import { useLibraryEntries } from "../useLibraryEntries.ts";
import { SlotKindIcon, TrashIcon } from "./icons.tsx";

type LibraryPanelProps = {
  sessionId: string;
  onOpenInSlot: (slot: Slot) => void;
};

export function LibraryPanel({ sessionId, onOpenInSlot }: LibraryPanelProps) {
  const { entries, refresh } = useLibraryEntries();
  const [busyName, setBusyName] = useState<string | null>(null);

  const handleOpen = async (entry: LibraryListing): Promise<void> => {
    setBusyName(entry.name);
    try {
      const slot = await openLibraryEntryInSlot(sessionId, entry.name);
      onOpenInSlot(slot);
    } catch (error) {
      console.error("[library] failed to open entry", { name: entry.name, error });
    } finally {
      setBusyName(null);
    }
  };

  const handleDelete = async (entry: LibraryListing): Promise<void> => {
    if (!window.confirm(`Delete "${entry.title}" from your library?`)) return;
    setBusyName(entry.name);
    try {
      await deleteLibraryEntry(entry.name);
      refresh();
    } catch (error) {
      console.error("[library] failed to delete entry", { name: entry.name, error });
    } finally {
      setBusyName(null);
    }
  };

  return (
    <section className="flex-1 overflow-auto scroll-fade-top px-7 pt-6 pb-7">
      <header className="mb-5">
        <h2 className="h-display text-2xl mb-1">Library</h2>
        <p className="text-sm text-muted-foreground">
          Saved UIs — starter templates and anything you've asked Claude to keep with canvas_library.
        </p>
      </header>

      {entries.length === 0 ? (
        <EmptyLibrary />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {entries.map((entry) => (
            <LibraryCard
              key={entry.name}
              entry={entry}
              isBusy={busyName === entry.name}
              onOpen={() => void handleOpen(entry)}
              onDelete={() => void handleDelete(entry)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function LibraryCard({
  entry,
  isBusy,
  onOpen,
  onDelete,
}: {
  entry: LibraryListing;
  isBusy: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const meta = `${entry.kind} · ${entry.elementCount} components · ${formatRelativeAge(entry.savedAt)}`;

  return (
    <div className="bg-card p-5 flex flex-col gap-3" style={{ borderRadius: "var(--radius)" }}>
      <div className="flex items-start gap-2.5">
        <SlotKindIcon kind={entry.kind} width={18} height={18} className="text-muted-foreground shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[14.5px] font-medium leading-snug truncate">{entry.title}</h3>
          <p className="text-[11px] font-mono text-muted-foreground truncate">{entry.name}</p>
        </div>
      </div>

      <p className="text-[11.5px] text-muted-foreground font-mono">{meta}</p>

      <div className="flex-1" />

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          disabled={isBusy}
          onClick={onOpen}
          className="flex-1 h-8 rounded-full bg-primary text-primary-foreground text-[12.5px] font-medium disabled:opacity-50 transition-opacity"
        >
          Open
        </button>
        <button
          type="button"
          disabled={isBusy}
          aria-label={`Delete ${entry.title}`}
          onClick={onDelete}
          className="w-8 h-8 rounded-full bg-popover flex items-center justify-center text-muted-foreground hover:text-destructive disabled:opacity-50 transition-colors"
        >
          <TrashIcon width={14} height={14} />
        </button>
      </div>
    </div>
  );
}

function EmptyLibrary() {
  return (
    <div className="bg-card max-w-xl p-10 text-left" style={{ borderRadius: "var(--radius)" }}>
      <h3 className="h-display text-xl mb-3">Nothing saved yet.</h3>
      <p className="text-base leading-relaxed text-muted-foreground">
        Ask Claude to save a rendered view — "save this dashboard as perf-overview" — and it appears
        here, ready to reopen any time with a click.
      </p>
    </div>
  );
}
