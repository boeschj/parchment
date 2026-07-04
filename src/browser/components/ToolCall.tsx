import { useState } from "react";
import { Streamdown } from "streamdown";
import type { TranscriptItem } from "../transcript/parse.ts";
import { ImageAttachments } from "./ImageAttachments.tsx";

type ToolItem = Extract<TranscriptItem, { kind: "tool" }>;

const TOOL_OUTPUT_DISPLAY_LIMIT = 4000;
const RAW_JSON_DISPLAY_LIMIT = 20000;

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
  const rawPayload = { call: item.raw, result: item.resultRaw };

  return (
    <InspectableRow payload={rawPayload}>
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
    </InspectableRow>
  );
}

// Hover-revealed "{ }" toggle exposing the raw JSONL entry behind any
// transcript item. Shared by every item renderer so fidelity is uniform.
export function InspectableRow({
  payload,
  children,
}: {
  payload: unknown;
  children: React.ReactNode;
}) {
  const [rawVisible, setRawVisible] = useState(false);

  const handleToggleRaw = () => setRawVisible((visible) => !visible);
  const visibilityClass = rawVisible
    ? "opacity-100"
    : "opacity-0 group-hover/raw:opacity-100 focus-visible:opacity-100";

  return (
    <div className="group/raw relative">
      {children}
      <button
        type="button"
        onClick={handleToggleRaw}
        aria-label="Toggle raw entry JSON"
        title="Raw entry JSON"
        className={`absolute top-1 right-1 w-6 h-6 inline-flex items-center justify-center rounded-md font-mono text-[10px] text-muted-foreground bg-background/70 backdrop-blur-sm hover:text-foreground hover:bg-secondary transition-opacity ${visibilityClass}`}
      >
        {"{ }"}
      </button>
      {rawVisible ? (
        <div className="mt-1.5">
          <JsonPanel text={prettyJson(payload)} />
        </div>
      ) : null}
    </div>
  );
}

// Compact scrollable code panel for raw/detail payloads (pretty JSON or
// prose), with copy. Shared with TranscriptView's meta rows.
export function JsonPanel({ text }: { text: string }) {
  return (
    <div className="relative bg-background overflow-hidden" style={{ borderRadius: "var(--radius-md)" }}>
      <div className="max-h-64 overflow-auto p-3">
        <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap m-0 text-muted-foreground">
          {truncateForDisplay(text, RAW_JSON_DISPLAY_LIMIT)}
        </pre>
      </div>
      <div className="absolute top-2 right-2 rounded-md bg-background/70 backdrop-blur-sm">
        <CopyButton text={text} />
      </div>
    </div>
  );
}

function ExpandedPanel({ item }: { item: ToolItem }) {
  const stats = taskStatsOf(item.toolUseResult);

  return (
    <div className="mt-2 max-w-2xl bg-card overflow-hidden" style={{ borderRadius: "var(--radius-lg)" }}>
      <div className="p-3">
        <CallPreview item={item} />
      </div>
      {stats !== null ? <TaskStatsRow stats={stats} /> : null}
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
        <WritePreview item={item} />
      </div>
    );
  }
  if (item.name === ToolName.Edit) {
    return (
      <div className="flex flex-col gap-2">
        <FileRef path={str(input, "file_path")} />
        <EditPreview item={item} />
      </div>
    );
  }
  if (item.name === ToolName.MultiEdit) {
    return (
      <div className="flex flex-col gap-2">
        <FileRef path={str(input, "file_path")} />
        <MultiEditPreview item={item} />
      </div>
    );
  }

  return <CodeBlock text={JSON.stringify(input, null, 2)} />;
}

// The applied patch from toolUseResult is the ground truth (it reflects what
// actually landed on disk), so it wins over the proposed input strings.
function EditPreview({ item }: { item: ToolItem }) {
  const appliedHunks = structuredPatchOf(item.toolUseResult);
  if (appliedHunks !== null) return <StructuredPatchDiff hunks={appliedHunks} />;
  return <DiffPreview before={str(item.input, "old_string")} after={str(item.input, "new_string")} />;
}

