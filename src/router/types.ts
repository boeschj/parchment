export const RouteStage = {
  Prompt: "prompt",
  Tool: "tool",
  Response: "response",
} as const;

export type RouteStage = (typeof RouteStage)[keyof typeof RouteStage];

// `transcript` deliberately means "do not create another visual surface".
// The terminal transcript remains the cheapest and least disruptive renderer
// for short answers and ordinary implementation work.
export const VisualRoute = {
  Transcript: "transcript",
  Markdown: "markdown",
  Mermaid: "mermaid",
  File: "file",
  McpApp: "mcp-app",
  Component: "component",
  Html: "html",
  WebPreview: "web-preview",
} as const;

export type VisualRoute = (typeof VisualRoute)[keyof typeof VisualRoute];

export const RouteStrategy = {
  None: "none",
  Reuse: "reuse",
  Mount: "mount",
  Compose: "compose",
  Generate: "generate",
  Preview: "preview",
} as const;

export type RouteStrategy = (typeof RouteStrategy)[keyof typeof RouteStrategy];

export const RoutePreset = {
  Article: "article",
  Brief: "brief",
  Comparison: "comparison",
  Dashboard: "dashboard",
  Deck: "deck",
  Explainer: "explainer",
  Form: "form",
  Timeline: "timeline",
} as const;

export type RoutePreset = (typeof RoutePreset)[keyof typeof RoutePreset];

export type RouteInput = {
  stage: RouteStage;
  userPrompt?: string;
  assistantResponse?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
};

export type RouteEvidence = {
  signal: string;
  detail: string;
  weight: number;
};

export type RouteCandidate = {
  route: VisualRoute;
  score: number;
  evidence: RouteEvidence[];
  strategy?: RouteStrategy;
  preset?: RoutePreset;
  viewer?: string;
};

export type RouteDecision = {
  route: VisualRoute;
  strategy: RouteStrategy;
  shouldPresent: boolean;
  confidence: number;
  reason: string;
  evidence: RouteEvidence[];
  alternatives: RouteCandidate[];
  preset?: RoutePreset;
  viewer?: string;
};
