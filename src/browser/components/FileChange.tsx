import type { z } from "zod/v4";
import {
  FileChangeKind,
  FileChangePropsSchema,
} from "../../shared/catalog/extensions/FileChange.ts";

type FileChangeProps = z.infer<typeof FileChangePropsSchema>;
type RenderProps = { props: FileChangeProps };
type FileChangeKindValue = (typeof FileChangeKind)[keyof typeof FileChangeKind];

// Amber matches the Alert override's warning accent; blue is the
// conventional rename color — neither has a theme token.
const MODIFIED_ACCENT = "#D97706";
const RENAMED_ACCENT = "#2563EB";

const KIND_CHIP: Record<FileChangeKindValue, { letter: string; accent: string }> = {
  [FileChangeKind.Created]: { letter: "A", accent: "var(--success)" },
  [FileChangeKind.Modified]: { letter: "M", accent: MODIFIED_ACCENT },
  [FileChangeKind.Deleted]: { letter: "D", accent: "var(--destructive)" },
  [FileChangeKind.Renamed]: { letter: "R", accent: RENAMED_ACCENT },
};

export function FileChange({ props }: RenderProps) {
  const chip = KIND_CHIP[props.kind];
  const isDeleted = props.kind === FileChangeKind.Deleted;
  const isRenamedWithSource = props.kind === FileChangeKind.Renamed && Boolean(props.renamedFrom);
  const pathLabel = isRenamedWithSource ? `${props.renamedFrom} → ${props.path}` : props.path;
  const pathClass = isDeleted ? "line-through text-muted-foreground" : "text-foreground";

  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className="w-5 h-5 shrink-0 flex items-center justify-center rounded-sm font-mono text-[11px] font-medium"
          style={{
            color: chip.accent,
            background: `color-mix(in oklab, ${chip.accent} 15%, transparent)`,
          }}
        >
          {chip.letter}
        </span>
        <code className={`font-mono text-[13px] truncate ${pathClass}`}>{pathLabel}</code>
        <span className="flex-1" />
        {props.additions !== undefined ? (
          <span className="shrink-0 font-mono text-xs tabular-nums" style={{ color: "var(--success)" }}>
            +{props.additions}
          </span>
        ) : null}
        {props.deletions !== undefined ? (
          <span className="shrink-0 font-mono text-xs tabular-nums" style={{ color: "var(--destructive)" }}>
            −{props.deletions}
          </span>
        ) : null}
      </div>
      {props.summary ? (
        <p className="text-[13px] text-muted-foreground leading-relaxed m-0 pl-[30px]">
          {props.summary}
        </p>
      ) : null}
    </div>
  );
}
