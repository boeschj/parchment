import { Streamdown } from "streamdown";
import type { z } from "zod/v4";
import { MarkdownPropsSchema } from "../../shared/catalog/extensions/Markdown.ts";

type MarkdownProps = z.infer<typeof MarkdownPropsSchema>;
type RenderProps = { props: MarkdownProps };

// Same renderer + prose treatment as Claude's messages in the transcript
// view, so long-form sections read with one consistent voice.
export function Markdown({ props }: RenderProps) {
  const scrollStyle =
    props.maxHeight !== undefined
      ? { maxHeight: props.maxHeight, overflowY: "auto" as const }
      : undefined;

  return (
    <div style={scrollStyle}>
      <Streamdown className="transcript-prose">{props.content}</Streamdown>
    </div>
  );
}
