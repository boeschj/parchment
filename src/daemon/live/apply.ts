// The one place a parsed source value becomes a pump write: pluck, then
// append (time-stamped record) or replace, per the source's config.

import { pluckValue, toAppendRecord } from "./parse.ts";
import type { SlotStatePump } from "./pump.ts";
import { LiveApplyMode } from "./types.ts";

export type ApplyTarget = {
  statePath: string;
  pluck: string | null;
  mode: LiveApplyMode;
  window: number;
};

export function applySourceValue(pump: SlotStatePump, target: ApplyTarget, value: unknown): void {
  const plucked = target.pluck ? pluckValue(value, target.pluck) : value;
  if (plucked === undefined) return;
  if (target.mode === LiveApplyMode.Replace) {
    pump.replace(target.statePath, plucked);
    return;
  }
  pump.append(target.statePath, [toAppendRecord(plucked, Date.now())], target.window);
}
