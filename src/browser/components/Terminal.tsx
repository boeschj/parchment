import type { z } from "zod/v4";
import { TerminalPropsSchema } from "../../shared/catalog/extensions/Terminal.ts";

type TerminalProps = z.infer<typeof TerminalPropsSchema>;
type RenderProps = { props: TerminalProps };

// Always-dark by design — the one surface exempt from theme tokens, so a
// terminal reads as a terminal in both light and dark mode.
const TERMINAL_BG = "#0D0D0F";
const TERMINAL_HAIRLINE = "rgba(255, 255, 255, 0.07)";
const PROMPT_GOLD = "#CEA500";
const COMMAND_INK = "#F0F0F2";
const OUTPUT_INK = "#B9B9C0";
const MUTED_INK = "#77777F";
const EXIT_OK_INK = "#4ADE80";
const EXIT_FAIL_INK = "#F87171";
const OUTPUT_MAX_HEIGHT_PX = 360;

export function Terminal({ props }: RenderProps) {
  const hasHeader = Boolean(props.cwd) || props.exitCode !== undefined;
  const hasOutput = props.output.length > 0;
  const exitAccent = props.exitCode === 0 ? EXIT_OK_INK : EXIT_FAIL_INK;

  return (
    <div
      className="font-mono text-[12.5px] leading-relaxed overflow-hidden"
      style={{ background: TERMINAL_BG, borderRadius: "var(--radius-md)" }}
    >
      {hasHeader ? (
        <header
          className="flex items-center justify-between gap-3 px-4 py-2"
          style={{ borderBottom: `1px solid ${TERMINAL_HAIRLINE}` }}
        >
          <span className="truncate text-[11.5px]" style={{ color: MUTED_INK }}>
            {props.cwd ?? ""}
          </span>
          {props.exitCode !== undefined ? (
            <span
              className="shrink-0 rounded-full px-2 py-1 text-[11px] leading-none"
              style={{
                color: exitAccent,
                background: `color-mix(in oklab, ${exitAccent} 14%, transparent)`,
              }}
            >
              exit {props.exitCode}
            </span>
          ) : null}
        </header>
      ) : null}
      <div className="px-4 py-3">
        <div className="flex gap-2">
          <span aria-hidden className="select-none" style={{ color: PROMPT_GOLD }}>
            $
          </span>
          <span className="whitespace-pre-wrap break-words min-w-0" style={{ color: COMMAND_INK }}>
            {props.command}
          </span>
        </div>
        {hasOutput ? (
          <pre
            className="m-0 mt-2 font-mono text-[12.5px] whitespace-pre-wrap break-words overflow-y-auto"
            style={{ color: OUTPUT_INK, maxHeight: OUTPUT_MAX_HEIGHT_PX }}
          >
            {props.output}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
