import { useEffect, useId, useRef, useState } from "react";
import mermaid from "mermaid";
import type { z } from "zod/v4";
import { EditKind } from "../../shared/types.ts";
import { MermaidEditorPropsSchema } from "../../shared/catalog/extensions/MermaidEditor.ts";
import { useSlotContext } from "../SlotContext.tsx";
import { postEdit } from "../api.ts";
import { useDebouncedCallback } from "../useDebounce.ts";
import { useLocalDraft } from "../useLocalDraft.ts";

type MermaidEditorProps = z.infer<typeof MermaidEditorPropsSchema>;
type RenderProps = { props: MermaidEditorProps };

const MERMAID_SOURCE_ELEMENT = "source";

mermaid.initialize({ startOnLoad: false, theme: "base" });

type RenderState =
  | { status: "rendering" }
  | { status: "ready"; svg: string }
  | { status: "error"; message: string };

export function MermaidEditor({ props }: RenderProps) {
  const { sessionId, slotId } = useSlotContext();
  const editable = props.editable !== false;
  const renderId = useId().replace(/:/g, "");
  const { draft, setDraft, clearDraft } = useLocalDraft(
    sessionId,
    slotId,
    MERMAID_SOURCE_ELEMENT,
    props.source,
  );
  const [renderState, setRenderState] = useState<RenderState>({ status: "rendering" });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cancelledRef = useRef(false);

  const debouncedPost = useDebouncedCallback(async (source: string) => {
    try {
      await postEdit(sessionId, {
        slotId,
        elementId: MERMAID_SOURCE_ELEMENT,
        kind: EditKind.MermaidEdit,
        payload: { source },
      });
      clearDraft();
    } catch (error) {
      console.error("[MermaidEditor] postEdit failed", error);
    }
  });

  useEffect(() => {
    cancelledRef.current = false;
    setRenderState({ status: "rendering" });
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(async () => {
      try {
        const result = await mermaid.render(`mermaid-${renderId}`, draft);
        if (!cancelledRef.current) {
          setRenderState({ status: "ready", svg: result.svg });
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        if (!cancelledRef.current) {
          setRenderState({ status: "error", message });
        }
      } finally {
        timer = null;
      }
    }, 120);
    return () => {
      cancelledRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [draft, renderId]);

  const handleNodeClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const target = event.target as Element | null;
    const node = target?.closest("g.node, g[id^='flowchart-']");
    if (!node) return;
    const nodeId = node.getAttribute("id")?.replace(/^flowchart-/, "").replace(/-\d+$/, "");
    if (!nodeId) return;
    const body = window.prompt(`Comment on node "${nodeId}":`);
    if (!body) return;
    postEdit(sessionId, {
      slotId,
      elementId: `node:${nodeId}`,
      kind: EditKind.MermaidComment,
      payload: { nodeId, body },
    }).catch((error) => {
      console.error("[MermaidEditor] postEdit (comment) failed", error);
    });
  };

  return (
    <div className="bg-card text-card-foreground border rounded-xl shadow-sm overflow-hidden">
      {props.title ? (
        <header className="px-4 py-2 border-b bg-muted">
          <h2 className="text-sm font-medium">{props.title}</h2>
        </header>
      ) : null}
      <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x">
        <section className="p-3">
          {editable ? (
            <textarea
              className="w-full h-[480px] font-mono text-xs border rounded-md p-2 bg-muted focus:outline-none focus:ring-2 focus:ring-ring/40"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                debouncedPost.schedule(event.target.value);
              }}
              spellCheck={false}
            />
          ) : (
            <pre className="font-mono text-xs whitespace-pre-wrap">{draft}</pre>
          )}
        </section>
        <section
          ref={containerRef}
          onClick={editable ? handleNodeClick : undefined}
          className="p-3 overflow-auto h-[480px] flex items-start justify-center"
        >
          {renderState.status === "ready" ? (
            <div
              className="w-full"
              dangerouslySetInnerHTML={{ __html: renderState.svg }}
            />
          ) : null}
          {renderState.status === "rendering" ? (
            <div className="text-muted-foreground text-sm">rendering…</div>
          ) : null}
          {renderState.status === "error" ? (
            <pre className="text-destructive text-xs whitespace-pre-wrap">{renderState.message}</pre>
          ) : null}
        </section>
      </div>
      {editable && props.comments && props.comments.length > 0 ? (
        <footer className="border-t px-4 py-2 text-xs text-muted-foreground">
          <strong>Comments:</strong>
          <ul className="mt-1 space-y-1">
            {props.comments.map((comment, idx) => (
              <li key={`${comment.nodeId}-${idx}`}>
                <code className="font-mono">{comment.nodeId}</code>: {comment.body}
              </li>
            ))}
          </ul>
        </footer>
      ) : null}
    </div>
  );
}
