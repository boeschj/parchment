import { Fragment } from "react";
import { StickToBottom } from "use-stick-to-bottom";
import { Streamdown } from "streamdown";
import type { TranscriptCoverage, TranscriptItem, TranscriptModel } from "../transcript/parse.ts";
import { TranscriptItemKind } from "../transcript/parse.ts";
import { SystemSubtype } from "@boeschj/claude-jsonl";
import { InspectableRow, JsonPanel, ToolCall } from "./ToolCall.tsx";
import { ImageAttachments } from "./ImageAttachments.tsx";
import { Terminal } from "./Terminal.tsx";
import "./transcript.css";

const RowKind = {
  Item: "item",
  Cluster: "cluster",
} as const;

type TranscriptRow =
  | {
      rowKind: typeof RowKind.Item;
      item: TranscriptItem;
      timeLabel: string | null;
      dayLabel: string | null;
    }
  | {
      rowKind: typeof RowKind.Cluster;
      items: TranscriptItem[];
      dayLabel: string | null;
    };

export function TranscriptView({
  transcript,
  isWorking,
}: {
  transcript: TranscriptModel;
  isWorking: boolean;
}) {
  const rows = buildTranscriptRows(transcript.items);

  return (
    <StickToBottom className="transcript-reader flex-1 min-h-0 overflow-y-auto overflow-x-hidden scroll-fade-top" resize="smooth" initial="instant">
      <StickToBottom.Content className="max-w-[720px] mx-auto px-7 pb-10 flex flex-col gap-5">
        <CoverageHeader coverage={transcript.coverage} />
        {rows.map((row) => (
          <Fragment key={rowKeyOf(row)}>
            {row.dayLabel ? <DayDivider label={row.dayLabel} /> : null}
            <TranscriptRowView row={row} />
          </Fragment>
        ))}
        {isWorking ? <WorkingIndicator /> : null}
      </StickToBottom.Content>
    </StickToBottom>
  );
}

function CoverageHeader({ coverage }: { coverage: TranscriptCoverage }) {
  if (coverage.totalEntries === 0) return null;

  const summary = `${coverage.totalEntries} events · ${coverage.renderedEntries} rendered · ${coverage.droppedEntries} hidden`;
  return (
    <div className="flex justify-center pt-4">
      <span className="label tabular-nums">{summary}</span>
    </div>
  );
}

function TranscriptRowView({ row }: { row: TranscriptRow }) {
  if (row.rowKind === RowKind.Cluster) {
    return <MetaClusterRow items={row.items} />;
  }
  return <InspectableItem item={row.item} timeLabel={row.timeLabel} />;
}

// Tool calls own their inspector (they pair call + result raw entries);
// everything else gets wrapped here with the entry's raw line.
function InspectableItem({ item, timeLabel }: { item: TranscriptItem; timeLabel: string | null }) {
  if (item.kind === TranscriptItemKind.Tool) return <ToolCall item={item} />;

  return (
    <InspectableRow payload={item.raw}>
      <TranscriptItemView item={item} timeLabel={timeLabel} />
    </InspectableRow>
  );
}

function TranscriptItemView({ item, timeLabel }: { item: TranscriptItem; timeLabel: string | null }) {
  switch (item.kind) {
    case TranscriptItemKind.User:
      return <UserMessage text={item.text} images={item.images} timeLabel={timeLabel} />;
    case TranscriptItemKind.Assistant:
      return (
        <AssistantMessage
          markdown={item.markdown}
          model={item.model}
          contextTokens={item.contextTokens}
          timeLabel={timeLabel}
        />
      );
    case TranscriptItemKind.Thinking:
      return <ThinkingBlock text={item.text} />;
    case TranscriptItemKind.Bash:
      return <BashCommandBlock command={item.command} output={item.output} timeLabel={timeLabel} />;
    case TranscriptItemKind.Tool:
      return <ToolCall item={item} />;
    case TranscriptItemKind.Compaction:
      return <CompactionDivider trigger={item.trigger} preTokens={item.preTokens} postTokens={item.postTokens} />;
    case TranscriptItemKind.CompactSummary:
      return <ContinuationSummary text={item.text} />;
    case TranscriptItemKind.SlashCommand:
      return <SlashCommandChip command={item.command} args={item.args} timeLabel={timeLabel} />;
    case TranscriptItemKind.ApiError:
      return <ApiErrorLine message={item.message} retryAttempt={item.retryAttempt} maxRetries={item.maxRetries} />;
    case TranscriptItemKind.ModelFallback:
      return <ModelFallbackLine fromModel={item.fromModel} toModel={item.toModel} />;
    case TranscriptItemKind.SystemEvent: {
      if (item.subtype === SystemSubtype.AwaySummary) return <AwaySummaryCard text={item.summary} />;
      return <MetaRow item={item} />;
    }
    case TranscriptItemKind.Attachment:
    case TranscriptItemKind.QueueOp:
    case TranscriptItemKind.SessionMeta:
    case TranscriptItemKind.FileSnapshot:
    case TranscriptItemKind.Unknown:
      return <MetaRow item={item} />;
  }
}

