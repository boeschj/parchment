// What the canvas is currently showing: one of the fixed surfaces (always
// present in the rail) or one dynamic slot.

import type { Slot } from "../shared/types.ts";
import { SlotKind } from "../shared/types.ts";

export const Surface = {
  Transcript: "transcript",
  Plan: "plan",
} as const;

export type Surface = (typeof Surface)[keyof typeof Surface];

export type CanvasView =
  | { type: "surface"; surface: Surface }
  | { type: "slot"; slotId: string };

export type ViewChoice = {
  view: CanvasView;
  // The newest slot activity visible at click time. Comparing daemon
  // timestamps against each other (instead of against the browser clock)
  // makes the rule immune to clock skew.
  newestSeenUpdatedAt: number;
};

export function newestSlotUpdatedAt(slots: Slot[]): number {
  const newest = newestSlot(slots);
  return newest === null ? 0 : newest.updatedAt;
}

// Jarvis rule: the canvas follows whatever Claude just pushed — a new or
// updated slot pulls focus, because a push IS the "look at this" signal.
// A user click wins only until the next push. Pure derivation, no effects.
export function resolveView(choice: ViewChoice | null, slots: Slot[]): CanvasView {
  const newest = newestSlot(slots);
  const choiceStillExists = choice !== null && viewExists(choice.view, slots);
  const userChoiceIsCurrent =
    choiceStillExists && (newest === null || choice.newestSeenUpdatedAt >= newest.updatedAt);
  if (userChoiceIsCurrent) return choice.view;
  return followView(newest);
}

function viewExists(view: CanvasView, slots: Slot[]): boolean {
  if (view.type === "surface") return true;
  return slots.some((slot) => slot.id === view.slotId);
}

function newestSlot(slots: Slot[]): Slot | null {
  if (slots.length === 0) return null;
  return slots.reduce((latest, slot) => (slot.updatedAt > latest.updatedAt ? slot : latest));
}

function followView(newest: Slot | null): CanvasView {
  if (newest === null) return { type: "surface", surface: Surface.Transcript };
  if (newest.kind === SlotKind.Plan) return { type: "surface", surface: Surface.Plan };
  return { type: "slot", slotId: newest.id };
}

// Plan slots render inside the fixed Plan surface (latest wins), so the
// dynamic rail section only lists the rest.
export function latestPlanSlot(slots: Slot[]): Slot | null {
  const planSlots = slots.filter((slot) => slot.kind === SlotKind.Plan);
  return planSlots[planSlots.length - 1] ?? null;
}

export function dynamicSlots(slots: Slot[]): Slot[] {
  return slots.filter((slot) => slot.kind !== SlotKind.Plan);
}
