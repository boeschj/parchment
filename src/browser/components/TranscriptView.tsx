import { Fragment } from "react";
import { StickToBottom } from "use-stick-to-bottom";
import { Streamdown } from "streamdown";
import type { TranscriptItem, TranscriptModel } from "../transcript/parse.ts";
import { TranscriptItemKind } from "../transcript/parse.ts";
import { ToolCall } from "./ToolCall.tsx";
import { ImageAttachments } from "./ImageAttachments.tsx";

type TranscriptRow = {
  item: TranscriptItem;
  timeLabel: string | null;
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
    <StickToBottom className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scroll-fade-top" resize="smooth" initial="instant">
      <StickToBottom.Content className="max-w-[860px] mx-auto px-7 pb-10 flex flex-col gap-5">
        {rows.map(({ item, timeLabel, dayLabel }) => (
          <Fragment key={item.id}>
            {dayLabel ? <DayDivider label={dayLabel} /> : null}
            <TranscriptItemView item={item} timeLabel={timeLabel} />
          </Fragment>
        ))}
        {isWorking ? <WorkingIndicator /> : null}
      </StickToBottom.Content>
    </StickToBottom>
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
    <div className="ml-12 text-foreground px-6 py-4" style={{ background: "var(--user-bubble)", borderRadius: "var(--radius-lg)" }}>
      <div className="flex items-center justify-between gap-3">
        <RoleHeader name="You" dotClass="bg-muted-foreground" />
        {timeLabel ? <span className="label">{timeLabel}</span> : null}
      </div>
      <p className="text-[15px] leading-relaxed whitespace-pre-wrap m-0 mt-2">{text}</p>
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
            <span className="label truncate opacity-0 group-hover:opacity-100 transition-opacity">{metaLabel}</span>
          ) : null}
          {timeLabel ? <span className="label shrink-0">{timeLabel}</span> : null}
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
      {timeLabel ? <span className="label">{timeLabel}</span> : null}
      <span
        className="inline-flex items-baseline gap-2 max-w-full px-3.5 py-2 rounded-full font-mono text-[12px]"
        style={{ background: "var(--user-bubble)" }}
      >
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

// Time labels anchor the conversation without stamping every row: user turns
// always get one, and the first assistant reply after each user turn does too.
function buildTranscriptRows(items: TranscriptItem[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  let previousDayKey: string | null = null;
  let nextAssistantIsTurnAnchor = false;

  for (const item of items) {
    const dayLabel = dayBoundaryLabel(item.timestampMs, previousDayKey);
    if (item.timestampMs !== null) previousDayKey = dayKeyOf(item.timestampMs);

    let timeLabel: string | null = null;
    const isUserAuthored =
      item.kind === TranscriptItemKind.User || item.kind === TranscriptItemKind.SlashCommand;
    if (item.timestampMs !== null && isUserAuthored) {
      timeLabel = formatTimeOfDay(item.timestampMs);
      nextAssistantIsTurnAnchor = true;
    }
    if (item.timestampMs !== null && item.kind === TranscriptItemKind.Assistant && nextAssistantIsTurnAnchor) {
      timeLabel = formatTimeOfDay(item.timestampMs);
      nextAssistantIsTurnAnchor = false;
    }

    rows.push({ item, timeLabel, dayLabel });
  }

  return rows;
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