function UserMessage({
  text,
  images,
  timeLabel,
}: {
  text: string;
  images: string[];
  timeLabel: string | null;
}) {
  return (
    <div className="user-message ml-12 text-foreground px-6 py-4">
      <div className="flex items-center justify-between gap-3">
        <RoleHeader name="You" dotClass="bg-muted-foreground" />
        {timeLabel ? <span className="label tabular-nums">{timeLabel}</span> : null}
      </div>
      <p className="text-[15px] leading-[1.7] tracking-[-0.011em] whitespace-pre-wrap m-0 mt-2">{text}</p>
      <ImageAttachments images={images} />
    </div>
  );
}

function AssistantMessage({
  markdown,
  model,
  contextTokens,
  timeLabel,
}: {
  markdown: string;
  model: string | null;
  contextTokens: number | null;
  timeLabel: string | null;
}) {
  const metaParts: string[] = [];
  if (model !== null) metaParts.push(shortModelName(model));
  if (contextTokens !== null) metaParts.push(`${formatTokenCount(contextTokens)} ctx`);
  const metaLabel = metaParts.join(" · ");

  return (
    <div className="group mr-12 bg-card text-card-foreground px-6 py-5" style={{ borderRadius: "var(--radius-lg)" }}>
      <div className="flex items-center justify-between gap-3">
        <RoleHeader name="Claude" dotClass="bg-primary" />
        <span className="flex items-center gap-2.5 min-w-0">
          {metaLabel ? (
            <span className="label tabular-nums truncate opacity-0 group-hover:opacity-100 transition-opacity">{metaLabel}</span>
          ) : null}
          {timeLabel ? <span className="label tabular-nums shrink-0">{timeLabel}</span> : null}
        </span>
      </div>
      <Streamdown className="transcript-prose mt-3">{markdown}</Streamdown>
    </div>
  );
}

function ThinkingBlock({ text }: { text: string }) {
  const sizeLabel = approximateTokenLabel(text);

  return (
    <details className="group mr-12">
      <summary className="inline-flex items-center gap-2 cursor-pointer list-none px-3 py-1.5 rounded-full bg-card font-mono text-[11px] text-muted-foreground select-none">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
        thinking · {sizeLabel}
      </summary>
      <div className="mt-2 px-5 py-4 bg-card text-muted-foreground text-[13px] leading-relaxed italic whitespace-pre-wrap" style={{ borderRadius: "var(--radius-lg)" }}>
        {text}
      </div>
    </details>
  );
}

// Inline `!command` bash. The Terminal component caps its own output height
// and scrolls internally, so long install/build logs never blow out the
// timeline the way a raw text bubble did.
function BashCommandBlock({
  command,
  output,
  timeLabel,
}: {
  command: string;
  output: string;
  timeLabel: string | null;
}) {
  return (
    <div className="ml-12">
      <div className="flex items-center justify-end gap-3 mb-1.5">
        <span className="label">bash</span>
        {timeLabel ? <span className="label tabular-nums">{timeLabel}</span> : null}
      </div>
      <Terminal props={{ command, output }} />
    </div>
  );
}

function CompactionDivider({
  trigger,
  preTokens,
  postTokens,
}: {
  trigger: string | null;
  preTokens: number | null;
  postTokens: number | null;
}) {
  const hasTokenCounts = preTokens !== null && postTokens !== null;
  const tokensSuffix = hasTokenCounts
    ? ` — ${formatTokenCount(preTokens)} → ${formatTokenCount(postTokens)} tokens`
    : "";

  return (
    <div className="flex items-center gap-3 py-1" role="separator">
      <hr className="hairline flex-1" />
      <span className="font-mono text-[11.5px] text-muted-foreground shrink-0">
        Context compacted{tokensSuffix}
      </span>
      {trigger ? <span className="label shrink-0">{trigger}</span> : null}
      <hr className="hairline flex-1" />
    </div>
  );
}

