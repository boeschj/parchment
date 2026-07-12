import { useState } from "react";
import { Download } from "lucide-react";
import type { Slot } from "../../shared/types.ts";
import { copySlotAsReact, exportSlotAsHtml, printSlot } from "../export/index.ts";

type SlotExportMenuProps = {
  sessionId: string;
  slot: Slot;
};

const STATUS_CLEAR_MS = 2200;

const ExportAction = {
  Html: "html",
  Pdf: "pdf",
  React: "react",
} as const;

type ExportAction = (typeof ExportAction)[keyof typeof ExportAction];

const ACTION_LABELS: Record<ExportAction, string> = {
  [ExportAction.Html]: "Download HTML",
  [ExportAction.Pdf]: "Print / Save as PDF",
  [ExportAction.React]: "Copy as React",
};

const ACTION_PENDING: Record<ExportAction, string> = {
  [ExportAction.Html]: "Building HTML…",
  [ExportAction.Pdf]: "Preparing print…",
  [ExportAction.React]: "Copying…",
};

const ACTION_DONE: Record<ExportAction, string> = {
  [ExportAction.Html]: "Saved to Downloads",
  [ExportAction.Pdf]: "Print window opened",
  [ExportAction.React]: "React copied",
};

export function SlotExportMenu({ sessionId, slot }: SlotExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const runAction = async (action: ExportAction): Promise<void> => {
    setOpen(false);
    setBusy(true);
    setStatus(ACTION_PENDING[action]);
    try {
      await performAction(action, sessionId, slot);
      setStatus(ACTION_DONE[action]);
    } catch (error) {
      console.error("[export] action failed", action, error);
      setStatus("Export failed");
    } finally {
      setBusy(false);
      window.setTimeout(() => setStatus(null), STATUS_CLEAR_MS);
    }
  };

  const statusLabel = status;

  return (
    <div className="relative">
      {statusLabel ? (
        <span className="mr-2 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
          {statusLabel}
        </span>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen((current) => !current)}
        className="h-8 px-3.5 rounded-full bg-popover text-[12.5px] text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
      >
        <Download width={13} height={13} />
        Export
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close export menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div
            className="absolute right-0 top-9 z-20 w-52 bg-popover p-1.5 shadow-lg"
            style={{ borderRadius: "var(--radius-md)", border: "1px solid var(--hairline)" }}
          >
            {Object.values(ExportAction).map((action) => (
              <button
                key={action}
                type="button"
                onClick={() => void runAction(action)}
                className="w-full text-left px-3 py-2 rounded-lg text-[13px] text-foreground hover:bg-muted transition-colors"
              >
                {ACTION_LABELS[action]}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

async function performAction(action: ExportAction, sessionId: string, slot: Slot): Promise<void> {
  if (action === ExportAction.Html) return exportSlotAsHtml(sessionId, slot);
  if (action === ExportAction.Pdf) return printSlot(sessionId, slot);
  return copySlotAsReact(slot);
}
