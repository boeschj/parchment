const SESSION_PARAM = "session";

export function readSessionIdFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get(SESSION_PARAM);
  if (fromUrl && fromUrl.length > 0) return fromUrl;
  return "default";
}

export function shortSessionLabel(sessionId: string): string {
  if (sessionId === "default") return "default";
  const hexish = sessionId.replace(/[^0-9a-f]/gi, "");
  return (hexish || sessionId).slice(0, 8);
}
