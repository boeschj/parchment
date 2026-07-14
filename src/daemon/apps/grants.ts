// What one app slot's iframe is allowed to do.
//
// A grant is minted when an app is opened into a slot: the daemon lists the
// server's tools, computes the app-visible set (SEP-1865 `_meta.ui.visibility`,
// see visibility.ts), and binds it to that slot. Every bridge call from the
// iframe is authorized against the grant of the slot it came from.
//
// SECURITY: the grant — not the request — decides which server a call reaches.
// The browser names a session and a slot; the daemon looks up the server from
// the slot IT wrote. An iframe therefore cannot reach a second app's server by
// naming it, and cannot reach a tool on its OWN server that the server never
// declared app-visible. Grants are also validated against live session state on
// every call, so a closed slot's grant is dead the moment the slot is gone.

import { SlotKind, type Slot } from "../../shared/types.ts";
import { McpAppPropsSchema } from "../../shared/catalog/extensions/McpApp.ts";
import { ensureSession } from "../sessions.ts";
import { resolveAppServer } from "./config.ts";
import { getAppConnection, listAppTools } from "./connections.ts";
import { appVisibleToolNames } from "./visibility.ts";

export type AppSlotGrant = {
  sessionId: string;
  slotId: string;
  server: string;
  appVisibleTools: readonly string[];
  grantedAt: number;
};

const grants = new Map<string, AppSlotGrant>();

function grantKey(sessionId: string, slotId: string): string {
  return `${sessionId}::${slotId}`;
}

export function recordAppSlotGrant(grant: Omit<AppSlotGrant, "grantedAt">): AppSlotGrant {
  const recorded: AppSlotGrant = { ...grant, grantedAt: Date.now() };
  grants.set(grantKey(grant.sessionId, grant.slotId), recorded);
  return recorded;
}

// The grant for a live app slot, recomputed from the server's declarations if
// this daemon never minted one (the slot survived a restart on disk; the app
// server did not). Returns null when the slot is gone or was never an app slot
// — there is nothing to authorize against, so the bridge must refuse.
export async function resolveAppSlotGrant(
  sessionId: string,
  slotId: string,
): Promise<AppSlotGrant | null> {
  const key = grantKey(sessionId, slotId);
  const server = appServerOfSlot(sessionId, slotId);
  if (server === null) {
    grants.delete(key);
    return null;
  }

  const cached = grants.get(key);
  const cacheMatchesSlot = cached !== undefined && cached.server === server;
  if (cacheMatchesSlot) return cached;

  const appVisibleTools = await fetchAppVisibleTools(server);
  return recordAppSlotGrant({ sessionId, slotId, server, appVisibleTools });
}

export async function fetchAppVisibleTools(server: string): Promise<string[]> {
  const config = resolveAppServer(server);
  if (!config) throw new Error(`unknown app server "${server}"`);
  const connection = await getAppConnection(server, config);
  const tools = await listAppTools(connection);
  return appVisibleToolNames(tools.tools);
}

// The server name comes from the McpApp props the DAEMON composed at open time
// (open.ts) and persisted with the slot — never from the request.
function appServerOfSlot(sessionId: string, slotId: string): string | null {
  const slot = ensureSession(sessionId).slots.find((candidate) => candidate.id === slotId);
  if (!slot || slot.kind !== SlotKind.App) return null;
  return appServerOfSpec(slot);
}

function appServerOfSpec(slot: Slot): string | null {
  const rootElement = slot.spec.elements[slot.spec.root];
  if (!rootElement) return null;
  const parsed = McpAppPropsSchema.safeParse(rootElement.props);
  if (!parsed.success) return null;
  return parsed.data.server;
}