function ContinuationSummary({ text }: { text: string }) {
  return (
    <details className="group mr-12">
      <summary className="inline-flex items-center gap-2 cursor-pointer list-none px-3 py-1.5 rounded-full bg-card font-mono text-[11px] text-muted-foreground select-none">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
        continuation summary
      </summary>
      <div className="mt-2 px-5 py-4 bg-card text-muted-foreground text-[13px] leading-relaxed whitespace-pre-wrap" style={{ borderRadius: "var(--radius-lg)" }}>
        {text}
      </div>
    </details>
  );
}

function SlashCommandChip({
  command,
  args,
  timeLabel,
}: {
  command: string;
  args: string;
  timeLabel: string | null;
}) {
  return (
    <div className="ml-12 flex items-center justify-end gap-3">
      {timeLabel ? <span className="label tabular-nums">{timeLabel}</span> : null}
      <span className="slash-chip inline-flex items-baseline gap-2 max-w-full px-3.5 py-2 rounded-full font-mono text-[12px]">
        <span className="font-medium shrink-0">{command}</span>
        {args ? <span className="text-muted-foreground truncate">{args}</span> : null}
      </span>
    </div>
  );
}

function ApiErrorLine({
  message,
  retryAttempt,
  maxRetries,
}: {
  message: string | null;
  retryAttempt: number | null;
  maxRetries: number | null;
}) {
  const hasRetryCounts = retryAttempt !== null && maxRetries !== null;
  const retrySuffix = hasRetryCounts ? ` — retried (attempt ${retryAttempt}/${maxRetries})` : "";

  return (
    <div className="mr-12 font-mono text-[11.5px] text-destructive/80" title={message ?? undefined}>
      API error{retrySuffix}
    </div>
  );
}

function ModelFallbackLine({ fromModel, toModel }: { fromModel: string | null; toModel: string | null }) {
  const fromLabel = fromModel === null ? "unknown" : shortModelName(fromModel);
  const toLabel = toModel === null ? "unknown" : shortModelName(toModel);

  return (
    <div className="mr-12 font-mono text-[11.5px] text-muted-foreground">
      fell back {fromLabel} → {toLabel}
    </div>
  );
}

// away_summary is a narrative worth reading, so it gets a real card instead
// of a collapsed meta row.
function AwaySummaryCard({ text }: { text: string }) {
  return (
    <div className="mr-12 px-6 py-4 bg-card" style={{ borderRadius: "var(--radius-lg)" }}>
      <span className="label">While you were away</span>
      <p className="text-[13px] leading-relaxed italic text-muted-foreground whitespace-pre-wrap m-0 mt-2">{text}</p>
    </div>
  );
}

type MetaRowContent = { label: string; summary: string; detail: string | null };

function MetaRow({ item }: { item: TranscriptItem }) {
  const content = metaRowContentOf(item);
  if (content === null) return null;

  const detail = content.detail;
  const hasDetail = detail !== null && detail.trim().length > 0;
  if (!hasDetail) {
    return (
      <div className="flex items-center min-w-0 py-0.5">
        <MetaRowLine label={content.label} summary={content.summary} />
      </div>
    );
  }

  return (
    <details className="min-w-0">
      <summary className="flex items-center min-w-0 py-0.5 cursor-pointer list-none select-none">
        <MetaRowLine label={content.label} summary={content.summary} />
      </summary>
      <div className="mt-1.5 mr-12">
        <JsonPanel text={detail} />
      </div>
    </details>
  );
}

function MetaRowLine({ label, summary }: { label: string; summary: string }) {
  return (
    <span className="inline-flex items-center gap-2 min-w-0 max-w-full">
      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-md bg-card text-muted-foreground shrink-0">
        {label}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground/80 truncate">{summary}</span>
    </span>
  );
}

