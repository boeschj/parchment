import { useEffect, useId, useRef, useState } from "react";
import mermaid from "mermaid";
import { Download, ExternalLink } from "lucide-react";
import type { z } from "zod/v4";
import { EditKind } from "../../shared/types.ts";
import { MermaidEditorPropsSchema, MermaidTheme } from "../../shared/catalog/extensions/MermaidEditor.ts";
import { useSlotContext } from "../SlotContext.tsx";
import { postEdit } from "../api.ts";
import { useDebouncedCallback } from "../useDebounce.ts";
import { useLocalDraft } from "../useLocalDraft.ts";
import { buildMermaidLiveUrl } from "../export/mermaid-live.ts";
import { downloadSvgAsPng } from "../export/svg-png.ts";
import { exportFilenameStem } from "../export/standalone-html.ts";

const DEFAULT_MERMAID_THEME = MermaidTheme.Base;
const PNG_BACKGROUND: Record<string, string> = {
  [MermaidTheme.Dark]: "#0B0A08",
};
const DEFAULT_PNG_BACKGROUND = "#FFFFFF";

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
  const editable = props.editable === true;
  const showSource = props.showSource ?? editable;
  const theme = props.theme ?? DEFAULT_MERMAID_THEME;
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
        mermaid.initialize({ startOnLoad: false, theme });
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
  }, [draft, renderId, theme]);

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

  const handleExportPng = async (): Promise<void> => {
    const svg = containerRef.current?.querySelector("svg");
    if (!svg) return;
    const background = PNG_BACKGROUND[theme] ?? DEFAULT_PNG_BACKGROUND;
    const filename = `${exportFilenameStem(props.title ?? "diagram")}.png`;
    try {
      await downloadSvgAsPng(svg, filename, background);
    } catch (error) {
      console.error("[MermaidEditor] PNG export failed", error);
    }
  };

  const handleOpenInMermaidLive = (): void => {
    window.open(buildMermaidLiveUrl(draft, theme), "_blank", "noopener");
  };

  const containerLayoutClass = showSource ? "grid md:grid-cols-2" : "block";
  const diagramSizeClass = showSource ? "h-[504px]" : "min-h-[320px] max-h-[80vh]";
  const diagramReady = renderState.status === "ready";

  return (
    <div
      className="bg-card text-card-foreground overflow-hidden"
      style={{ borderRadius: "var(--radius)" }}
    >
      {props.title ? (
        <>
          <header className="px-6 py-4">
            <h2 className="text-base font-semibold tracking-tight">{props.title}</h2>
          </header>
          <hr className="hairline mx-6" />
        </>
      ) : null}
      <div className={containerLayoutClass}>
        {showSource ? (
          <section className="p-4">
            <div className="label mb-3">Source</div>
            {editable ? (
              <textarea
                className="w-full h-[456px] font-mono text-xs p-3 bg-muted focus:outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[3px]"
                style={{ borderRadius: "var(--radius-md)" }}
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
        ) : null}
        <div className="relative">
          {diagramReady ? (
            <div
              data-parchment-export-hide
              className="absolute top-3 right-3 z-10 flex gap-1.5"
              onClick={(event) => event.stopPropagation()}
            >
              <MermaidToolbarButton label="PNG" onClick={() => void handleExportPng()}>
                <Download width={12} height={12} />
                PNG
              </MermaidToolbarButton>
              <MermaidToolbarButton label="Open in Mermaid Live" onClick={handleOpenInMermaidLive}>
                <ExternalLink width={12} height={12} />
                Mermaid Live
              </MermaidToolbarButton>
            </div>
          ) : null}
          <section
            ref={containerRef}
            onClick={editable ? handleNodeClick : undefined}
            className={`p-4 overflow-auto ${diagramSizeClass} flex items-start justify-center`}
            style={{
              background:
                "radial-gradient(circle at center, var(--dot) 1px, transparent 1px) 0 0 / 22px 22px",
            }}
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
      </div>
      {editable && props.comments && props.comments.length > 0 ? (
        <footer className="px-4 py-2 text-xs text-muted-foreground" style={{ borderTop: "1px solid var(--hairline)" }}>
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

function MermaidToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="h-7 px-2.5 rounded-full bg-popover font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5 shadow-sm"
    >
      {children}
    </button>
  );
}
