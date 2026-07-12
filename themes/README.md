# Themes

The canvas's default look never changes — every theme here is opt-in. A
theme is a single CSS file that redefines a fixed set of custom properties
(color, radius, a couple of motion/type tokens); the app never hardcodes a
color, so redefining the tokens re-skins everything, including the shadcn
component catalog Claude renders into.

## What's here

| File | Look |
|---|---|
| `manuscript.css` | Warm paper, editorial serif-accented headings — the parchment name, taken literally. |
| `terminal.css` | High-contrast phosphor green, near-square corners, mono type throughout. |
| `slate.css` | Cool, minimal dev-tool gray with a crisp blue accent. |
| `custom-theme.example.css` | A starter with every override commented out — copy it and fill in your own palette. |

Each theme file fully defines **both** a light (`:root`) and a dark (`.dark`)
ramp, so it holds up whichever mode you're in.

## How to switch

**Option A — in-canvas picker (no file editing).** Click the palette icon in
the left rail, next to the light/dark toggle. Pick a built-in theme,
"Custom" (your own `~/.parchment/theme.css`), or "Default". This takes
effect **immediately, no refresh** — your choice is remembered per-browser
(`localStorage`) and re-applied the next time you open the canvas.

**Option B — drop a file.** Copy one of these files to
`~/.parchment/theme.css`:

```bash
cp themes/manuscript.css ~/.parchment/theme.css
```

Then either refresh the canvas tab, or open the picker and select "Custom"
(the daemon serves whatever is at that path live — no rebuild). If the
picker is already on "Custom" (the default state for a browser tab that's
never touched the picker) a **refresh is required** to pick up an edit to
the file's *contents*, since the browser already fetched that URL once and
won't notice the file changed underneath it. Switching *which* theme is
active via the picker, by contrast, changes the URL itself and always
applies instantly.

**Option C — write your own.** Copy `custom-theme.example.css` to
`~/.parchment/theme.css` and redefine only the tokens you care about —
anything you don't set falls back to the default. See the variable
contract below.

Delete `~/.parchment/theme.css` (or pick "Default" in the picker) to go back
to exactly the built-in look.

## The variable contract

Every token below is read from `:root` by default and can be overridden
again inside `.dark` for a separate dark-mode value. The canonical, always
up-to-date copy of this list lives in `src/browser/theme-default.css`.

```
Surfaces  --background --foreground --card --card-foreground
          --popover --popover-foreground --secondary --secondary-foreground
          --muted --muted-foreground --accent --accent-foreground
Accent    --primary --primary-foreground --destructive --success
          --ring --input --border
Charts    --chart-1 … --chart-5
Sidebar   --sidebar --sidebar-foreground --sidebar-primary
          --sidebar-primary-foreground --sidebar-accent
          --sidebar-accent-foreground --sidebar-border --sidebar-ring
Detail    --hairline --dot --user-bubble
Radius    --radius-sm-token --radius-md-token --radius-lg-token
          --radius-xl-token --radius-2xl-token --radius-3xl-token
          (+ --radius, kept equal to --radius-xl-token)
Motion    --scroll-fade
Type      --font-sans --font-mono --font-serif (optional, unset by default)
```

**Radius — override the whole scale together.** Tailwind's `rounded-xl`,
`rounded-lg`, etc. (used by nearly every button, input, and card) read the
six `-token` variables, not `--radius` alone. `--radius` itself is only read
directly by a handful of components. Setting `--radius` without the token
scale reshapes very little — see `manuscript.css` / `terminal.css` /
`slate.css` for a worked example of changing both together.

**`--font-serif` is additive.** It's unset by default, so headings
(`.h-display`, the plan editor's H1/H2) fall back to `--font-sans` exactly
as before. Set it in your theme to give headings a distinct display face —
`manuscript.css` does this with a system serif stack (no font download).
`--font-sans` and `--font-mono` themselves are also overridable — `terminal.css`
repoints `--font-sans` at the already-loaded Geist Mono for an all-mono look.

## No rebuild, ever

Both the built-in themes and your own `~/.parchment/theme.css` are read from
disk on every request — the daemon never bundles them. Editing a file and
refreshing (or re-selecting it in the picker) is always enough; there is no
`bun run build` step in this loop.
