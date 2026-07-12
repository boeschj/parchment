# Documents and export

## canvas_document — article-grade long-form

Use when the content is genuinely prose-first and deserves reading typography: a
postmortem, design writeup, research summary, or report the user will read
top-to-bottom rather than scan. It renders a centered ~68ch reading column with a
masthead (title, optional byline/date), heading rhythm, and styled code/blockquotes.

Inputs: `title` (required), `body` (CommonMark markdown, required), `byline?`,
`date?`, `slotId?` (reuse to refine), plus the usual slot `title?`.

Choose `canvas_render` instead when the reader should SCAN structured evidence —
metrics, charts, tables, diffs. A document is for reading; a render is for seeing.
Mixing: keep the document pure prose and push a separate render slot for the data.

## The Export menu (browser-side, tell the user it exists)

Every slot's chrome has an Export menu:

- **Download HTML** — one self-contained .html (inline CSS, real chart/mermaid SVG,
  full untruncated tables, no external requests). The right answer to "can I share
  this?" — the file works offline, in email, or on any static host.
- **Print / Save as PDF** — opens a clean print view (white page, page-break-aware)
  and the print dialog. Use for "give me a PDF".
- **Copy as React** — a self-contained .tsx of the slot's spec for devs who want the
  UI as code.

MermaidEditor additionally offers PNG export and "Open in Mermaid Live" (round-trips
the source) from its own toolbar.

When a user asks to keep, send, publish, or archive what's on the canvas, point them
at the Export menu rather than screenshotting — screenshots clip data; exports don't.
