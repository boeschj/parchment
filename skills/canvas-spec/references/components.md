# shadcn component props (full)

The canvas-extension widgets (Metric, Chart, DataTable, Callout, …) are in the
canvas-spec core. This file is the exhaustive prop list for the shadcn layout,
content, and input primitives — pull it when you need a container's exact options
or you're building a form.

## Layout & containers

`Stack` (direction? horizontal/vertical, gap? none/sm/md/lg/xl, align?, justify?) ·
`Grid` (columns 1–6, gap?) · `Card` (title?, description?, maxWidth?, centered? —
accepts children) · `Separator` (orientation?) · `Tabs` (tabs: [{value,label}],
defaultValue — children map by value) · `Accordion` (items, type single/multiple) ·
`Collapsible` (title) · `Dialog` / `Drawer` (title, description, openPath — state
path controls visibility) · `Tooltip` (content, text) · `Popover` (trigger, content) ·
`Carousel` (items) · `Pagination` (totalPages, page)

## Content

`Heading` (text, level h1–h4) · `Text` (text, variant? body/caption/muted/lead/code —
code is INLINE identifiers only) · `Badge` (text, variant? default/secondary/
destructive/outline) · `Alert` (title, message?, type? info/success/warning/error —
neutral banner; prefer Callout for tonal emphasis) · `Image` (src, alt, width?,
height?) · `Avatar` (src?, name, size?) · `Table` (columns: string[], rows:
string[][] — prefer DataTable) · `Progress` (value, max?, label?) · `Skeleton` ·
`Spinner` (size?, label?)

## Inputs & actions (always bind with $bindState)

`Button` (label, variant? primary/secondary/danger, disabled? — emits `press`) ·
`Link` (label, href) · `Input` (label?, type?, placeholder?, value, checks?) ·
`Textarea` (label?, rows?, value) · `Select` (label?, options: string[], value) ·
`Checkbox` (label, checked) · `Radio` (label?, options, value) · `Switch` (label,
checked) · `Slider` (label?, min, max, step?, value) · `Toggle` (label, pressed) ·
`ToggleGroup` (items, type, value) · `ButtonGroup` (buttons, selected) ·
`DropdownMenu` (label, items)