function WritePreview({ item }: { item: ToolItem }) {
  const appliedHunks = structuredPatchOf(item.toolUseResult);
  if (appliedHunks !== null) return <StructuredPatchDiff hunks={appliedHunks} />;
  return <CodeBlock text={str(item.input, "content")} />;
}

function MultiEditPreview({ item }: { item: ToolItem }) {
  const appliedHunks = structuredPatchOf(item.toolUseResult);
  if (appliedHunks !== null) return <StructuredPatchDiff hunks={appliedHunks} />;

  const edits = Array.isArray(item.input["edits"]) ? item.input["edits"] : [];
  return (
    <div className="flex flex-col gap-2">
      {edits.map((edit, index) =>
        isRecord(edit) ? (
          <DiffPreview key={index} before={str(edit, "old_string")} after={str(edit, "new_string")} />
        ) : null,
      )}
    </div>
  );
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

  const bashStreams = bashStreamsOf(item);
  if (bashStreams !== null) return <BashStreams streams={bashStreams} />;

  const colorClass = outputColorClass(item);
  return (
    <ScrollCode copyText={text}>
      <pre className={`font-mono text-[12px] leading-relaxed whitespace-pre-wrap m-0 ${colorClass}`}>
        {truncateForDisplay(text, TOOL_OUTPUT_DISPLAY_LIMIT)}
      </pre>
    </ScrollCode>
  );
}

type BashStreamPair = { stdout: string; stderr: string };

function bashStreamsOf(item: ToolItem): BashStreamPair | null {
  if (item.name !== ToolName.Bash) return null;
  if (item.toolUseResult === null) return null;

  const stdout = str(item.toolUseResult, "stdout");
  const stderr = str(item.toolUseResult, "stderr");
  if (stderr.trim().length === 0) return null;
  return { stdout, stderr };
}

const STDERR_BACKGROUND = "color-mix(in srgb, var(--destructive) 8%, transparent)";

function BashStreams({ streams }: { streams: BashStreamPair }) {
  const hasStdout = streams.stdout.trim().length > 0;

  return (
    <div className="flex flex-col gap-2">
      {hasStdout ? (
        <ScrollCode copyText={streams.stdout}>
          <pre className="font-mono text-[12px] leading-relaxed whitespace-pre-wrap m-0 text-foreground">
            {truncateForDisplay(streams.stdout, TOOL_OUTPUT_DISPLAY_LIMIT)}
          </pre>
        </ScrollCode>
      ) : null}
      <div className="overflow-hidden" style={{ borderRadius: "var(--radius-md)", background: STDERR_BACKGROUND }}>
        <div className="px-3 pt-2">
          <span className="font-mono text-[10px] font-medium uppercase tracking-widest text-destructive/80">stderr</span>
        </div>
        <div className="relative">
          <div className="max-h-96 overflow-auto p-3 pt-1.5">
            <pre className="font-mono text-[12px] leading-relaxed whitespace-pre-wrap m-0 text-destructive">
              {truncateForDisplay(streams.stderr, TOOL_OUTPUT_DISPLAY_LIMIT)}
            </pre>
          </div>
          <div className="absolute top-1 right-2 rounded-md bg-background/70 backdrop-blur-sm">
            <CopyButton text={streams.stderr} />
          </div>
        </div>
      </div>
    </div>
  );
}

type TaskStats = {
  totalTokens: number | null;
  totalDurationMs: number | null;
  totalToolUseCount: number | null;
};

function taskStatsOf(result: Record<string, unknown> | null): TaskStats | null {
  if (result === null) return null;

  const stats: TaskStats = {
    totalTokens: num(result, "totalTokens"),
    totalDurationMs: num(result, "totalDurationMs"),
    totalToolUseCount: num(result, "totalToolUseCount"),
  };
  const hasAnyStat =
    stats.totalTokens !== null || stats.totalDurationMs !== null || stats.totalToolUseCount !== null;
  if (!hasAnyStat) return null;
  return stats;
}

