import { useState } from "react";
import { Streamdown } from "streamdown";
import type { TranscriptItem } from "../transcript/parse.ts";
import { ImageAttachments } from "./ImageAttachments.tsx";

type ToolItem = Extract<TranscriptItem, { kind: "tool" }>;

const TOOL_OUTPUT_DISPLAY_LIMIT = 4000;

const ToolName = {
  Bash: "Bash",
  Read: "Read",
  Edit: "Edit",
  MultiEdit: "MultiEdit",
  Write: "Write",
  Grep: "Grep",
  Glob: "Glob",
  Agent: "Agent",
  Task: "Task",
  Skill: "Skill",
  WebFetch: "WebFetch",
  WebSearch: "WebSearch",
} as const;

const TITLE_PROP: Record<string, string> = {
  [ToolName.Bash]: "command",
  [ToolName.Read]: "file_path",
  [ToolName.Edit]: "file_path",
  [ToolName.Write]: "file_path",
  [ToolName.MultiEdit]: "file_path",
  [ToolName.Glob]: "pattern",
  [ToolName.Grep]: "pattern",
  [ToolName.Agent]: "description",
  [ToolName.Task]: "description",
  [ToolName.Skill]: "skill",
  [ToolName.WebFetch]: "url",
  [ToolName.WebSearch]: "query",
};

const OutputTab = {
  Formatted: "formatted",
  Raw: "raw",
} as const;

type OutputTab = (typeof OutputTab)[keyof typeof OutputTab];

