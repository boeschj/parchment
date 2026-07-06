# Generative UI research — landscape, ground truth, and positioning

Compiled 2026-07-05 during the genui-turnaround work. Sources inline.

## Why a JSON catalog (and not freeform HTML) — the evidence

- Users strongly prefer generated UI over prose: Stanford SALT measured **84% vs
  12%** against chat (arXiv:2508.19227); Google Research measured **82.8%** over
  markdown, ELO 1736 vs 1438 (arXiv:2604.09577).
- Freeform UI codegen is unreliable by construction: Apple UICoder found ~1 in 5
  generations fails to compile even on frontier models (arXiv:2406.07739);
  Google's own paper reports 29–60% error rates on smaller models. Validity must
  come from the system — typed catalog + validation + repair.
- The industry converged on the same answer: Vercel retreated from streamUI
  ("model streams components") to client-mapped data (ai-sdk.dev migration
  guide); Google shipped A2UI (flat JSON adjacency lists + client-owned
  catalogs); Airbnb's Ghost Platform called the strongly-typed shared schema
  "the key decision" that made server-driven UI scale.
- Raw-HTML loop economics: format overhead for HTML+CSS+JS is +400–800% over
  plain text; a 50 KB self-contained page ≈ 15k output tokens ≈ ~$0.21 and
  ~5.5 minutes of streaming per regeneration. Iteration on a spec with a stable
  slotId costs a fraction and cannot drift stylistically.
- Honest caveat (Skybridge, json-render examples): a FULL 36-component shadcn
  catalog prompt costs about as many tokens as writing raw HTML. The token win
  comes from curation, `state`-referenced data, and patch-style iteration — not
  from JSON per se. thesys/OpenUI benchmarks json-render by name (52.8% fewer
  tokens for their DSL): if token pressure matters later, json-render's YAML
  wire format claims ~30% savings.

## Competitive positioning

| Alternative | Their strength | Our position |
|---|---|---|
| Claude Code Artifacts | Zero-setup org sharing, hosted versions | Anthropic's own framing: "a capture of work." We are the live working surface with a backchannel; export-to-Artifact is a pipeline, not a rival. Artifacts need claude.ai login (no API-key/Bedrock/ZDR users). |
| Raw HTML file | Unlimited expressiveness, zero deps | Same one-shot magic, ~5–10× cheaper per iteration, alive instead of dead-on-write. Keep an eject-to-HTML hatch for the fidelity ceiling. |
| thesys / OpenUI Cloud | Polished hosted GenUI API, dual-payload actions | Free, local, in the agent you already pay for; coding-agent catalog (diff/plan/mermaid/terminal) they don't have. |
| MCP Apps (SEP-1865) / OpenAI Apps SDK | Open standard, every chat host | Claude Code CLI does not render MCP Apps (anthropics/claude-code#48132). The terminal is a vacuum we fill; also they're one-server-one-iframe silos — we compose across servers on one surface. Long-term hedge: host the ext-apps bridge inside the canvas. |
| A2UI / AG-UI | Protocol gravity (Google/CopilotKit) | We are the coding-agent vertical of the pattern A2UI standardized. Steal: data-model updates decoupled from tree, catalog-embedded instructions, sendDataModel echo. |
| v0 | Graduating prototypes to real code | Complementary: canvas answers in seconds for free; hand off to codegen to productionize. |

## Threats

1. Anthropic ships MCP Apps rendering or a live artifact backchannel in the CLI.
2. vercel-labs ships their own Claude Code host on json-render (they already have
   `examples/mcp` and `examples/harness-chat`).
3. Output tokens get cheap/fast enough that raw HTML economics stop hurting.
4. Catalog fidelity ceiling pushes users back to freeform HTML.

Hedges: session-native depth (transcript/plan/trace explorer), ext-apps
compatibility path, eject-to-HTML, published token benchmarks, catalog growth.

## Patterns adopted from the field (implemented in genui-turnaround)

- **harness-chat catalog vocabulary** (json-render's official Claude Code
  example): Metric, Steps, CodeBlock, Terminal, FileChange, TestResults,
  Callout, Markdown — the coding-agent component set.
- **Scira-style skill prompting**: scoring rubric, prose→component transform
  rules, named layout patterns, failure-driven hard negatives.
- **v0 AutoFix pattern**: autoFixSpec → validateSpec → per-component prop check →
  reject with actionable issue list (instead of silently rendering garbage).
- **Board-snapshot pattern generalized**: canvas_snapshot renders any slot to
  PNG through the connected tab so the model can SEE and iterate on its output.
- **thesys dual-payload actions, simplified**: `canvas.submit` delivers resolved
  `{$state}` payloads into the next turn as `<canvas-edit kind="form-submit">`.

## Deliberately deferred

- JSONL/SpecStream streaming (MCP tool calls are atomic; revisit with a
  begin/patch/end tool family or MCP Apps transport).
- Daemon as its own MCP client for direct server stitching (auth duplication;
  the submit → Claude → MCP tool → re-render loop covers the use case honestly).
- Model-calling hooks to auto-decide rendering (cost/latency; skills + tool
  descriptions carry the judgment instead).
- YAML wire format, `canvas_data` (data-only updates), ext-apps host role,
  eject-to-HTML tool, embedded json-render devtools.
