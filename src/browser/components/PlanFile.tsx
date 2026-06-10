import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import type { z } from "zod/v4";
import { EditKind } from "../../shared/types.ts";
import { PlanFilePropsSchema } from "../../shared/catalog/extensions/PlanFile.ts";
import { useSlotContext } from "../SlotContext.tsx";
import { postEdit } from "../api.ts";
import { useDebouncedCallback } from "../useDebounce.ts";
import { useLocalDraft } from "../useLocalDraft.ts";

type PlanFileProps = z.infer<typeof PlanFilePropsSchema>;
type RenderProps = { props: PlanFileProps };

const PLAN_ELEMENT_ID = "plan";

export function PlanFile({ props }: RenderProps) {
  const { sessionId, slotId } = useSlotContext();
  const editable = props.editable !== false;
  const { draft, setDraft, clearDraft } = useLocalDraft(
    sessionId,
    slotId,
    PLAN_ELEMENT_ID,
    props.markdown,
  );

  const debouncedPost = useDebouncedCallback(async (markdown: string) => {
    try {
      await postEdit(sessionId, {
        slotId,
        elementId: PLAN_ELEMENT_ID,
        kind: EditKind.PlanEdit,
        payload: { markdown },
      });
      clearDraft();
    } catch (error) {
      console.error("[PlanFile] postEdit failed", error);
    }
  });

  const editor = useEditor({
    extensions: [StarterKit, Markdown.configure({ html: false, tightLists: true })],
    content: draft,
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor: instance }) => {
      const storage = instance.storage as unknown as Record<string, { getMarkdown: () => string }>;
      const markdownStore = storage["markdown"];
      if (!markdownStore) return;
      const markdown = markdownStore.getMarkdown();
      setDraft(markdown);
      debouncedPost.schedule(markdown);
    },
  });

  if (!editor) {
    return (
      <div className="bg-card max-w-[860px] mx-auto p-10" style={{ borderRadius: "var(--radius)" }}>
        <div className="text-muted-foreground text-sm">Loading editor…</div>
      </div>
    );
  }

  // Document-card treatment per the plan mockup: centered column, generous
  // padding, file-title chip above the prose.
  return (
    <div
      className="bg-card text-card-foreground overflow-hidden max-w-[860px] mx-auto"
      style={{ borderRadius: "var(--radius)" }}
    >
      <div className="px-10 pt-10 pb-6 sm:px-14 sm:pt-12">
        {props.title ? (
          <span className="inline-flex items-center px-3 py-1.5 mb-7 rounded-full bg-background font-mono text-[11.5px] text-muted-foreground">
            {props.title}
          </span>
        ) : null}
        <EditorContent
          editor={editor}
          className="plan-prose prose prose-sm max-w-none focus:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[120px]"
        />
      </div>
      {editable ? (
        <>
          <hr className="hairline mx-10 sm:mx-14" />
          <footer className="px-10 sm:px-14 py-4 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Edits auto-save and flow to Claude on your next prompt.
            </span>
            <button
              type="button"
              onClick={() => debouncedPost.flush()}
              className="h-8 px-4 rounded-full bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
            >
              Send now
            </button>
          </footer>
        </>
      ) : null}
    </div>
  );
}
