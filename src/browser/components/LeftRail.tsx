// Left icon rail. The resting state is a 72px column: the fixed surfaces up
// top, then a hairline, a mono "canvas" caption, and the artifacts — newest
// first, each carrying a per-kind icon and colour tint. Hovering a resting
// artifact floats a title/age flyout to its right; once the stack overflows,
// the rail collapses to the newest few behind a "+N" pill that expands the
// whole rail into a scrollable, labelled panel.

import { useRef, useState, type ReactNode } from "react";
import type { Slot } from "../../shared/types.ts";
import { Theme } from "../theme.ts";
import { Surface, type CanvasView } from "../view.ts";
import {
  ChevronsLeftIcon,
  DocIcon,
  MoonIcon,
  SlotKindIcon,
  SunIcon,
  TranscriptIcon,
} from "./icons.tsx";
import "./left-rail.css";

const HOVER_FLYOUT_DELAY_MS = 250;
const FLYOUT_GAP_PX = 12;
const FLYOUT_ESTIMATED_HEIGHT_PX = 58;
const VIEWPORT_MARGIN_PX = 12;

// At or below the threshold every artifact rests in the rail; above it the rail
// shows the newest few plus a pill that expands the section.
const ARTIFACT_OVERFLOW_THRESHOLD = 6;
const ARTIFACT_COLLAPSED_COUNT = 5;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const ICON_SIZE = 19;

type FixedItem = { surface: Surface; label: string; icon: ReactNode };

const SURFACE_ITEMS: FixedItem[] = [
  { surface: Surface.Transcript, label: "Transcript", icon: <TranscriptIcon width={ICON_SIZE} height={ICON_SIZE} /> },
  { surface: Surface.Plan, label: "Plan", icon: <DocIcon width={ICON_SIZE} height={ICON_SIZE} /> },
];

type FlyoutTarget = { slotId: string; top: number; left: number };

type LeftRailProps = {
  slots: Slot[];
  view: CanvasView;
  onSelectView: (view: CanvasView) => void;
  hasPlan: boolean;
  theme: Theme;
  onToggleTheme: () => void;
  newestSeenUpdatedAt: number;
};

export function LeftRail({
  slots,
  view,
  onSelectView,
  hasPlan,
  theme,
  onToggleTheme,
  newestSeenUpdatedAt,
}: LeftRailProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [flyout, setFlyout] = useState<FlyoutTarget | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const themeIcon = theme === Theme.Dark ? <SunIcon width={ICON_SIZE} height={ICON_SIZE} /> : <MoonIcon width={ICON_SIZE} height={ICON_SIZE} />;
  const themeLabel = theme === Theme.Dark ? "Switch to light mode" : "Switch to dark mode";

  const surfaceItems = SURFACE_ITEMS.filter((item) => hasPlan || item.surface !== Surface.Plan);
  const artifacts = sortArtifactsByNewest(slots);
  const hasOverflow = artifacts.length > ARTIFACT_OVERFLOW_THRESHOLD;
  const showAll = isExpanded && hasOverflow;
  const overflowCount = artifacts.length - ARTIFACT_COLLAPSED_COUNT;
  const restingArtifacts = hasOverflow ? artifacts.slice(0, ARTIFACT_COLLAPSED_COUNT) : artifacts;
  const visibleArtifacts = showAll ? artifacts : restingArtifacts;
  const activeSlotId = view.type === "slot" ? view.slotId : null;

  const openFlyout = (slotId: string, button: HTMLButtonElement): void => {
    clearHoverTimer(hoverTimerRef.current);
    const rect = button.getBoundingClientRect();
    hoverTimerRef.current = setTimeout(() => {
      setFlyout({ slotId, ...flyoutPosition(rect) });
    }, HOVER_FLYOUT_DELAY_MS);
  };

  const closeFlyout = (): void => {
    clearHoverTimer(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setFlyout(null);
  };

  const flyoutSlot = flyout ? artifacts.find((slot) => slot.id === flyout.slotId) ?? null : null;

  return (
    <nav className={showAll ? "rail rail--expanded" : "rail"} aria-label="Canvas navigation">
      <div className="rail-group">
        {surfaceItems.map((item) => (
          <RailButton
            key={item.surface}
            icon={item.icon}
            label={item.label}
            expanded={showAll}
            isActive={view.type === "surface" && view.surface === item.surface}
            onSelect={() => onSelectView({ type: "surface", surface: item.surface })}
          />
        ))}
      </div>

      {artifacts.length > 0 ? (
        <>
          <div className="rail-hairline" />
          <ArtifactsHeader
            expanded={showAll}
            canCollapse={hasOverflow}
            onCollapse={() => setIsExpanded(false)}
          />
          <div className={showAll ? "rail-artifacts rail-artifacts--expanded rail-scroll" : "rail-artifacts"}>
            {visibleArtifacts.map((slot) => (
              <ArtifactItem
                key={slot.id}
                slot={slot}
                expanded={showAll}
                isActive={slot.id === activeSlotId}
                isUnseen={slot.updatedAt > newestSeenUpdatedAt && slot.id !== activeSlotId}
                onSelect={() => onSelectView({ type: "slot", slotId: slot.id })}
                onHoverStart={showAll ? undefined : openFlyout}
                onHoverEnd={showAll ? undefined : closeFlyout}
              />
            ))}
            {hasOverflow && !showAll ? (
              <OverflowPill count={overflowCount} onExpand={() => setIsExpanded(true)} />
            ) : null}
          </div>
        </>
      ) : null}

      {showAll ? null : <div className="rail-spacer" />}

      <RailButton
        icon={themeIcon}
        label={themeLabel}
        expanded={showAll}
        isActive={false}
        onSelect={onToggleTheme}
      />

      {flyout && flyoutSlot ? <Flyout slot={flyoutSlot} top={flyout.top} left={flyout.left} /> : null}
    </nav>
  );
}

type RailButtonProps = {
  icon: ReactNode;
  label: string;
  isActive: boolean;
  expanded: boolean;
  onSelect: () => void;
};

function RailButton({ icon, label, isActive, expanded, onSelect }: RailButtonProps) {
  const className = railItemClass(expanded, isActive);

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
      {isActive && !expanded ? <span className="rail-active-dot" /> : null}
    </button>
  );
}

