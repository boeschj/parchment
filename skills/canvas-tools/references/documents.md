# Documents and export

## Long-form documents — a canvas_render layout

When the content is genuinely prose-first and deserves reading typography (a
postmortem, design writeup, research summary, or report the user reads top-to-bottom
rather than scans), compose it with `canvas_render` as a centered reading column: a
`Card` with `className: "canvas-document"` and `centered: true`, a masthead (Heading
h1 + a muted Text byline/date), a `Separator`, and a single `Markdown` body. The
`.canvas-document` class (styles.css) supplies the ~68ch column, heading rhythm, and
quiet rules.

```json
{
  "root": "doc",
  "elements": {
    "doc": {"type": "Card", "props": {"className": "canvas-document", "centered": true},
            "children": ["masthead", "sep", "body"]},
    "masthead": {"type": "Stack", "props": {"gap": "sm"}, "children": ["title", "byline"]},
    "title": {"type": "Heading", "props": {"text": "Write-through cache RFC", "level": "h1"}},
    "byline": {"type": "Text", "props": {"variant": "muted", "text": "Jordan Boesch · Draft"}},
    "sep": {"type": "Separator", "props": {}},
    "body": {"type": "Markdown", "props": {"content": "## Summary\n..."}}
  }
}
```

Fastest path: `canvas_library` `action: "load"`, `name: "document"` drops this exact
skeleton onto the canvas — re-push the returned `slotId` with your own title/byline
and markdown body. GFM tables, lists, and fenced code all render inside the body.

Choose the scanning shape (Metric rows, Chart, DataTable, DiffViewer) instead when the
reader should SEE structured evidence rather than read prose. Mixing: keep the document
pure prose and push a separate render slot for the data.

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
