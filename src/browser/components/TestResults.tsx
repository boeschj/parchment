import type { z } from "zod/v4";
import { TestResultsPropsSchema } from "../../shared/catalog/extensions/TestResults.ts";

type TestResultsProps = z.infer<typeof TestResultsPropsSchema>;
type RenderProps = { props: TestResultsProps };

export function TestResults({ props }: RenderProps) {
  const failedAccent = props.failed > 0 ? "var(--destructive)" : "var(--muted-foreground)";
  const failures = props.failures ?? [];
  const durationLabel = props.durationMs !== undefined ? formatDuration(props.durationMs) : null;

  return (
    <div className="bg-card text-card-foreground p-5" style={{ borderRadius: "var(--radius)" }}>
      <div className="flex items-center gap-5 flex-wrap font-mono text-[12.5px] tabular-nums">
        <span style={{ color: "var(--success)" }}>✓ {props.passed} passed</span>
        <span style={{ color: failedAccent }}>✗ {props.failed} failed</span>
        {props.skipped !== undefined ? (
          <span className="text-muted-foreground">○ {props.skipped} skipped</span>
        ) : null}
        {durationLabel ? <span className="text-muted-foreground">◷ {durationLabel}</span> : null}
      </div>
      {failures.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2.5">
          {failures.map((failure, index) => (
            <div
              key={`${failure.name}-${index}`}
              className="pl-3"
              style={{ borderLeft: "2px solid var(--destructive)" }}
            >
              <div className="font-mono text-[12.5px] leading-snug">{failure.name}</div>
              {failure.message ? (
                <p className="text-xs text-muted-foreground leading-relaxed m-0 mt-1 whitespace-pre-wrap">
                  {failure.message}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

function formatDuration(durationMs: number): string {
  if (durationMs < MS_PER_SECOND) return `${durationMs}ms`;
  const totalSeconds = durationMs / MS_PER_SECOND;
  if (totalSeconds < SECONDS_PER_MINUTE) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = Math.round(totalSeconds % SECONDS_PER_MINUTE);
  return `${minutes}m ${seconds}s`;
}
