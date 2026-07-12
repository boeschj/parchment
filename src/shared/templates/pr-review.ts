import { SlotKind } from "../types.ts";
import { MetricTone } from "../catalog/extensions/Metric.ts";
import { CalloutTone } from "../catalog/extensions/Callout.ts";
import { FileChangeKind } from "../catalog/extensions/FileChange.ts";
import { DiffEditableSide } from "../catalog/extensions/DiffViewer.ts";
import type { StarterTemplate } from "./types.ts";

// "PR review" — the walkthrough shape for reviewing a real change: what &
// why up top, the size/risk numbers, per-file summaries, the architecture
// delta, the one diff that matters, test results, then a verdict.
export const prReviewTemplate: StarterTemplate = {
  name: "pr-review",
  title: "PR review",
  kind: SlotKind.Report,
  spec: {
    root: "page",
    elements: {
      page: {
        type: "Stack",
        props: { gap: "lg" },
        children: ["title", "summary", "kpis", "files-card", "arch-diagram", "diff", "tests", "verdict"],
      },
      title: {
        type: "Heading",
        props: { text: "PR #482 — read-through cache for the pricing API", level: "h1" },
        children: [],
      },
      summary: {
        type: "Callout",
        props: {
          tone: CalloutTone.Info,
          title: "What & why",
          body: "Adds a Redis-backed read-through cache in front of the pricing lookup. p99 is 640ms under load today; this change is projected to bring it under 150ms without touching the pricing logic itself.",
        },
        children: [],
      },
      kpis: {
        type: "Grid",
        props: { columns: 3, gap: "md" },
        children: ["m-files", "m-diff", "m-risk"],
      },
      "m-files": {
        type: "Metric",
        props: { label: "Files changed", value: "6", detail: "2 new, 4 modified" },
        children: [],
      },
      "m-diff": {
        type: "Metric",
        props: { label: "Lines changed", value: "+212 / −34", detail: "mostly new cache module + tests" },
        children: [],
      },
      "m-risk": {
        type: "Metric",
        props: { label: "Risk", value: "Low", tone: MetricTone.Success, detail: "no schema or public API changes" },
        children: [],
      },
      "files-card": {
        type: "Card",
        props: { title: "Files changed" },
        children: ["files-stack"],
      },
      "files-stack": {
        type: "Stack",
        props: { gap: "sm" },
        children: ["file-1", "file-2", "file-3"],
      },
      "file-1": {
        type: "FileChange",
        props: {
          path: "src/pricing/cache.ts",
          kind: FileChangeKind.Created,
          additions: 86,
          summary: "New Redis-backed read-through cache with a 60s TTL and jittered expiry.",
        },
        children: [],
      },
      "file-2": {
        type: "FileChange",
        props: {
          path: "src/pricing/handler.ts",
          kind: FileChangeKind.Modified,
          additions: 24,
          deletions: 18,
          summary: "Reads go through the cache; writes invalidate the affected SKU key.",
        },
        children: [],
      },
      "file-3": {
        type: "FileChange",
        props: {
          path: "src/pricing/handler.test.ts",
          kind: FileChangeKind.Modified,
          additions: 58,
          deletions: 4,
          summary: "Added cache-hit, cache-miss, and invalidation test cases.",
        },
        children: [],
      },
      "arch-diagram": {
        type: "MermaidEditor",
        props: {
          title: "Request path — before vs. after",
          showSource: false,
          source:
            'flowchart LR\n  subgraph before["Before"]\n    A1[Client] --> B1[Pricing handler]\n    B1 --> C1[(Postgres)]\n  end\n  subgraph after["After"]\n    A2[Client] --> B2[Pricing handler]\n    B2 --> D2{Cache hit?}\n    D2 -->|yes| E2[(Redis)]\n    D2 -->|no| C2[(Postgres)]\n    C2 --> E2\n  end',
        },
        children: [],
      },
      diff: {
        type: "DiffViewer",
        props: {
          file: "src/pricing/handler.ts",
          language: "typescript",
          editableSide: DiffEditableSide.None,
          before:
            "export async function getPrice(sku: string): Promise<Price> {\n  return db.prices.findOne({ sku });\n}",
          after:
            "export async function getPrice(sku: string): Promise<Price> {\n  const cached = await cache.get(priceCacheKey(sku));\n  if (cached) return cached;\n  const price = await db.prices.findOne({ sku });\n  await cache.set(priceCacheKey(sku), price, { ttlSeconds: 60 });\n  return price;\n}",
        },
        children: [],
      },
      tests: {
        type: "TestResults",
        props: { passed: 34, failed: 0, skipped: 1, durationMs: 4200 },
        children: [],
      },
      verdict: {
        type: "Callout",
        props: {
          tone: CalloutTone.Success,
          title: "Recommendation",
          body: "Ship it. Cache invalidation is covered by tests, and the fallback path (cache miss → DB) is unchanged — a Redis outage degrades to today's latency instead of failing requests.",
        },
        children: [],
      },
    },
  },
};
