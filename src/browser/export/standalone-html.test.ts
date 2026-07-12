import { describe, it, expect } from "bun:test";
import {
  ExportMode,
  buildStandaloneHtmlDocument,
  exportFilenameStem,
} from "./standalone-html.ts";

const baseInput = {
  title: "API latency",
  bodyHtml: "<div class=\"bg-card\">hello</div>",
  css: ".bg-card{background:#fff}",
  generatedAtIso: "2026-07-12T00:00:00.000Z",
  mode: ExportMode.Screen,
} as const;

describe("buildStandaloneHtmlDocument", () => {
  it("produces a self-contained document with inlined css and body", () => {
    const html = buildStandaloneHtmlDocument(baseInput);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>.bg-card{background:#fff}</style>");
    expect(html).toContain('<div class="bg-card">hello</div>');
    expect(html).toContain("<title>API latency</title>");
  });

  it("references no external resource (no http/src/link)", () => {
    const html = buildStandaloneHtmlDocument(baseInput);
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("src=");
  });

  it("escapes the title to prevent tag injection", () => {
    const html = buildStandaloneHtmlDocument({ ...baseInput, title: "<script>x</script>" });
    expect(html).toContain("<title>&lt;script&gt;x&lt;/script&gt;</title>");
    expect(html).not.toContain("<title><script>");
  });

  it("adds print CSS and an auto-print script only in print mode", () => {
    const screen = buildStandaloneHtmlDocument({ ...baseInput, mode: ExportMode.Screen });
    expect(screen).not.toContain("@media print");
    expect(screen).not.toContain("window.print()");

    const print = buildStandaloneHtmlDocument({ ...baseInput, mode: ExportMode.Print });
    expect(print).toContain("@media print");
    expect(print).toContain("background: #ffffff !important");
    expect(print).toContain("window.print()");
  });
});

describe("exportFilenameStem", () => {
  it("slugifies a title", () => {
    expect(exportFilenameStem("API latency (p99)")).toBe("api-latency-p99");
  });

  it("falls back for empty titles", () => {
    expect(exportFilenameStem("   ")).toBe("parchment-export");
    expect(exportFilenameStem("···")).toBe("parchment-export");
  });
});
