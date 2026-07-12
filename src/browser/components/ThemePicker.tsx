// Design-theme picker — a rail button that opens a small menu of the built-in
// themes plus Default and Custom (~/.parchment/theme.css). Separate from the
// light/dark toggle beside it: this picks WHICH design system is loaded,
// light/dark still picks which ramp within it.

import { useState } from "react";
import {
  BUILT_IN_THEME_DESCRIPTIONS,
  BUILT_IN_THEME_LABELS,
  BUILT_IN_THEME_ORDER,
} from "../../shared/themes.ts";
import { ThemeChoice } from "../theme.ts";
import { CheckIcon, PaletteIcon } from "./icons.tsx";
import { RAIL_ICON_SIZE, RailButton } from "./RailButton.tsx";

type ThemePickerOption = {
  value: ThemeChoice;
  label: string;
  description: string;
};

const THEME_PICKER_OPTIONS: ThemePickerOption[] = [
  { value: ThemeChoice.Default, label: "Default", description: "The built-in look" },
  ...BUILT_IN_THEME_ORDER.map((theme) => ({
    value: theme,
    label: BUILT_IN_THEME_LABELS[theme],
    description: BUILT_IN_THEME_DESCRIPTIONS[theme],
  })),
  { value: ThemeChoice.Custom, label: "Custom", description: "~/.parchment/theme.css" },
];

type ThemePickerProps = {
  expanded: boolean;
  themeChoice: ThemeChoice;
  onSelectThemeChoice: (choice: ThemeChoice) => void;
};

export function ThemePicker({ expanded, themeChoice, onSelectThemeChoice }: ThemePickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  const activeLabel = THEME_PICKER_OPTIONS.find((option) => option.value === themeChoice)?.label ?? "Theme";

  const selectOption = (value: ThemeChoice): void => {
    onSelectThemeChoice(value);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <RailButton
        icon={<PaletteIcon width={RAIL_ICON_SIZE} height={RAIL_ICON_SIZE} />}
        label={`Theme: ${activeLabel}`}
        expanded={expanded}
        isActive={isOpen}
        onSelect={() => setIsOpen((value) => !value)}
      />

      {isOpen ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div
            className="absolute bottom-0 left-full z-20 ml-2 w-64 bg-popover text-popover-foreground p-2 shadow-lg"
            style={{ borderRadius: "var(--radius-md)" }}
          >
            <div className="label px-2 py-1.5">Theme</div>
            <div className="flex flex-col">
              {THEME_PICKER_OPTIONS.map((option) => (
                <ThemeOptionRow
                  key={option.value}
                  option={option}
                  isActive={option.value === themeChoice}
                  onSelect={() => selectOption(option.value)}
                />
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ThemeOptionRow({
  option,
  isActive,
  onSelect,
}: {
  option: ThemePickerOption;
  isActive: boolean;
  onSelect: () => void;
}) {
  const highlightClass = isActive ? "bg-primary/10 ring-1 ring-inset ring-primary/30" : "hover:bg-accent";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex items-center gap-2.5 px-2 py-2 text-left transition-colors ${highlightClass}`}
      style={{ borderRadius: "var(--radius-sm)" }}
    >
      <span className="min-w-0 flex-1 flex flex-col">
        <span className="text-[12.5px] text-foreground">{option.label}</span>
        <span className="text-[11px] text-muted-foreground font-mono truncate">{option.description}</span>
      </span>
      {isActive ? <CheckIcon width={14} height={14} className="text-primary shrink-0" /> : null}
    </button>
  );
}
