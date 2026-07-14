# shadcn component props (full)

The canvas-extension widgets (Metric, Chart, DataTable, Callout, …) are in the
canvas-spec core. This file is the exhaustive prop list for the shadcn layout,
content, and input primitives — pull it when you need a container's exact options
or you're building a form.

Props with no `?` are REQUIRED: the spec is rejected without them (an expression
counts as a value). Props not listed here do not exist — passing one is rejected,
not ignored.

## Layout & containers

`Stack` (direction? horizontal/vertical, gap? none/sm/md/lg/xl, align?, justify? —
no padding prop; use gap) · `Grid` (columns? 1–6, gap?) · `Card` (title?,
description?, maxWidth?, centered? — accepts children; no padding/subtitle prop) ·
`Separator` (orientation?) · `Tabs` (tabs: [{value,label}], defaultValue?, value? —
children map by value; emits `change`) · `Accordion` (items, type? single/multiple) ·
`Collapsible` (title, defaultOpen?) · `Dialog` / `Drawer` (title, openPath — state
path controls visibility — description?) · `Tooltip` (content, text) · `Popover`
(trigger, content) · `Carousel` (items) · `Pagination` (totalPages, page? — emits
`change`)

## Content

`Heading` (text, level? h1–h4) · `Text` (text, variant? body/caption/muted/lead/code —
code is INLINE identifiers only) · `Badge` (text, variant? default/secondary/
destructive/outline) · `Alert` (title, message?, type? info/success/warning/error —
neutral banner; prefer Callout for tonal emphasis) · `Image` (alt, src?, width?,
height?) · `Avatar` (name, src?, size?) · `Table` (columns: string[], rows:
string[][], caption? — prefer DataTable) · `Progress` (value, max?, label?) ·
`Skeleton` (width?, height?, rounded?) · `Spinner` (size?, label?)

## Inputs & actions

Every form field takes `label` + `name` and binds its value with `$bindState` —
that binding is what makes the value reach you, and what makes `checks` run.

`Button` (label, variant? primary/secondary/danger, disabled? — emits `press`) ·
`Link` (label, href — emits `press`) · `Input` (label, name, type?, placeholder?,
value?, checks?, validateOn? — emits `submit`/`focus`/`blur`, NOT `change`) ·
`Textarea` (label, name, placeholder?, rows?, value?, checks?, validateOn? — emits
nothing) · `Select` (label, name, options: string[], placeholder?, value?, checks?,
validateOn? — emits `change`) · `Checkbox` (label, name, checked?, checks?,
validateOn? — emits `change`) · `Radio` (label, name, options, value?, checks?,
validateOn? — emits `change`) · `Switch` (label, name, checked?, checks?,
validateOn? — emits `change`) · `Slider` (label?, min?, max?, step?, value? — emits
`change`) · `Toggle` (label, pressed?, variant? — emits `change`) · `ToggleGroup`
(items, type?, value? — emits `change`) · `ButtonGroup` (buttons, selected? — emits
`change`) · `DropdownMenu` (label, items, value? — emits `select`)

There is no `required` or `minLength` prop on a field — required-ness and length
are `checks` entries: `"checks": [{"type": "required", "message": "Required"},
{"type": "minLength", "args": {"min": 8}, "message": "8+ characters"}]`.
