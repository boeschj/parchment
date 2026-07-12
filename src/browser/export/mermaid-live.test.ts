import { describe, it, expect } from "bun:test";
import { buildMermaidLiveUrl } from "./mermaid-live.ts";

function decodeFragment(url: string): { code: string; mermaid: string } {
  const data = url.split("#base64:")[1]!;
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  const json = new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)));
  return JSON.parse(json);
}

describe("buildMermaidLiveUrl", () => {
  it("produces a mermaid.live edit URL with a base64 fragment", () => {
    const url = buildMermaidLiveUrl("graph TD; A-->B");
    expect(url.startsWith("https://mermaid.live/edit#base64:")).toBe(true);
  });

  it("round-trips the diagram source and theme through the fragment", () => {
    const source = "sequenceDiagram\n  A->>B: hi";
    const decoded = decodeFragment(buildMermaidLiveUrl(source, "dark"));
    expect(decoded.code).toBe(source);
    expect(JSON.parse(decoded.mermaid)).toEqual({ theme: "dark" });
  });

  it("uses a URL-safe alphabet with no padding", () => {
    const url = buildMermaidLiveUrl("graph LR; longer --> content --> here?!<>&");
    const fragment = url.split("#base64:")[1]!;
    expect(fragment).not.toContain("+");
    expect(fragment).not.toContain("/");
    expect(fragment).not.toContain("=");
  });

  it("defaults the theme when none is given", () => {
    const decoded = decodeFragment(buildMermaidLiveUrl("graph TD; A-->B"));
    expect(JSON.parse(decoded.mermaid)).toEqual({ theme: "default" });
  });
});
