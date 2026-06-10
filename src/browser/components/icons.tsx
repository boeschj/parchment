// Minimal line icons from the clawd-canvas mockups — 20px viewBox, 1.4
// stroke, round caps. Sized by the consumer via width/height props.

import type { SVGProps } from "react";

import { SlotKind } from "../../shared/types.ts";

type IconProps = SVGProps<SVGSVGElement>;

const STROKE = {
  stroke: "currentColor",
  strokeWidth: 1.4,
  fill: "none",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function DocIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden {...props}>
      <path d="M5 3h7l3 3v11H5z M12 3v3h3 M7 9h6 M7 12h6 M7 15h4" {...STROKE} />
    </svg>
  );
}

export function FlowIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden {...props}>
      <circle cx="5" cy="5" r="2" {...STROKE} />
      <circle cx="15" cy="5" r="2" {...STROKE} />
      <circle cx="10" cy="15" r="2" {...STROKE} />
      <path d="M6.5 6.5 9 13.5 M13.5 6.5 11 13.5" {...STROKE} />
    </svg>
  );
}

export function TableIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden {...props}>
      <rect x="3" y="4" width="14" height="12" rx="1.5" {...STROKE} />
      <path d="M3 8h14 M3 12h14 M10 4v12" {...STROKE} />
    </svg>
  );
}

export function ChartIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden {...props}>
      <path d="M3 16h14 M6 13V8 M10 13V5 M14 13v-4" {...STROKE} />
    </svg>
  );
}

export function DiffIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden {...props}>
      <path d="M6 4v12 M6 4l-2 2 M6 4l2 2 M14 16V4 M14 16l-2-2 M14 16l2-2" {...STROKE} />
    </svg>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden {...props}>
      <path
        d="M10 3v3 M10 14v3 M3 10h3 M14 10h3 M5.5 5.5l2 2 M12.5 12.5l2 2 M14.5 5.5l-2 2 M7.5 12.5l-2 2"
        {...STROKE}
      />
    </svg>
  );
}

export function TranscriptIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden {...props}>
      <path d="M4 4h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8l-4 3V5a1 1 0 0 1 1-1z" {...STROKE} />
      <path d="M7 8h6 M7 11h4" {...STROKE} />
    </svg>
  );
}

export function BoardIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden {...props}>
      <rect x="3" y="3" width="14" height="14" rx="3" {...STROKE} />
      <path d="M7 13l2.5-5 2 3.5L13 9" {...STROKE} />
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden {...props}>
      <circle cx="10" cy="10" r="3.2" {...STROKE} />
      <path
        d="M10 2.5v2 M10 15.5v2 M2.5 10h2 M15.5 10h2 M4.6 4.6l1.4 1.4 M14 14l1.4 1.4 M15.4 4.6 14 6 M6 14l-1.4 1.4"
        {...STROKE}
      />
    </svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden {...props}>
      <path d="M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7z" {...STROKE} />
    </svg>
  );
}

const SLOT_KIND_ICON: Record<string, (props: IconProps) => React.JSX.Element> = {
  [SlotKind.Plan]: DocIcon,
  [SlotKind.Diagram]: FlowIcon,
  [SlotKind.Diff]: DiffIcon,
  [SlotKind.Dashboard]: ChartIcon,
  [SlotKind.Table]: TableIcon,
  [SlotKind.Report]: DocIcon,
  [SlotKind.Render]: SparkleIcon,
};

export function SlotKindIcon({ kind, ...props }: IconProps & { kind: string }) {
  const Icon = SLOT_KIND_ICON[kind] ?? SparkleIcon;
  return <Icon {...props} />;
}