function metaRowContentOf(item: TranscriptItem): MetaRowContent | null {
  switch (item.kind) {
    case TranscriptItemKind.Attachment:
      return { label: item.subtype, summary: item.summary, detail: item.payloadJson };
    case TranscriptItemKind.SystemEvent:
      return { label: item.subtype, summary: item.summary, detail: item.detailJson };
    case TranscriptItemKind.QueueOp:
      return {
        label: `queue · ${item.operation}`,
        summary: firstLineOf(item.content),
        detail: multilineDetailOf(item.content),
      };
    case TranscriptItemKind.SessionMeta:
      return { label: item.field, summary: item.value, detail: multilineDetailOf(item.value) };
    case TranscriptItemKind.FileSnapshot:
      return {
        label: "file snapshot",
        summary: `${item.trackedFileCount} tracked files`,
        detail: null,
      };
    case TranscriptItemKind.Unknown:
      return { label: item.rawType, summary: "unrecognized entry", detail: null };
    default:
      return null;
  }
}

// Bursts of injected/meta lines collapse into one row so the conversation
// stays readable; expanding reveals each row with its own inspector.
function MetaClusterRow({ items }: { items: TranscriptItem[] }) {
  const countLabel = `${items.length} injected events`;
  const kindSummary = clusterSummaryOf(items);

  return (
    <details className="min-w-0">
      <summary className="flex items-center min-w-0 py-0.5 cursor-pointer list-none select-none">
        <span className="inline-flex items-center gap-2 min-w-0 max-w-full">
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-md bg-card text-muted-foreground shrink-0">
            {countLabel}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground/70 truncate">{kindSummary}</span>
        </span>
      </summary>
      <div className="mt-1.5 flex flex-col gap-1 pl-3 border-l border-border">
        {items.map((item) => (
          <InspectableItem key={item.id} item={item} timeLabel={null} />
        ))}
      </div>
    </details>
  );
}

function clusterSummaryOf(items: TranscriptItem[]): string {
  const countsByLabel = new Map<string, number>();
  for (const item of items) {
    const label = metaRowContentOf(item)?.label ?? item.kind;
    countsByLabel.set(label, (countsByLabel.get(label) ?? 0) + 1);
  }

  const parts: string[] = [];
  for (const [label, count] of countsByLabel) {
    if (count > 1) {
      parts.push(`${label} ×${count}`);
    } else {
      parts.push(label);
    }
  }
  return parts.join(" · ");
}

function DayDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1" role="separator">
      <hr className="hairline flex-1" />
      <span className="label shrink-0">{label}</span>
      <hr className="hairline flex-1" />
    </div>
  );
}

function WorkingIndicator() {
  return (
    <div className="mr-12 inline-flex items-center gap-3 w-fit bg-card px-4 py-3" style={{ borderRadius: "var(--radius-lg)" }}>
      <RoleHeader name="Claude" dotClass="bg-primary" />
      <span className="flex items-center gap-1" aria-label="Claude is working">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:-0.3s]" />
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:-0.15s]" />
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce" />
      </span>
    </div>
  );
}

