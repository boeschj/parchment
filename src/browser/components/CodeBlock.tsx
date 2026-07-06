import { useEffect, useState } from "react";
import { loader } from "@monaco-editor/react";
import type { z } from "zod/v4";
import { CodeBlockPropsSchema } from "../../shared/catalog/extensions/CodeBlock.ts";
import { Theme, useTheme } from "../theme.ts";

type CodeBlockProps = z.infer<typeof CodeBlockPropsSchema>;
type RenderProps = { props: CodeBlockProps };

const DEFAULT_START_LINE = 1;
const COPIED_FEEDBACK_MS = 1500;
const COLORIZE_TAB_SIZE = 2;
const NON_BREAKING_SPACE = " ";

const LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  kt: "kotlin",
  cs: "csharp",
  "c++": "cpp",
  golang: "go",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  yml: "yaml",
  md: "markdown",
  txt: "plaintext",
};

export function CodeBlock({ props }: RenderProps) {
  const theme = useTheme();

  const languageId = resolveLanguageId(props.language, props.title);
  const rawLines = toDisplayLines(props.code);
  const colorizedLines = useColorizedLines(props.code, languageId, theme);
  const startLine = props.startLine ?? DEFAULT_START_LINE;
  const highlightedLines = new Set(props.highlightLines ?? []);
  const gutterCh = String(startLine + rawLines.length - 1).length;
  const languageLabel = languageId === "plaintext" ? null : languageId;
  const scrollStyle = props.maxHeight ? { maxHeight: props.maxHeight } : undefined;

  return (
    <div className="bg-muted overflow-hidden" style={{ borderRadius: "var(--radius-md)" }}>
      <header
        className="flex items-center gap-3 px-4 py-2"
        style={{ borderBottom: "1px solid var(--hairline)" }}
      >
        {props.title ? (
          <code className="font-mono text-xs text-foreground truncate">{props.title}</code>
        ) : null}
        <span className="flex-1" />
        {languageLabel ? <span className="label shrink-0">{languageLabel}</span> : null}
        <CopyButton code={props.code} />
      </header>
      <div className="overflow-auto py-3" style={scrollStyle}>
        {rawLines.map((line, index) => (
          <CodeLine
            key={index}
            plainText={line}
            colorizedHtml={colorizedLines?.[index] ?? null}
            lineNumber={startLine + index}
            gutterCh={gutterCh}
            isHighlighted={highlightedLines.has(startLine + index)}
          />
        ))}
      </div>
    </div>
  );
}

function CodeLine({
  plainText,
  colorizedHtml,
  lineNumber,
  gutterCh,
  isHighlighted,
}: {
  plainText: string;
  colorizedHtml: string | null;
  lineNumber: number;
  gutterCh: number;
  isHighlighted: boolean;
}) {
  const highlightStyle = isHighlighted
    ? {
        background: "color-mix(in oklab, var(--primary) 8%, transparent)",
        boxShadow: "inset 2px 0 0 var(--primary)",
      }
    : undefined;

  return (
    <div className="flex font-mono text-[13px] leading-[1.6]" style={highlightStyle}>
      <span
        className="shrink-0 select-none text-right text-muted-foreground/60 pl-4 pr-4"
        style={{ minWidth: `calc(${gutterCh}ch + 2rem)` }}
      >
        {lineNumber}
      </span>
      {colorizedHtml !== null ? (
        <span
          className="whitespace-pre pr-4"
          dangerouslySetInnerHTML={{ __html: colorizedHtml || NON_BREAKING_SPACE }}
        />
      ) : (
        <span className="whitespace-pre pr-4">{plainText || NON_BREAKING_SPACE}</span>
      )}
    </div>
  );
}

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopyClick = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch (error) {
      console.error("[CodeBlock] clipboard write failed", error);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopyClick}
      className="shrink-0 h-7 px-3 rounded-full bg-popover font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

// Monaco's colorize API tokenizes on the main thread and reuses the same
// lazily-loaded monaco instance the DiffViewer already pulls in — no extra
// bundle weight. Until it resolves (or if it fails), plain mono text renders
// so the block is never blank.
function useColorizedLines(code: string, languageId: string, theme: Theme): string[] | null {
  const [lines, setLines] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLines(null);
    colorizeToHtmlLines(code, languageId, theme)
      .then((colorized) => {
        if (!cancelled) setLines(colorized);
      })
      .catch((error) => {
        console.error("[CodeBlock] colorize failed, falling back to plain text", error);
      });
    return () => {
      cancelled = true;
    };
  }, [code, languageId, theme]);

  if (lines === null) return null;
  if (lines.length < toDisplayLines(code).length) return null;
  return lines;
}

async function colorizeToHtmlLines(
  code: string,
  languageId: string,
  theme: Theme,
): Promise<string[]> {
  const monaco = await loader.init();
  monaco.editor.setTheme(theme === Theme.Dark ? "vs-dark" : "vs");
  const html = await monaco.editor.colorize(code, languageId, { tabSize: COLORIZE_TAB_SIZE });
  return html.replace(/<br\/?>$/, "").split(/<br\/?>/);
}

function resolveLanguageId(language: string | undefined, title: string | undefined): string {
  if (language) {
    const normalized = language.toLowerCase();
    return LANGUAGE_ALIASES[normalized] ?? normalized;
  }
  const extension = title?.split(".").pop()?.toLowerCase();
  if (!extension || extension === title?.toLowerCase()) return "plaintext";
  return LANGUAGE_ALIASES[extension] ?? extension;
}

function toDisplayLines(code: string): string[] {
  const withoutTrailingNewline = code.endsWith("\n") ? code.slice(0, -1) : code;
  return withoutTrailingNewline.split("\n");
}