function TaskStatsRow({ stats }: { stats: TaskStats }) {
  const chips: string[] = [];
  if (stats.totalTokens !== null) chips.push(`${formatTokenCount(stats.totalTokens)} tokens`);
  if (stats.totalDurationMs !== null) chips.push(formatDurationMs(stats.totalDurationMs));
  if (stats.totalToolUseCount !== null) chips.push(`${stats.totalToolUseCount} tool calls`);

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3">
      {chips.map((chip) => (
        <span
          key={chip}
          className="font-mono text-[11px] text-muted-foreground bg-background px-2 py-0.5 rounded-full"
        >
          {chip}
        </span>
      ))}
    </div>
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

type PatchHunk = { header: string; lines: string[] };

function structuredPatchOf(result: Record<string, unknown> | null): PatchHunk[] | null {
  if (result === null) return null;
  const rawHunks = result["structuredPatch"];
  if (!Array.isArray(rawHunks) || rawHunks.length === 0) return null;

  const hunks: PatchHunk[] = [];
  for (const rawHunk of rawHunks) {
    if (!isRecord(rawHunk)) continue;
    hunks.push({ header: hunkHeader(rawHunk), lines: stringLines(rawHunk["lines"]) });
  }
  if (hunks.length === 0) return null;
  return hunks;
}

function hunkHeader(hunk: Record<string, unknown>): string {
  const oldStart = num(hunk, "oldStart") ?? 0;
  const oldLines = num(hunk, "oldLines") ?? 0;
  const newStart = num(hunk, "newStart") ?? 0;
  const newLines = num(hunk, "newLines") ?? 0;
  return `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`;
}

function stringLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((line): line is string => typeof line === "string");
}

function StructuredPatchDiff({ hunks }: { hunks: PatchHunk[] }) {
  return (
    <div
      className="bg-background p-3 max-h-96 overflow-auto font-mono text-[12px] leading-relaxed"
      style={{ borderRadius: "var(--radius-md)" }}
    >
      {hunks.map((hunk) => (
        <div key={hunk.header}>
          <div className="text-muted-foreground/70 select-none whitespace-pre">{hunk.header}</div>
          {hunk.lines.map((line, index) => (
            <PatchLine key={index} line={line} />
          ))}
        </div>
      ))}
    </div>
  );
}

const PATCH_ADDED_PREFIX = "+";
const PATCH_REMOVED_PREFIX = "-";
const ADDED_LINE_BACKGROUND = "color-mix(in srgb, var(--success) 12%, transparent)";
const REMOVED_LINE_BACKGROUND = "color-mix(in srgb, var(--destructive) 10%, transparent)";

function PatchLine({ line }: { line: string }) {
  if (line.startsWith(PATCH_ADDED_PREFIX)) {
    return (
      <div className="whitespace-pre text-success" style={{ background: ADDED_LINE_BACKGROUND }}>
        {line}
      </div>
    );
  }
  if (line.startsWith(PATCH_REMOVED_PREFIX)) {
    return (
      <div className="whitespace-pre text-destructive" style={{ background: REMOVED_LINE_BACKGROUND }}>
        {line}
      </div>
    );
  }
  return <div className="whitespace-pre text-muted-foreground">{line}</div>;
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
  return formatDurationMs(elapsedMs);
}

function formatDurationMs(durationMs: number): string {
  const elapsedSeconds = durationMs / MS_PER_SECOND;
  if (elapsedSeconds < SECONDS_PER_MINUTE) return `${elapsedSeconds.toFixed(1)}s`;

  const minutes = Math.floor(elapsedSeconds / SECONDS_PER_MINUTE);
  const seconds = Math.round(elapsedSeconds % SECONDS_PER_MINUTE);
  return `${minutes}m ${seconds}s`;
}

const TOKENS_PER_THOUSAND = 1000;
const TOKENS_PER_MILLION = 1_000_000;

function formatTokenCount(tokens: number): string {
  if (tokens >= TOKENS_PER_MILLION) return `${(tokens / TOKENS_PER_MILLION).toFixed(1)}M`;
  if (tokens >= TOKENS_PER_THOUSAND) return `${Math.round(tokens / TOKENS_PER_THOUSAND)}k`;
  return `${tokens}`;
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

function truncateForDisplay(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… (${text.length - limit} more characters)`;
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "null";
}

function str(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function num(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" ? value : null;
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
