// The built-in theme catalog. Both the daemon (to validate a requested
// /themes/<name>.css file) and the browser (to render the theme picker and
// build the stylesheet href) read this list, so it is defined once here
// rather than duplicated per side.

export const BuiltInTheme = {
  Manuscript: "manuscript",
  Terminal: "terminal",
  Slate: "slate",
} as const;

export type BuiltInTheme = (typeof BuiltInTheme)[keyof typeof BuiltInTheme];

export const BUILT_IN_THEME_ORDER = [
  BuiltInTheme.Manuscript,
  BuiltInTheme.Terminal,
  BuiltInTheme.Slate,
] as const;

export const BUILT_IN_THEME_LABELS: Record<BuiltInTheme, string> = {
  [BuiltInTheme.Manuscript]: "Manuscript",
  [BuiltInTheme.Terminal]: "Terminal",
  [BuiltInTheme.Slate]: "Slate",
};

export const BUILT_IN_THEME_DESCRIPTIONS: Record<BuiltInTheme, string> = {
  [BuiltInTheme.Manuscript]: "Warm paper, editorial serif accents",
  [BuiltInTheme.Terminal]: "High-contrast phosphor green",
  [BuiltInTheme.Slate]: "Cool, minimal dev-tool gray",
};

export function isBuiltInTheme(value: string): value is BuiltInTheme {
  return (Object.values(BuiltInTheme) as string[]).includes(value);
}