function RoleHeader({ name, dotClass }: { name: string; dotClass: string }) {
  return (
    <span className="label inline-flex items-center gap-2">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass}`} />
      {name}
    </span>
  );
}

const CLUSTER_MIN_ITEMS = 2;

// Quiet items are meta noise the reader can expand on demand; away_summary is
// narrative and stays a first-class row.
const QUIET_ITEM_KINDS = new Set<TranscriptItemKind>([
  TranscriptItemKind.Attachment,
  TranscriptItemKind.SystemEvent,
  TranscriptItemKind.QueueOp,
  TranscriptItemKind.SessionMeta,
  TranscriptItemKind.FileSnapshot,
  TranscriptItemKind.Unknown,
]);

function isQuietItem(item: TranscriptItem): boolean {
  if (!QUIET_ITEM_KINDS.has(item.kind)) return false;
  if (item.kind === TranscriptItemKind.SystemEvent && item.subtype === SystemSubtype.AwaySummary) {
    return false;
  }
  return true;
}

// Time labels anchor the conversation without stamping every row: user turns
// always get one, and the first assistant reply after each user turn does too.
// Consecutive quiet items collapse into cluster rows; a day boundary splits a
// cluster so the divider lands where the calendar flipped.
function buildTranscriptRows(items: TranscriptItem[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  let previousDayKey: string | null = null;
  let nextAssistantIsTurnAnchor = false;
  let pendingQuiet: { items: TranscriptItem[]; dayLabel: string | null } | null = null;

  const flushQuiet = (): void => {
    if (pendingQuiet === null) return;
    const [firstItem] = pendingQuiet.items;
    if (pendingQuiet.items.length >= CLUSTER_MIN_ITEMS) {
      rows.push({ rowKind: RowKind.Cluster, items: pendingQuiet.items, dayLabel: pendingQuiet.dayLabel });
    } else if (firstItem !== undefined) {
      rows.push({ rowKind: RowKind.Item, item: firstItem, timeLabel: null, dayLabel: pendingQuiet.dayLabel });
    }
    pendingQuiet = null;
  };

  for (const item of items) {
    const dayLabel = dayBoundaryLabel(item.timestampMs, previousDayKey);
    if (item.timestampMs !== null) previousDayKey = dayKeyOf(item.timestampMs);

    if (isQuietItem(item)) {
      if (dayLabel !== null) flushQuiet();
      if (pendingQuiet === null) pendingQuiet = { items: [], dayLabel };
      pendingQuiet.items.push(item);
      continue;
    }

    flushQuiet();

    let timeLabel: string | null = null;
    const isUserAuthored =
      item.kind === TranscriptItemKind.User ||
      item.kind === TranscriptItemKind.SlashCommand ||
      item.kind === TranscriptItemKind.Bash;
    if (item.timestampMs !== null && isUserAuthored) {
      timeLabel = formatTimeOfDay(item.timestampMs);
      nextAssistantIsTurnAnchor = true;
    }
    if (item.timestampMs !== null && item.kind === TranscriptItemKind.Assistant && nextAssistantIsTurnAnchor) {
      timeLabel = formatTimeOfDay(item.timestampMs);
      nextAssistantIsTurnAnchor = false;
    }

    rows.push({ rowKind: RowKind.Item, item, timeLabel, dayLabel });
  }

  flushQuiet();
  return rows;
}

function rowKeyOf(row: TranscriptRow): string {
  if (row.rowKind === RowKind.Item) return row.item.id;
  const firstItem = row.items[0];
  if (firstItem === undefined) return "cluster-empty";
  return `cluster-${firstItem.id}`;
}

function firstLineOf(text: string): string {
  return (text.trim().split("\n")[0] ?? "").trim();
}

function multilineDetailOf(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.includes("\n")) return null;
  return trimmed;
}

function dayBoundaryLabel(timestampMs: number | null, previousDayKey: string | null): string | null {
  if (timestampMs === null || previousDayKey === null) return null;
  if (dayKeyOf(timestampMs) === previousDayKey) return null;
  return formatDayLabel(timestampMs);
}

function dayKeyOf(timestampMs: number): string {
  return new Date(timestampMs).toDateString();
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatDayLabel(timestampMs: number): string {
  const date = new Date(timestampMs);
  const daysAgo = Math.round((startOfDayMs(new Date()) - startOfDayMs(date)) / MS_PER_DAY);
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function startOfDayMs(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const TWO_DIGITS = 2;

function formatTimeOfDay(timestampMs: number): string {
  const date = new Date(timestampMs);
  const hours = String(date.getHours()).padStart(TWO_DIGITS, "0");
  const minutes = String(date.getMinutes()).padStart(TWO_DIGITS, "0");
  return `${hours}:${minutes}`;
}

const TOKENS_PER_THOUSAND = 1000;
const TOKENS_PER_MILLION = 1_000_000;

function formatTokenCount(tokens: number): string {
  if (tokens >= TOKENS_PER_MILLION) return `${(tokens / TOKENS_PER_MILLION).toFixed(1)}M`;
  if (tokens >= TOKENS_PER_THOUSAND) return `${Math.round(tokens / TOKENS_PER_THOUSAND)}k`;
  return `${tokens}`;
}

const APPROX_CHARS_PER_TOKEN = 4;

function approximateTokenLabel(text: string): string {
  const tokens = Math.round(text.length / APPROX_CHARS_PER_TOKEN);
  if (tokens >= TOKENS_PER_THOUSAND) {
    return `~${(tokens / TOKENS_PER_THOUSAND).toFixed(1)}k tokens`;
  }
  return `~${tokens} tokens`;
}

const MODEL_PREFIX = "claude-";
const TRAILING_MINOR_VERSION_PATTERN = /-(\d+)-(\d+)$/;

// "claude-opus-4-8" → "opus-4.8", "claude-fable-5" → "fable-5".
function shortModelName(model: string): string {
  const withoutPrefix = model.startsWith(MODEL_PREFIX) ? model.slice(MODEL_PREFIX.length) : model;
  return withoutPrefix.replace(TRAILING_MINOR_VERSION_PATTERN, "-$1.$2");
}
