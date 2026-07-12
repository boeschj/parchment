// Ground truth for the parchment arm: did the daemon actually receive a slot
// whose spec contains the components this scenario requires? This hits the
// live daemon's HTTP API rather than replaying the transcript, so a pass here
// means the UI really reached the browser-facing session state — not just
// that the model claimed success.

import type { Slot } from "../../src/shared/types.ts";
import type { ParchmentRequirement } from "../scenarios/types.ts";
import type { ValidationResult } from "../types.ts";

const TOKEN_HEADER = "x-canvas-token";

export type FetchSlotsOptions = {
  daemonBaseUrl: string;
  daemonToken: string;
  sessionId: string;
};

export async function fetchSessionSlots({
  daemonBaseUrl,
  daemonToken,
  sessionId,
}: FetchSlotsOptions): Promise<Slot[]> {
  const response = await fetch(`${daemonBaseUrl}/api/sessions/${encodeURIComponent(sessionId)}/state`, {
    headers: { [TOKEN_HEADER]: daemonToken },
  });
  if (!response.ok) {
    throw new Error(`fetching session state failed (${response.status}): ${await response.text()}`);
  }
  const payload = (await response.json()) as { slots: Slot[] };
  return payload.slots;
}

export function validateParchmentSlots(slots: Slot[], requirement: ParchmentRequirement): ValidationResult {
  const countByComponentType = countComponentTypesAcrossSlots(slots);
  const reasons = Object.entries(requirement.minimumCountByComponentType).flatMap(
    ([componentType, minimumCount]) => {
      const actualCount = countByComponentType.get(componentType) ?? 0;
      if (actualCount >= minimumCount) return [];
      return [`expected >= ${minimumCount} "${componentType}" component(s), found ${actualCount}`];
    },
  );

  return { passed: reasons.length === 0, reasons };
}

function countComponentTypesAcrossSlots(slots: Slot[]): Map<string, number> {
  const countByComponentType = new Map<string, number>();
  for (const slot of slots) {
    for (const element of Object.values(slot.spec.elements)) {
      countByComponentType.set(element.type, (countByComponentType.get(element.type) ?? 0) + 1);
    }
  }
  return countByComponentType;
}
