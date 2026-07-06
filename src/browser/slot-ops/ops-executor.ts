// Executes Claude's slot ops in this tab and reports back to the daemon.
// exportPng renders the slot into an offscreen container (real layout, just
// parked far off-viewport — charts and monaco need geometry, so display:none
// would break them) through the same registry/provider stack SlotRenderer
// uses, waits for the render to settle, and rasterizes it with html-to-image.
//
// No requestAnimationFrame anywhere: snapshots usually run while this tab is
// hidden, and hidden tabs throttle rAF indefinitely. React's scheduler,
// timers, and DOM polling all keep working in hidden tabs.

import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { toPng } from "html-to-image";
import { JSONUIProvider, Renderer, type Spec } from "@json-render/react";
import type { Slot, SlotOps, SlotOpsResult } from "../../shared/types.ts";
import { registry } from "../registry.ts";
import { SlotContextProvider } from "../SlotContext.tsx";
import { fetchSessionSlots } from "../api.ts";

const CAPTURE_WIDTH_PX = 960;
const OFFSCREEN_LEFT_PX = -20000;
const CONTENT_POLL_INTERVAL_MS = 50;
const CONTENT_POLL_BUDGET_MS = 5000;
const RENDER_SETTLE_MS = 1200;
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

export async function executeSlotOps(sessionId: string, ops: SlotOps): Promise<SlotOpsResult> {
  if (ops.exportPng) {
    return exportSlotPng(sessionId, ops.exportPng.slotId);
  }
  return { ok: false, error: "slot ops request contained no supported operation" };
}

async function exportSlotPng(sessionId: string, slotId: string): Promise<SlotOpsResult> {
  const slots = await fetchSessionSlots(sessionId);
  const slot = slots.find((candidate) => candidate.id === slotId);
  if (!slot) {
    const knownIds = slots.map((candidate) => candidate.id).join(", ") || "none";
    return {
      ok: false,
      error: `slot "${slotId}" not found in session ${sessionId} (known slots: ${knownIds})`,
    };
  }

  const container = createOffscreenContainer();
  let renderError: unknown = null;
  const root = createRoot(container, {
    onUncaughtError: (error) => {
      renderError = error;
    },
  });

  try {
    root.render(offscreenSlotTree(sessionId, slot));
    await document.fonts.ready;
    await waitForContent(container, () => renderError !== null);
    if (renderError !== null) {
      return { ok: false, error: `slot render failed: ${describeError(renderError)}` };
    }
    await sleep(RENDER_SETTLE_MS);

    const rect = container.getBoundingClientRect();
    const backgroundColor = getComputedStyle(container).backgroundColor;
    const dataUrl = await toPng(container, { backgroundColor, pixelRatio: 1 });
    if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
      return { ok: false, error: "html-to-image did not return a PNG data URL" };
    }
    return {
      ok: true,
      pngBase64: dataUrl.slice(PNG_DATA_URL_PREFIX.length),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  } catch (error) {
    return { ok: false, error: `slot export failed: ${describeError(error)}` };
  } finally {
    root.unmount();
    container.remove();
  }
}

// Same provider stack as App's SlotRenderer, minus interactivity: nobody
// clicks an offscreen snapshot, so action handlers are empty and state
// changes have nowhere to flow.
function offscreenSlotTree(sessionId: string, slot: Slot) {
  const renderer = createElement(Renderer, { spec: slot.spec as Spec, registry });
  const provider = createElement(JSONUIProvider, {
    registry,
    initialState: slot.state ?? {},
    handlers: {},
    children: renderer,
  });
  return createElement(SlotContextProvider, {
    sessionId,
    slotId: slot.id,
    children: provider,
  });
}

function createOffscreenContainer(): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "bg-background text-foreground p-6";
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = `${OFFSCREEN_LEFT_PX}px`;
  container.style.width = `${CAPTURE_WIDTH_PX}px`;
  document.body.appendChild(container);
  return container;
}

// React commits asynchronously; poll until the tree has actually mounted (or
// the render threw) before starting the settle countdown.
async function waitForContent(container: HTMLElement, hasFailed: () => boolean): Promise<void> {
  const deadline = Date.now() + CONTENT_POLL_BUDGET_MS;
  while (Date.now() < deadline) {
    if (hasFailed()) return;
    if (container.childElementCount > 0) return;
    await sleep(CONTENT_POLL_INTERVAL_MS);
  }
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
