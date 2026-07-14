// The rail's one button primitive — an icon-only circle when the rail rests,
// a full labelled row once it expands. Shared by LeftRail's own fixed/theme
// buttons and ThemePicker's trigger, so every button in the rail looks
// identical without each caller re-deriving the same class names.

import type { ReactNode } from "react";

export const RAIL_ICON_SIZE = 19;

export function railItemClass(expanded: boolean, isActive: boolean): string {
  const mode = expanded ? "rail-item--row" : "rail-item--icon";
  const active = isActive ? " rail-item--active" : "";
  return `rail-item ${mode}${active}`;
}

type RailButtonProps = {
  icon: ReactNode;
  label: string;
  isActive: boolean;
  expanded: boolean;
  onSelect: () => void;
  // Draws the attention dot — used when a surface is waiting on the user
  // (a command-poll source pending approval).
  needsAttention?: boolean;
};

export function RailButton({
  icon,
  label,
  isActive,
  expanded,
  onSelect,
  needsAttention = false,
}: RailButtonProps) {
  const className = railItemClass(expanded, isActive);
  const showActiveDot = isActive && !expanded && !needsAttention;

  return (
    <button
      type="button"
      title={expanded ? undefined : label}
      aria-label={label}
      aria-current={isActive ? "page" : undefined}
      onClick={onSelect}
      className={className}
    >
      <span className="rail-item__glyph">{icon}</span>
      {expanded ? <span className="rail-item__label">{label}</span> : null}
      {needsAttention ? <span className="rail-unseen-dot" /> : null}
      {showActiveDot ? <span className="rail-active-dot" /> : null}
    </button>
  );
}
