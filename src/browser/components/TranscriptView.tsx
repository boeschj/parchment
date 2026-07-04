// Full-fidelity, read-only session transcript: user prompts, Claude's prose,
// thinking blocks, and every tool call with its output. Streams live —
// use-stick-to-bottom keeps the newest activity in view unless the user
// scrolls up to read.

import { StickToBottom } from "use-stick-to-bottom";
import { Streamdown } from "streamdown";
import type { TranscriptItem, TranscriptModel } from "../transcript/parse.ts";

const TOOL_OUTPUT_DISPLAY_LIMIT = 4000;

export function TranscriptView({ transcript }: { transcript: TranscriptModel }) {
  return (
    <StickToBottom className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scroll-fade-top" resize="smooth" initial="instant">
      <StickToBottom.Content className="max-w-[860px] mx-auto px-7 pb-10 flex flex-col gap-5">
        {transcript.items.map((item) => (
          <TranscriptItemView key={item.id} item={item} />
        ))}
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

// User and assistant turns are deliberately asymmetric so the speaker reads
// at a glance: the user's prompt sits on a distinct tinted surface, indented
// from the left; Claude's reply sits on the card surface at full width. Both
// carry a labelled role header with a role-colored dot (accent = Claude).
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

function RoleHeader({ name, dotClass }: { name: string; dotClass: string }) {
  return (
    <span className="label inline-flex items-center gap-2">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass}`} />
      {name}
    </span>
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

function ToolCall({ item }: { item: Extract<TranscriptItem, { kind: "tool" }> }) {
  const status = toolStatus(item);

  return (
    <details className="group mr-12">
      <summary className="flex items-center gap-2.5 cursor-pointer list-none px-4 py-2 rounded-full bg-card select-none min-w-0">
        <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${status.dotClass}`} />
        <span className="font-mono text-[12px] font-medium shrink-0">{item.name}</span>
        <span className="font-mono text-[11.5px] text-muted-foreground truncate">
          {toolSummary(item)}
        </span>
      </summary>
      <div className="mt-2 bg-card overflow-hidden" style={{ borderRadius: "var(--radius-lg)" }}>
        <div className="px-5 py-3">
          <span className="label block mb-2">Input</span>
          <pre className="font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap m-0 text-muted-foreground">
            {JSON.stringify(item.input, null, 2)}
          </pre>
        </div>
        {item.output !== null ? (
          <>
            <hr className="hairline mx-5" />
            <div className="px-5 py-3">
              <span className="label block mb-2">{item.isError ? "Error" : "Output"}</span>
              <pre className={`font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap m-0 ${item.isError ? "text-destructive" : "text-muted-foreground"}`}>
                {truncateOutput(item.output)}
              </pre>
            </div>
          </>
        ) : null}
      </div>
    </details>
  );
}

function toolStatus(item: Extract<TranscriptItem, { kind: "tool" }>): { dotClass: string } {
  if (item.isError) return { dotClass: "bg-destructive" };
  if (item.output === null) return { dotClass: "bg-amber-500" };
  return { dotClass: "bg-success" };
}

// The most informative single input field per tool; fall back to the first
// string value so unknown/MCP tools still get a readable one-liner.
const TOOL_SUMMARY_PROP: Record<string, string> = {
  Bash: "command",
  Read: "file_path",
  Edit: "file_path",
  Write: "file_path",
  Glob: "pattern",
  Grep: "pattern",
  Agent: "description",
  Skill: "skill",
  WebFetch: "url",
  WebSearch: "query",
};

function toolSummary(item: Extract<TranscriptItem, { kind: "tool" }>): string {
  const preferredProp = TOOL_SUMMARY_PROP[item.name];
  const preferred = preferredProp ? item.input[preferredProp] : undefined;
  if (typeof preferred === "string") return preferred;
  const firstString = Object.values(item.input).find((value) => typeof value === "string");
  if (typeof firstString === "string") return firstString;
  return "";
}

function truncateOutput(output: string): string {
  if (output.length <= TOOL_OUTPUT_DISPLAY_LIMIT) return output;
  return `${output.slice(0, TOOL_OUTPUT_DISPLAY_LIMIT)}\n… (${output.length - TOOL_OUTPUT_DISPLAY_LIMIT} more characters)`;
}