type ArtifactItemProps = {
  slot: Slot;
  isActive: boolean;
  isUnseen: boolean;
  expanded: boolean;
  onSelect: () => void;
  onHoverStart?: ((slotId: string, button: HTMLButtonElement) => void) | undefined;
  onHoverEnd?: (() => void) | undefined;
};

function ArtifactItem({
  slot,
  isActive,
  isUnseen,
  expanded,
  onSelect,
  onHoverStart,
  onHoverEnd,
}: ArtifactItemProps) {
  const className = `${railItemClass(expanded, isActive)} rail-artifact`;

  const handleHoverStart = (event: { currentTarget: HTMLButtonElement }): void => {
    onHoverStart?.(slot.id, event.currentTarget);
  };

  return (
    <button
      type="button"
      data-kind={slot.kind}
      aria-label={slot.title}
      aria-current={isActive ? "page" : undefined}
      onClick={onSelect}
      onMouseEnter={handleHoverStart}
      onMouseLeave={onHoverEnd}
      onFocus={handleHoverStart}
      onBlur={onHoverEnd}
      className={className}
    >
      <span className="rail-artifact__accent" />
      <span className="rail-item__glyph rail-artifact__glyph">
        <SlotKindIcon kind={slot.kind} width={ICON_SIZE} height={ICON_SIZE} />
      </span>
      {expanded ? <span className="rail-item__label">{slot.title}</span> : null}
      {isUnseen ? <span className="rail-unseen-dot" /> : null}
      {isActive && !expanded ? <span className="rail-active-dot" /> : null}
    </button>
  );
}

function ArtifactsHeader({
  expanded,
  canCollapse,
  onCollapse,
}: {
  expanded: boolean;
  canCollapse: boolean;
  onCollapse: () => void;
}) {
  if (!expanded) {
    return (
      <div className="rail-artifacts-header rail-artifacts-header--collapsed">
        <span className="rail-caption">canvas</span>
      </div>
    );
  }

  return (
    <div className="rail-artifacts-header rail-artifacts-header--expanded">
      <span className="rail-caption">canvas</span>
      {canCollapse ? (
        <button type="button" className="rail-collapse" aria-label="Collapse artifact list" onClick={onCollapse}>
          <ChevronsLeftIcon width={16} height={16} />
        </button>
      ) : null}
    </div>
  );
}

function OverflowPill({ count, onExpand }: { count: number; onExpand: () => void }) {
  return (
    <button
      type="button"
      className="rail-item rail-item--icon rail-overflow"
      aria-label={`Show ${count} more artifact${count === 1 ? "" : "s"}`}
      onClick={onExpand}
    >
      <span className="rail-overflow__count">+{count}</span>
    </button>
  );
}

function Flyout({ slot, top, left }: { slot: Slot; top: number; left: number }) {
  const meta = `${slot.kind} · ${formatRelativeAge(slot.updatedAt)}`;

  return (
    <div className="rail-flyout" style={{ top, left }} role="tooltip">
      <span className="rail-flyout__title">{slot.title}</span>
      <span className="rail-flyout__meta">{meta}</span>
    </div>
  );
}

// --- helpers ---------------------------------------------------------------

function railItemClass(expanded: boolean, isActive: boolean): string {
  const mode = expanded ? "rail-item--row" : "rail-item--icon";
  const active = isActive ? " rail-item--active" : "";
  return `rail-item ${mode}${active}`;
}

function sortArtifactsByNewest(slots: Slot[]): Slot[] {
  return [...slots].sort((a, b) => b.updatedAt - a.updatedAt);
}

function flyoutPosition(rect: DOMRect): { top: number; left: number } {
  const left = rect.right + FLYOUT_GAP_PX;
  const centeredTop = rect.top + rect.height / 2 - FLYOUT_ESTIMATED_HEIGHT_PX / 2;
  const lowestTop = window.innerHeight - FLYOUT_ESTIMATED_HEIGHT_PX - VIEWPORT_MARGIN_PX;
  const top = Math.max(VIEWPORT_MARGIN_PX, Math.min(centeredTop, lowestTop));
  return { top, left };
}

function clearHoverTimer(timer: ReturnType<typeof setTimeout> | null): void {
  if (timer) clearTimeout(timer);
}

function formatRelativeAge(timestamp: number): string {
  const elapsed = Date.now() - timestamp;
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  return `${Math.floor(elapsed / DAY_MS)}d ago`;
}