export function ToolCall({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const status = toolStatus(item);
  const title = toolTitle(item);
  const isDenied = item.denialKind !== null;
  const denialLabel = isDenied ? `denied · ${item.denialKind}` : null;
  const durationLabel = isDenied ? null : toolDurationLabel(item);

  return (
    <details className="group mr-12" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="inline-flex items-center gap-2.5 w-fit max-w-full cursor-pointer list-none px-3.5 py-2 rounded-full bg-card select-none">
        <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${status.dotClass}`} />
        <span className="font-mono text-[12px] font-medium shrink-0">{item.name}</span>
        {title ? (
          <span className="font-mono text-[11.5px] text-muted-foreground truncate">{title}</span>
        ) : null}
        {denialLabel ? (
          <span className="font-mono text-[11px] text-amber-600 dark:text-amber-500 shrink-0">{denialLabel}</span>
        ) : null}
        {durationLabel ? (
          <span className="font-mono text-[11px] text-muted-foreground shrink-0">{durationLabel}</span>
        ) : null}
      </summary>

      {open ? <ExpandedPanel item={item} /> : null}
    </details>
  );
}

function ExpandedPanel({ item }: { item: ToolItem }) {
  return (
    <div className="mt-2 max-w-2xl bg-card overflow-hidden" style={{ borderRadius: "var(--radius-lg)" }}>
      <div className="p-3">
        <CallPreview item={item} />
      </div>
      <hr className="hairline" />
      <OutputTabs item={item} />
    </div>
  );
}

function CallPreview({ item }: { item: ToolItem }) {
  const input = item.input;

  if (item.name === ToolName.Bash) return <CodeBlock text={str(input, "command")} />;
  if (item.name === ToolName.Read) return <FileRef path={str(input, "file_path")} />;
  if (item.name === ToolName.WebFetch) return <FileRef path={str(input, "url")} />;
  if (item.name === ToolName.Grep || item.name === ToolName.Glob) {
    return <CodeBlock text={str(input, "pattern")} />;
  }
  if (item.name === ToolName.Agent || item.name === ToolName.Task) {
    return <Prose markdown={str(input, "prompt")} />;
  }
  if (item.name === ToolName.Write) {
    return (
      <div className="flex flex-col gap-2">
        <FileRef path={str(input, "file_path")} />
        <CodeBlock text={str(input, "content")} />
      </div>
    );
  }
  if (item.name === ToolName.Edit) {
    return (
      <div className="flex flex-col gap-2">
        <FileRef path={str(input, "file_path")} />
        <DiffPreview before={str(input, "old_string")} after={str(input, "new_string")} />
      </div>
    );
  }
  if (item.name === ToolName.MultiEdit) {
    const edits = Array.isArray(input["edits"]) ? input["edits"] : [];
    return (
      <div className="flex flex-col gap-2">
        <FileRef path={str(input, "file_path")} />
        {edits.map((edit, index) =>
          isRecord(edit) ? (
            <DiffPreview key={index} before={str(edit, "old_string")} after={str(edit, "new_string")} />
          ) : null,
        )}
      </div>
    );
  }

  return <CodeBlock text={JSON.stringify(input, null, 2)} />;
}

function OutputTabs({ item }: { item: ToolItem }) {
  const [tab, setTab] = useState<OutputTab>(OutputTab.Formatted);
  const rawText = JSON.stringify({ tool: item.name, input: item.input, output: item.output }, null, 2);

  return (
    <div>
      <div className="flex items-center gap-1 px-3 pt-3">
        <TabButton active={tab === OutputTab.Formatted} onClick={() => setTab(OutputTab.Formatted)}>
          Tool output
        </TabButton>
        <TabButton active={tab === OutputTab.Raw} onClick={() => setTab(OutputTab.Raw)}>
          View raw output
        </TabButton>
      </div>
      <div className="p-3">
        {tab === OutputTab.Formatted ? <FormattedOutput item={item} /> : <CodeBlock text={rawText} />}
      </div>
    </div>
  );
}

function FormattedOutput({ item }: { item: ToolItem }) {
  const hasImages = item.images.length > 0;
  const text = item.output ?? "";
  const hasText = text.length > 0;

  if (item.output === null && !hasImages) {
    return <div className="text-muted-foreground text-[12.5px] font-mono">running…</div>;
  }

  const downloadBaseName = outputDownloadBase(item);
  const downloadProps = downloadBaseName ? { downloadBaseName } : {};

  return (
    <div className="flex flex-col gap-3">
      {hasImages ? <ImageAttachments images={item.images} {...downloadProps} /> : null}
      {hasText ? <OutputBody item={item} text={text} /> : null}
    </div>
  );
}

function OutputBody({ item, text }: { item: ToolItem; text: string }) {
  if (isProseTool(item.name)) return <Prose markdown={text} />;
  const colorClass = outputColorClass(item);
  return (
    <ScrollCode copyText={text}>
      <pre className={`font-mono text-[12px] leading-relaxed whitespace-pre-wrap m-0 ${colorClass}`}>
        {truncateOutput(text)}
      </pre>
    </ScrollCode>
  );
}

function Prose({ markdown }: { markdown: string }) {
  return (
    <ScrollCode copyText={markdown}>
      <Streamdown className="transcript-prose">{markdown}</Streamdown>
    </ScrollCode>
  );
}

function CodeBlock({ text }: { text: string }) {
  return (
    <ScrollCode copyText={text}>
      <pre className="font-mono text-[12.5px] leading-relaxed whitespace-pre m-0 text-foreground">
        {text}
      </pre>
    </ScrollCode>
  );
}

function ScrollCode({ copyText, children }: { copyText: string; children: React.ReactNode }) {
  return (
    <div className="relative bg-background overflow-hidden" style={{ borderRadius: "var(--radius-md)" }}>
      <div className="max-h-96 overflow-auto p-3">{children}</div>
      <div className="absolute top-2 right-2 rounded-md bg-background/70 backdrop-blur-sm">
        <CopyButton text={copyText} />
      </div>
    </div>
  );
}

function DiffPreview({ before, after }: { before: string; after: string }) {
  const removed = before.length > 0 ? before.split("\n") : [];
  const added = after.length > 0 ? after.split("\n") : [];
  return (
    <div
      className="bg-background p-3 max-h-96 overflow-auto font-mono text-[12px] leading-relaxed"
      style={{ borderRadius: "var(--radius-md)" }}
    >
      {removed.map((line, index) => (
        <div key={`removed-${index}`} className="text-destructive whitespace-pre">
          {`- ${line}`}
        </div>
      ))}
      {added.map((line, index) => (
        <div key={`added-${index}`} className="text-success whitespace-pre">
          {`+ ${line}`}
        </div>
      ))}
    </div>
  );
}

function FileRef({ path }: { path: string }) {
  if (!path) return null;
  const href = path.startsWith("http") ? path : `vscode://file/${path}`;
  return (
    <div
      className="inline-flex items-center gap-2 bg-background px-2.5 py-1.5 max-w-full"
      style={{ borderRadius: "var(--radius-md)" }}
    >
      <a
        href={href}
        className="font-mono text-[12.5px] truncate hover:text-primary transition-colors"
        title={path}
      >
        {path}
      </a>
      <CopyButton text={path} />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const activeClass = active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-mono text-[11px] px-2.5 py-1 rounded-full transition-colors ${activeClass}`}
    >
      {children}
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => setCopied(false));
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy"
      className="w-6 h-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function toolStatus(item: ToolItem): { dotClass: string } {
  if (item.denialKind !== null) return { dotClass: "bg-amber-500" };
  if (item.isError) return { dotClass: "bg-destructive" };
  if (item.output === null) return { dotClass: "bg-amber-500" };
  return { dotClass: "bg-success" };
}

function outputColorClass(item: ToolItem): string {
  if (item.denialKind !== null) return "text-amber-600 dark:text-amber-500";
  if (item.isError) return "text-destructive";
  return "text-foreground";
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

function toolDurationLabel(item: ToolItem): string | null {
  if (item.timestampMs === null || item.endedAtMs === null) return null;

  const elapsedMs = item.endedAtMs - item.timestampMs;
  if (elapsedMs < 0) return null;

  const elapsedSeconds = elapsedMs / MS_PER_SECOND;
  if (elapsedSeconds < SECONDS_PER_MINUTE) return `${elapsedSeconds.toFixed(1)}s`;

  const minutes = Math.floor(elapsedSeconds / SECONDS_PER_MINUTE);
  const seconds = Math.round(elapsedSeconds % SECONDS_PER_MINUTE);
  return `${minutes}m ${seconds}s`;
}

function toolTitle(item: ToolItem): string {
  const description = item.input["description"];
  if (typeof description === "string" && description.trim().length > 0) return description;

  const prop = TITLE_PROP[item.name];
  const preferred = prop ? item.input[prop] : undefined;
  if (typeof preferred === "string") return prop === "file_path" ? baseName(preferred) : preferred;

  const firstString = Object.values(item.input).find((value) => typeof value === "string");
  return typeof firstString === "string" ? firstString : "";
}

function truncateOutput(output: string): string {
  if (output.length <= TOOL_OUTPUT_DISPLAY_LIMIT) return output;
  return `${output.slice(0, TOOL_OUTPUT_DISPLAY_LIMIT)}\n… (${output.length - TOOL_OUTPUT_DISPLAY_LIMIT} more characters)`;
}

function str(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProseTool(name: string): boolean {
  return name === ToolName.Agent || name === ToolName.Task;
}

function baseName(path: string): string {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const last = segments[segments.length - 1];
  return last ?? path;
}

function outputDownloadBase(item: ToolItem): string | undefined {
  const filePath = item.input["file_path"];
  if (typeof filePath !== "string") return undefined;
  return baseName(filePath);
}
