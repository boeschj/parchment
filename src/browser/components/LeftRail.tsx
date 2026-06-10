// Left icon rail per the mockups: 72px transparent column, 40px circular
// items. Fixed surfaces (Transcript, Plan, Board) sit above a hairline
// divider; dynamic slots Claude pushes appear below it. The active item
// sits in a sidebar-accent pill with a gold icon and a 5px gold dot
// floating to its left. The theme toggle lives at the bottom.

import type { ReactNode } from "react";
import type { Slot } from "../../shared/types.ts";
import { Theme } from "../theme.ts";
import { Surface, type CanvasView } from "../view.ts";
import {
  BoardIcon,
  DocIcon,
  MoonIcon,
  SlotKindIcon,
  SunIcon,
  TranscriptIcon,
} from "./icons.tsx";

const SURFACE_ITEMS = [
  { surface: Surface.Transcript, label: "Transcript", icon: <TranscriptIcon width={19} height={19} /> },
  { surface: Surface.Plan, label: "Plan", icon: <DocIcon width={19} height={19} /> },
  { surface: Surface.Board, label: "Board", icon: <BoardIcon width={19} height={19} /> },
] as const;

type LeftRailProps = {
  slots: Slot[];
  view: CanvasView;
  onSelectView: (view: CanvasView) => void;
  theme: Theme;
  onToggleTheme: () => void;
};

export function LeftRail({ slots, view, onSelectView, theme, onToggleTheme }: LeftRailProps) {
  const ThemeIcon = theme === Theme.Dark ? SunIcon : MoonIcon;
  const themeLabel = theme === Theme.Dark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <nav className="w-[72px] shrink-0 py-2 flex flex-col items-center gap-3.5">
      {SURFACE_ITEMS.map((item) => (
        <RailItem
          key={item.surface}
          label={item.label}
          isActive={view.type === "surface" && view.surface === item.surface}
          onSelect={() => onSelectView({ type: "surface", surface: item.surface })}
        >
          {item.icon}
        </RailItem>
      ))}

      {slots.length > 0 ? <div className="w-4 h-px bg-border" /> : null}

      {slots.map((slot) => (
        <RailItem
          key={slot.id}
          label={slot.title}
          isActive={view.type === "slot" && view.slotId === slot.id}
          onSelect={() => onSelectView({ type: "slot", slotId: slot.id })}
        >
          <SlotKindIcon kind={slot.kind} width={19} height={19} />
        </RailItem>
      ))}

      <div className="flex-1" />
      <button
        type="button"
        title={themeLabel}
        aria-label={themeLabel}
        onClick={onToggleTheme}
        className="w-10 h-10 rounded-full flex items-center justify-center text-sidebar-foreground hover:text-foreground transition-colors"
      >
        <ThemeIcon width={19} height={19} />
      </button>
    </nav>
  );
}

type RailItemProps = {
  label: string;
  isActive: boolean;
  onSelect: () => void;
  children: ReactNode;
};

function RailItem({ label, isActive, onSelect, children }: RailItemProps) {
  const itemClass = isActive
    ? "bg-sidebar-accent text-sidebar-accent-foreground"
    : "text-sidebar-foreground hover:text-foreground";

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-current={isActive ? "page" : undefined}
      onClick={onSelect}
      className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-colors ${itemClass}`}
    >
      {children}
      {isActive ? (
        <span className="absolute -left-4 top-1/2 -translate-y-1/2 w-[5px] h-[5px] rounded-full bg-sidebar-primary" />
      ) : null}
    </button>
  );
}
