// Public entry points the slot chrome calls. Each one produces a complete
// artifact from a live slot with no daemon round-trip: an HTML file into
// ~/Downloads, a clean print/PDF window, or React source on the clipboard.
// The heavy DOM-capture module is imported lazily so it only loads when the
// user actually exports.

import type { Slot } from "../../shared/types.ts";
import {
  ExportMode,
  buildStandaloneHtmlDocument,
  exportFilenameStem,
} from "./standalone-html.ts";
import { specToReactSource } from "./react-source.ts";
import { copyTextToClipboard, downloadTextFile, openHtmlInNewWindow } from "./download.ts";

async function buildSlotHtml(sessionId: string, slot: Slot, mode: ExportMode): Promise<string> {
  const { captureSlotHtml } = await import("./dom-capture.ts");
  const captured = await captureSlotHtml(sessionId, slot);
  return buildStandaloneHtmlDocument({
    title: slot.title,
    bodyHtml: captured.bodyHtml,
    css: captured.css,
    generatedAtIso: new Date().toISOString(),
    mode,
  });
}

export async function exportSlotAsHtml(sessionId: string, slot: Slot): Promise<void> {
  const html = await buildSlotHtml(sessionId, slot, ExportMode.Screen);
  downloadTextFile(`${exportFilenameStem(slot.title)}.html`, html, "text/html");
}

export async function printSlot(sessionId: string, slot: Slot): Promise<void> {
  const html = await buildSlotHtml(sessionId, slot, ExportMode.Print);
  openHtmlInNewWindow(html);
}

export async function copySlotAsReact(slot: Slot): Promise<void> {
  const source = specToReactSource(slot.spec, { componentName: slot.title });
  await copyTextToClipboard(source);
}
