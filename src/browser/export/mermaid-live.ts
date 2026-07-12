// Builds a mermaid.live "open in editor" URL — the cheap escape hatch to a full
// third-party diagram editor. mermaid.live encodes its whole editor state in the
// URL fragment as `{codec}:{data}`; the `base64` codec is URL-safe base64 of the
// JSON state (no pako/deflate dependency needed). Matches the live-editor's own
// State shape (code + stringified mermaid config + updateDiagram + rough).

const MERMAID_LIVE_EDIT_BASE = "https://mermaid.live/edit#base64:";

type MermaidLiveState = {
  code: string;
  mermaid: string;
  updateDiagram: boolean;
  rough: boolean;
};

// URL-safe base64 of a UTF-8 string, unpadded — the encoding js-base64's
// toBase64(value, true) produces, which the live editor expects.
function toUrlSafeBase64(value: string): string {
  const utf8Bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of utf8Bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildMermaidLiveUrl(source: string, theme?: string): string {
  const state: MermaidLiveState = {
    code: source,
    mermaid: JSON.stringify({ theme: theme ?? "default" }),
    updateDiagram: true,
    rough: false,
  };
  return `${MERMAID_LIVE_EDIT_BASE}${toUrlSafeBase64(JSON.stringify(state))}`;
}
