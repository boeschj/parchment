// Icon vocabulary — a thin adapter over lucide-react so the app shares one
// visual language with the genui widgets (24-grid, 2px stroke, ~83% optical
// fill). Exported names are the app's stable vocabulary; consumers size via
// width/height (or lucide's size prop).

import {
  Activity,
  AppWindow,
  ChartColumn,
  Check,
  ChevronsLeft,
  FileDiff,
  FileText,
  Library,
  MessageSquare,
  Moon,
  Palette,
  Sparkles,
  Sun,
  Table,
  Trash2,
  Waypoints,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

import { SlotKind } from "../../shared/types.ts";

export type IconProps = LucideProps;

export const DocIcon = FileText;
export const FlowIcon = Waypoints;
export const AppIcon = AppWindow;
export const TableIcon = Table;
export const ChartIcon = ChartColumn;
export const DiffIcon = FileDiff;
export const SparkleIcon = Sparkles;
export const TranscriptIcon = MessageSquare;
export const SunIcon = Sun;
export const MoonIcon = Moon;
export const ChevronsLeftIcon = ChevronsLeft;
export const LibraryIcon = Library;
export const LiveIcon = Activity;
export const PaletteIcon = Palette;
export const TrashIcon = Trash2;
export const CheckIcon = Check;

const SLOT_KIND_ICON: Record<string, LucideIcon> = {
  [SlotKind.Plan]: DocIcon,
  [SlotKind.Diagram]: FlowIcon,
  [SlotKind.Diff]: DiffIcon,
  [SlotKind.Dashboard]: ChartIcon,
  [SlotKind.Table]: TableIcon,
  [SlotKind.Report]: DocIcon,
  [SlotKind.Render]: SparkleIcon,
  [SlotKind.App]: AppIcon,
};

export function SlotKindIcon({ kind, ...props }: IconProps & { kind: string }) {
  const Icon = SLOT_KIND_ICON[kind] ?? SparkleIcon;
  return <Icon {...props} />;
}
