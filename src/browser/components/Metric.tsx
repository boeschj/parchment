import type { z } from "zod/v4";
import {
  MetricTone,
  MetricTrend,
  MetricPropsSchema,
} from "../../shared/catalog/extensions/Metric.ts";

type MetricProps = z.infer<typeof MetricPropsSchema>;
type RenderProps = { props: MetricProps };
type MetricToneValue = (typeof MetricTone)[keyof typeof MetricTone];
type MetricTrendValue = (typeof MetricTrend)[keyof typeof MetricTrend];

// Same amber literal the Alert override uses — there is no --warning token.
const WARNING_ACCENT = "#D97706";

const TONE_ACCENT: Record<MetricToneValue, string> = {
  [MetricTone.Neutral]: "var(--muted-foreground)",
  [MetricTone.Success]: "var(--success)",
  [MetricTone.Warning]: WARNING_ACCENT,
  [MetricTone.Danger]: "var(--destructive)",
};

const TREND_ARROW: Record<MetricTrendValue, string> = {
  [MetricTrend.Up]: "↑",
  [MetricTrend.Down]: "↓",
  [MetricTrend.Flat]: "→",
};

export function Metric({ props }: RenderProps) {
  const arrow = props.trend ? TREND_ARROW[props.trend] : null;
  const deltaAccent = resolveDeltaAccent(props.tone, props.trend);

  return (
    <div
      className="bg-card text-card-foreground p-5 flex flex-col gap-2"
      style={{ borderRadius: "var(--radius)" }}
    >
      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {props.label}
      </span>
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className="text-[30px] font-semibold tracking-tight leading-none tabular-nums">
          {props.value}
        </span>
        {props.delta ? (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-mono text-[11px] leading-none"
            style={{
              color: deltaAccent,
              background: `color-mix(in oklab, ${deltaAccent} 12%, transparent)`,
            }}
          >
            {arrow ? <span aria-hidden>{arrow}</span> : null}
            {props.delta}
          </span>
        ) : null}
      </div>
      {props.detail ? (
        <p className="text-xs text-muted-foreground leading-snug m-0">{props.detail}</p>
      ) : null}
    </div>
  );
}

function resolveDeltaAccent(
  tone: MetricProps["tone"],
  trend: MetricProps["trend"],
): string {
  if (tone) return TONE_ACCENT[tone];
  if (trend === MetricTrend.Up) return TONE_ACCENT[MetricTone.Success];
  if (trend === MetricTrend.Down) return TONE_ACCENT[MetricTone.Danger];
  return TONE_ACCENT[MetricTone.Neutral];
}
