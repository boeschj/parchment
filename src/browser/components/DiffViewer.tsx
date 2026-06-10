import { useCallback, useRef } from "react";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import type { z } from "zod/v4";
import { EditKind } from "../../shared/types.ts";
import {
  DiffEditableSide,
  DiffViewerPropsSchema,
} from "../../shared/catalog/extensions/DiffViewer.ts";
import { useSlotContext } from "../SlotContext.tsx";
import { postEdit } from "../api.ts";
import { useDebouncedCallback } from "../useDebounce.ts";
import { Theme, useTheme } from "../theme.ts";

type DiffViewerProps = z.infer<typeof DiffViewerPropsSchema>;
type RenderProps = { props: DiffViewerProps };

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  cs: "csharp",
  php: "php",
  html: "html",
  css: "css",
  scss: "scss",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  sh: "shell",
  bash: "shell",
  sql: "sql",
  xml: "xml",
};

function detectLanguage(file: string, explicit: string | undefined): string {
  if (explicit) return explicit;
  const ext = file.split(".").pop()?.toLowerCase();
  if (!ext) return "plaintext";
  return EXTENSION_TO_LANGUAGE[ext] ?? "plaintext";
}

const DIFF_AFTER_ELEMENT = "after";
const DIFF_BEFORE_ELEMENT = "before";

export function DiffViewer({ props }: RenderProps) {
  const { sessionId, slotId } = useSlotContext();
  const theme = useTheme();
  const editorRef = useRef<Parameters<DiffOnMount>[0] | null>(null);
  const editableSide = props.editableSide ?? DiffEditableSide.After;
  const language = detectLanguage(props.file, props.language);
  const monacoTheme = theme === Theme.Dark ? "vs-dark" : "vs";

  const debouncedPost = useDebouncedCallback(
    async (side: "before" | "after", content: string) => {
      try {
        await postEdit(sessionId, {
          slotId,
          elementId: side === "after" ? DIFF_AFTER_ELEMENT : DIFF_BEFORE_ELEMENT,
          kind: EditKind.DiffEdit,
          payload: { file: props.file, side, content },
        });
      } catch (error) {
        console.error("[DiffViewer] postEdit failed", error);
      }
    },
  );

  const handleMount: DiffOnMount = useCallback(
    (editor) => {
      editorRef.current = editor;
      const original = editor.getOriginalEditor();
      const modified = editor.getModifiedEditor();
      if (editableSide === DiffEditableSide.After || editableSide === DiffEditableSide.Both) {
        modified.onDidChangeModelContent(() => {
          debouncedPost.schedule("after", modified.getValue());
        });
      }
      if (editableSide === DiffEditableSide.Both) {
        original.onDidChangeModelContent(() => {
          debouncedPost.schedule("before", original.getValue());
        });
      }
    },
    [debouncedPost, editableSide],
  );

  const renderSideBySide = true;
  const readOnly = editableSide === DiffEditableSide.None;
  const originalEditable = editableSide === DiffEditableSide.Both;

  return (
    <div
      className="bg-card text-card-foreground overflow-hidden"
      style={{ borderRadius: "var(--radius)" }}
    >
      <header className="px-6 py-3 flex items-center justify-between">
        <code className="text-xs font-mono">{props.file}</code>
        <span className="label">
          {language} · {editableSide === DiffEditableSide.None ? "read-only" : `${editableSide} editable`}
        </span>
      </header>
      <hr className="hairline mx-6" />
      <DiffEditor
        height="480px"
        original={props.before}
        modified={props.after}
        language={language}
        theme={monacoTheme}
        options={{
          readOnly,
          originalEditable,
          renderSideBySide,
          minimap: { enabled: false },
          fontSize: 13,
          scrollBeyondLastLine: false,
          automaticLayout: true,
        }}
        onMount={handleMount}
        loading={<div className="p-4 text-muted-foreground text-sm">Loading diff editor…</div>}
      />
    </div>
  );
}
