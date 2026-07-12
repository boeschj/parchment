import { SlotKind } from "../types.ts";
import type { StarterTemplate } from "./types.ts";

// "Document" — the long-form reading shape: a centered ~68ch reading column
// (.canvas-document styling in styles.css) with a masthead (title + byline/date),
// a rule, and a markdown body. Seeded as a starter so canvas_render authors have
// a ready skeleton for essays, RFCs, postmortems, and design docs: load it, then
// re-push the same slotId with your own title/byline and body.
export const documentTemplate: StarterTemplate = {
  name: "document",
  title: "Design doc",
  kind: SlotKind.Report,
  spec: {
    root: "doc",
    elements: {
      doc: {
        type: "Card",
        props: { className: "canvas-document", centered: true },
        children: ["masthead", "doc-sep", "doc-body"],
      },
      masthead: {
        type: "Stack",
        props: { gap: "sm" },
        children: ["doc-title", "doc-byline"],
      },
      "doc-title": {
        type: "Heading",
        props: { text: "Write-through cache for the profile API", level: "h1" },
        children: [],
      },
      "doc-byline": {
        type: "Text",
        props: { variant: "muted", text: "Jordan Boesch · Draft" },
        children: [],
      },
      "doc-sep": { type: "Separator", props: {}, children: [] },
      "doc-body": {
        type: "Markdown",
        props: {
          content: [
            "## Summary",
            "",
            "Profile reads dominate API traffic and hit Postgres on every request. A",
            "write-through Redis cache cuts p99 read latency and offloads the primary.",
            "",
            "## Motivation",
            "",
            "- `GET /profile/:id` is 42% of read volume and reads the same rows repeatedly.",
            "- p99 sits at 412 ms under load; the query itself is 8 ms, the rest is queueing.",
            "",
            "## Design",
            "",
            "1. On read, look up `profile:{id}` in Redis; on miss, read Postgres and populate.",
            "2. On write, update Postgres inside the transaction, then invalidate the key.",
            "3. TTL of 10 minutes bounds staleness for keys that escape invalidation.",
            "",
            "## Open questions",
            "",
            "- Do we need per-field invalidation, or is whole-object eviction enough?",
            "- What is the acceptable staleness window for the mobile client?",
          ].join("\n"),
        },
        children: [],
      },
    },
  },
};
