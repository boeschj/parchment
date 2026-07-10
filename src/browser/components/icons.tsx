// Icon vocabulary — a thin adapter over lucide-react so the app shares one
// visual language with the genui widgets (24-grid, 2px stroke, ~83% optical
// fill). Exported names are the app's stable vocabulary; consumers size via
// width/height (or lucide's size prop).

import {
  ChartColumn,
  ChevronsLeft,
  CircleDollarSign,
  FileDiff,
  FileText,
  FolderOpen,
  Gauge,
  MessageSquare,
  Moon,
  Network,
  Presentation,
  ShieldCheck,
  Sparkles,
  Sun,
  Table,
  Waypoints,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

import { SlotKind } from "../../shared/types.ts";

export type IconProps = LucideProps;

export const DocIcon = FileText;
export const FlowIcon = Waypoints;
export const TableIcon = Table;
export const ChartIcon = ChartColumn;
export const DiffIcon = FileDiff;
export const SparkleIcon = Sparkles;
export const TranscriptIcon = MessageSquare;
export const BoardIcon = Presentation;
export const SunIcon = Sun;
export const MoonIcon = Moon;
export const ChevronsLeftIcon = ChevronsLeft;
export const ExplorerIcon = FolderOpen;
export const GraphIcon = Network;
export const CostIcon = CircleDollarSign;
export const ContextIcon = Gauge;
export const ShieldIcon = ShieldCheck;

const SLOT_KIND_ICON: Record<string, LucideIcon> = {
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
