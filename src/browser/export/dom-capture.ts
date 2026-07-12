// Renders a slot's presentation spec into a real offscreen DOM subtree so that
// recharts and mermaid actually paint their SVG (both need layout geometry —
// display:none would break them), then serializes that subtree to static HTML.
//
// Why serialize the live DOM rather than server-side-render: recharts measures
// its container width at runtime and mermaid is a browser renderer. The already-
// mounted tree IS the source of truth — capturing it preserves exact data
// fidelity (every chart is the rendered SVG, every table row is real DOM — the
// DataTable renders all rows, nothing virtualized). We only un-clip the bounded
// scroll regions so full tables/code/diagrams flow into the document instead of
// into a dead scrollbar. Same offscreen-render approach the PNG snapshot uses.

import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { JSONUIProvider, Renderer, type Spec } from "@json-render/react";
import type { Slot } from "../../shared/types.ts";
import { registry } from "../registry.ts";
import { SlotContextProvider } from "../SlotContext.tsx";
import { toPresentationSpec } from "./spec-presentation.ts";

const CAPTURE_WIDTH_PX = 960;
const OFFSCREEN_LEFT_PX = -20000;
const CONTENT_POLL_INTERVAL_MS = 50;
const CONTENT_POLL_BUDGET_MS = 5000;
const RENDER_SETTLE_MS = 1500;

export type CapturedSlot = {
  bodyHtml: string;
  css: string;
};

// Concatenates every same-origin stylesheet the app has loaded (compiled
// Tailwind utilities, theme tokens, component CSS, mermaid's injected styles).
// Cross-origin sheets throw on cssRules access — skipped rather than fatal.
export function collectDocumentCss(): string {
  const blocks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = Array.from(sheet.cssRules);
      blocks.push(rules.map((rule) => rule.cssText).join("\n"));
    } catch {
      // Opaque cross-origin sheet — nothing we can inline; keep going.
    }
  }
  return blocks.join("\n");
}

export async function captureSlotHtml(sessionId: string, slot: Slot): Promise<CapturedSlot> {
  const presentationSlot = { ...slot, spec: toPresentationSpec(slot.spec) };
  const container = createOffscreenContainer();
  let renderError: unknown = null;
  const root = createRoot(container, {
    onUncaughtError: (error) => {
      renderError = error;
    },
  });

  try {
    root.render(offscreenSlotTree(sessionId, presentationSlot));
    await document.fonts.ready;
    await waitForContent(container, () => renderError !== null);
    if (renderError !== null) {
      throw new Error(`slot render failed: ${describeError(renderError)}`);
    }
    await sleep(RENDER_SETTLE_MS);
    unclipScrollRegions(container);
    return { bodyHtml: container.innerHTML, css: collectDocumentCss() };
  } finally {
    root.unmount();
    container.remove();
  }
}

// Same provider stack the app's SlotRenderer uses, minus interactivity: no one
// clicks an offscreen tree, so handlers are empty.
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
  container.className = "bg-background text-foreground";
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = `${OFFSCREEN_LEFT_PX}px`;
  container.style.width = `${CAPTURE_WIDTH_PX}px`;
  document.body.appendChild(container);
  return container;
}

// React commits asynchronously; wait until the tree has mounted (or thrown)
// before starting the settle countdown that lets charts/diagrams finish.
async function waitForContent(container: HTMLElement, hasFailed: () => boolean): Promise<void> {
  const deadline = Date.now() + CONTENT_POLL_BUDGET_MS;
  while (Date.now() < deadline) {
    if (hasFailed()) return;
    if (container.childElementCount > 0) return;
    await sleep(CONTENT_POLL_INTERVAL_MS);
  }
}

// A bounded scroll region (DataTable's max-height, the mermaid pane's cap) clips
// content behind a scrollbar that a static file cannot scroll. Expand every one
// so all rows/lines/diagram flow into the page. Only max-height carries the clip
// — fixed chart heights use `height`, which we leave alone so recharts keeps its
// aspect.
function unclipScrollRegions(container: HTMLElement): void {
  const nodes = container.querySelectorAll<HTMLElement>("*");
  for (const node of Array.from(nodes)) {
    const computed = getComputedStyle(node);
    if (computed.maxHeight === "none") continue;
    node.style.maxHeight = "none";
    node.style.overflow = "visible";
  }
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
