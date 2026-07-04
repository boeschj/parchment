import { StickToBottom } from "use-stick-to-bottom";
import { Streamdown } from "streamdown";
import type { TranscriptItem, TranscriptModel } from "../transcript/parse.ts";
import { ToolCall } from "./ToolCall.tsx";

export function TranscriptView({
  transcript,
  isWorking,
}: {
  transcript: TranscriptModel;
  isWorking: boolean;
}) {
  return (
    <StickToBottom className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scroll-fade-top" resize="smooth" initial="instant">
      <StickToBottom.Content className="max-w-[860px] mx-auto px-7 pb-10 flex flex-col gap-5">
        {transcript.items.map((item) => (
          <TranscriptItemView key={item.id} item={item} />
        ))}
        {isWorking ? <WorkingIndicator /> : null}
      </StickToBottom.Content>
    </StickToBottom>
  );
}

function TranscriptItemView({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case "user":
      return <UserMessage text={item.text} />;
    case "assistant":
      return <AssistantMessage markdown={item.markdown} />;
    case "thinking":
      return <ThinkingBlock text={item.text} />;
    case "tool":
      return <ToolCall item={item} />;
  }
}

function UserMessage({ text }: { text: string }) {
  return (
    <div className="ml-12 bg-secondary text-secondary-foreground px-6 py-4" style={{ borderRadius: "var(--radius-lg)" }}>
      <RoleHeader name="You" dotClass="bg-muted-foreground" />
      <p className="text-[15px] leading-relaxed whitespace-pre-wrap m-0 mt-2">{text}</p>
    </div>
  );
}

function AssistantMessage({ markdown }: { markdown: string }) {
  return (
    <div className="mr-12 bg-card text-card-foreground px-6 py-5" style={{ borderRadius: "var(--radius-lg)" }}>
      <RoleHeader name="Claude" dotClass="bg-primary" />
      <Streamdown className="transcript-prose mt-3">{markdown}</Streamdown>
    </div>
  );
}

function ThinkingBlock({ text }: { text: string }) {
  return (
    <details className="group mr-12">
      <summary className="inline-flex items-center gap-2 cursor-pointer list-none px-3 py-1.5 rounded-full bg-card font-mono text-[11px] text-muted-foreground select-none">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
        thinking
      </summary>
      <div className="mt-2 px-5 py-4 bg-card text-muted-foreground text-[13px] leading-relaxed italic whitespace-pre-wrap" style={{ borderRadius: "var(--radius-lg)" }}>
        {text}
      </div>
    </details>
  );
}

function WorkingIndicator() {
  return (
    <div className="mr-12 inline-flex items-center gap-3 w-fit bg-card px-4 py-3" style={{ borderRadius: "var(--radius-lg)" }}>
      <RoleHeader name="Claude" dotClass="bg-primary" />
      <span className="flex items-center gap-1" aria-label="Claude is working">
        <BounceDot delay="0ms" />
        <BounceDot delay="150ms" />
        <BounceDot delay="300ms" />
      </span>
    </div>
  );
}

function BounceDot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce"
      style={{ animationDelay: delay }}
    />
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
