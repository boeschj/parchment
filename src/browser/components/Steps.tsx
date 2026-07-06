import type { z } from "zod/v4";
import { StepStatus, StepsPropsSchema } from "../../shared/catalog/extensions/Steps.ts";

type StepsProps = z.infer<typeof StepsPropsSchema>;
type RenderProps = { props: StepsProps };
type StepStatusValue = (typeof StepStatus)[keyof typeof StepStatus];

export function Steps({ props }: RenderProps) {
  const lastIndex = props.items.length - 1;

  return (
    <ol className="flex flex-col m-0 p-0 list-none">
      {props.items.map((item, index) => {
        const isLast = index === lastIndex;
        const bodyClass = isLast ? "min-w-0" : "min-w-0 pb-5";

        return (
          <li key={`${item.title}-${index}`} className="flex gap-3">
            <div className="flex flex-col items-center">
              <StepIndicator status={item.status} />
              {isLast ? null : (
                <span
                  aria-hidden
                  className="w-px flex-1 min-h-3"
                  style={{ background: "var(--hairline)" }}
                />
              )}
            </div>
            <div className={bodyClass}>
              <div className="text-sm font-medium leading-5">{item.title}</div>
              {item.detail ? (
                <p className="text-[13px] text-muted-foreground leading-relaxed m-0 mt-0.5">
                  {item.detail}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StepIndicator({ status }: { status: StepStatusValue }) {
  if (status === StepStatus.Done) {
    return <GlyphCircle glyph="✓" accent="var(--success)" statusName="done" />;
  }
  if (status === StepStatus.Error) {
    return <GlyphCircle glyph="✗" accent="var(--destructive)" statusName="error" />;
  }
  if (status === StepStatus.Active) {
    return (
      <span className="w-5 h-5 shrink-0 flex items-center justify-center" aria-label="active">
        <span className="w-2.5 h-2.5 rounded-full bg-primary" />
      </span>
    );
  }
  return (
    <span className="w-5 h-5 shrink-0 flex items-center justify-center" aria-label="pending">
      <span
        className="w-2.5 h-2.5 rounded-full border"
        style={{ borderColor: "color-mix(in oklab, var(--muted-foreground) 55%, transparent)" }}
      />
    </span>
  );
}

function GlyphCircle({
  glyph,
  accent,
  statusName,
}: {
  glyph: string;
  accent: string;
  statusName: string;
}) {
  return (
    <span
      className="w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[11px] font-medium"
      style={{
        background: `color-mix(in oklab, ${accent} 15%, transparent)`,
        color: accent,
      }}
      aria-label={statusName}
    >
      {glyph}
    </span>
  );
}
