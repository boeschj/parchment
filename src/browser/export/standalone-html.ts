// Pure assembly of a single self-contained .html file from a rendered slot's
// serialized DOM + the stylesheets that style it. No fetch, no external assets:
// every byte the file needs is inlined, so it opens the same on any machine,
// offline, forever. Two modes — "screen" for a shareable document, "print" for
// a clean Save-as-PDF surface (white page, page-break-avoid, charts to width).

export const ExportMode = {
  Screen: "screen",
  Print: "print",
} as const;

export type ExportMode = (typeof ExportMode)[keyof typeof ExportMode];

export type StandaloneHtmlInput = {
  title: string;
  bodyHtml: string;
  css: string;
  generatedAtIso: string;
  mode: ExportMode;
};

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

// Layout chrome for the exported document itself: a centered reading column on
// the app's own page background, matching the ~960px capture width so charts
// and tables sit at their rendered size.
const EXPORT_LAYOUT_CSS = `
.parchment-export-main {
  max-width: 992px;
  margin: 0 auto;
  padding: 40px 24px 8px;
}
.parchment-export-main > * + * { margin-top: 20px; }
.parchment-export-footer {
  max-width: 992px;
  margin: 0 auto;
  padding: 24px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted-foreground, #6E6E70);
}
`;

// Print surface: force a white page regardless of the captured theme, keep
// cards/tables/figures from splitting across page boundaries, and let charts
// (fixed-width recharts SVG) scale down to the printable width.
const PRINT_CSS = `
@media print {
  @page { margin: 16mm 14mm; }
  html, body { background: #ffffff !important; }
  .parchment-export-footer { display: none; }
  .parchment-export-main { max-width: none; padding: 0; }
  .bg-card, table, pre, figure, .parchment-export-block { break-inside: avoid; page-break-inside: avoid; }
  h1, h2, h3 { break-after: avoid; page-break-after: avoid; }
  svg { max-width: 100% !important; height: auto !important; }
}
`;

function modeCss(mode: ExportMode): string {
  if (mode === ExportMode.Print) return PRINT_CSS;
  return "";
}

// Print mode auto-opens the browser print dialog once the document (and its
// inlined fonts) have painted, so "Save as PDF" is one action away.
function autoPrintScript(mode: ExportMode): string {
  if (mode !== ExportMode.Print) return "";
  return `<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},250);});</script>`;
}

export function buildStandaloneHtmlDocument(input: StandaloneHtmlInput): string {
  const layoutStyles = `${EXPORT_LAYOUT_CSS}${modeCss(input.mode)}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="generator" content="parchment" />
<title>${escapeHtml(input.title)}</title>
<style>${input.css}</style>
<style>${layoutStyles}</style>
</head>
<body class="bg-background text-foreground">
<main class="parchment-export-main">
${input.bodyHtml}
</main>
<footer class="parchment-export-footer">Exported from parchment · ${escapeHtml(input.generatedAtIso)}</footer>
${autoPrintScript(input.mode)}
</body>
</html>`;
}

// A filesystem-safe filename stem from a slot title, e.g. "API latency" →
// "api-latency". Empty/odd titles fall back to a stable default.
export function exportFilenameStem(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "parchment-export";
}
