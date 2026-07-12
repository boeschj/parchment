// App-level listener for Claude's slot ops. Lives outside any surface so a
// slot can be snapshotted while the user is on any view — the offscreen
// render machinery loads lazily on the first op.

import type { SlotOps, SlotOpsResult, WsEvent } from "../../shared/types.ts";
import { postSlotOpsResult } from "../api.ts";

export function createSlotOpsListener(sessionId: string): (event: WsEvent) => void {
  return (event) => {
    if (event.kind !== "slot-ops") return;
    void handleOps(sessionId, event.data.requestId, event.data.ops);
  };
}

async function handleOps(sessionId: string, requestId: string, ops: SlotOps): Promise<void> {
  let result: SlotOpsResult;
  try {
    const { executeSlotOps } = await import("./ops-executor.ts");
    result = await executeSlotOps(sessionId, ops);
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  try {
    await postSlotOpsResult(sessionId, requestId, result);
  } catch (error) {
    console.error("[slot-ops] ops-result post failed", error);
  }
}
