// Every live source the daemon is running (or holding for approval) in this
// session. Seeded by a fetch on mount, then kept current by the daemon's
// "live-sources" broadcast — a source that starts, stops, or goes pending shows
// up without polling.

import { useCallback, useEffect, useState } from "react";
import type { CommandApprovalScope, LiveSourceView, WsEvent } from "../shared/types.ts";
import { LiveSourceStatus } from "../shared/types.ts";
import { approveLiveSource, fetchLiveSources, stopLiveSource } from "./api.ts";
import type { WsEventListener } from "./ws.ts";
import { useWsEventSubscription } from "./useWsEventSubscription.ts";

type LiveSourcesModel = {
  sources: LiveSourceView[];
  approve: (source: LiveSourceView, scope: CommandApprovalScope) => Promise<void>;
  stop: (source: LiveSourceView) => Promise<void>;
};

export function useLiveSources(
  sessionId: string,
  subscribeToEvents: (listener: WsEventListener) => () => void,
): LiveSourcesModel {
  const [sources, setSources] = useState<LiveSourceView[]>([]);

  useEffect(() => {
    let isCurrent = true;
    void fetchLiveSources(sessionId).then((fetched) => {
      if (isCurrent) setSources(fetched);
    });
    return () => {
      isCurrent = false;
    };
  }, [sessionId]);

  useWsEventSubscription(
    subscribeToEvents,
    useCallback((event: WsEvent) => {
      if (event.kind !== "live-sources") return;
      setSources(event.data.sources);
    }, []),
  );

  // The daemon broadcasts the new source list as part of handling these, so
  // neither handler writes state itself.
  const approve = useCallback(
    async (source: LiveSourceView, scope: CommandApprovalScope): Promise<void> => {
      await approveLiveSource(sessionId, source.slotId, source.sourceId, scope);
    },
    [sessionId],
  );

  const stop = useCallback(
    async (source: LiveSourceView): Promise<void> => {
      await stopLiveSource(sessionId, source.slotId, source.sourceId);
    },
    [sessionId],
  );

  return { sources, approve, stop };
}

export function pendingApprovalSources(sources: LiveSourceView[]): LiveSourceView[] {
  return sources.filter((source) => source.status === LiveSourceStatus.PendingApproval);
}
