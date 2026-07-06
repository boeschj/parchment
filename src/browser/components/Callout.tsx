import { Fragment, type ReactNode } from "react";
import type { z } from "zod/v4";
import { CalloutTone, CalloutPropsSchema } from "../../shared/catalog/extensions/Callout.ts";

type CalloutProps = z.infer<typeof CalloutPropsSchema>;
type RenderProps = { props: CalloutProps };
type CalloutToneValue = (typeof CalloutTone)[keyof typeof CalloutTone];

// Same amber literal the Alert override uses — there is no --warning token.
const WARNING_ACCENT = "#D97706";

const TONE_ACCENT: Record<CalloutToneValue, string> = {
  [CalloutTone.Info]: "var(--muted-foreground)",
  [CalloutTone.Success]: "var(--success)",
  [CalloutTone.Warning]: WARNING_ACCENT,
  [CalloutTone.Danger]: "var(--destructive)",
  [CalloutTone.Tip]: "var(--primary)",
};

const TONE_GLYPH: Record<CalloutToneValue, string> = {
  [CalloutTone.Info]: "ⓘ",
  [CalloutTone.Success]: "✓",
  [CalloutTone.Warning]: "⚠",
  [CalloutTone.Danger]: "✗",
  [CalloutTone.Tip]: "✦",
};

export function Callout({ props }: RenderProps) {
  const accent = TONE_ACCENT[props.tone];
  const glyph = TONE_GLYPH[props.tone];
  const paddingClass = props.compact ? "px-3.5 py-2.5" : "px-4 py-3.5";
  const textSizeClass = props.compact ? "text-[13px]" : "text-sm";

  return (
    <div
      className={`flex gap-2.5 ${paddingClass}`}
      style={{
        background: `color-mix(in oklab, ${accent} 8%, transparent)`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: "var(--radius-md)",
      }}
    >
      <span aria-hidden className={`${textSizeClass} leading-relaxed`} style={{ color: accent }}>
        {glyph}
      </span>
      <div className="min-w-0 flex flex-col gap-0.5">
        {props.title ? (
          <div className={`${textSizeClass} font-semibold leading-snug`}>{props.title}</div>
        ) : null}
        <div className={`${textSizeClass} leading-relaxed text-foreground/90`}>
          {renderCalloutBody(props.body)}
        </div>
      </div>
    </div>
  );
}

function renderCalloutBody(body: string): ReactNode[] {
  return body.split("\n").flatMap((line, lineIndex) => {
    const inlineNodes = renderInlineCodeSpans(line, lineIndex);
    if (lineIndex === 0) return inlineNodes;
    return [<br key={`br-${lineIndex}`} />, ...inlineNodes];
  });
}

function renderInlineCodeSpans(line: string, lineIndex: number): ReactNode[] {
  return line.split("`").map((segment, segmentIndex) => {
    const key = `${lineIndex}-${segmentIndex}`;
    const isCodeSpan = segmentIndex % 2 === 1;
    if (!isCodeSpan) return <Fragment key={key}>{segment}</Fragment>;
    return (
      <code key={key} className="font-mono text-[0.85em] px-1.5 py-0.5 rounded-sm bg-background/60">
        {segment}
      </code>
    );
  });
}
