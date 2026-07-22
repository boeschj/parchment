# Deterministic visual routing

Parchment chooses the lowest-authored-token representation that preserves the
affordances the user actually asked for. It does not turn response length into
UI, and it does not ask another model to classify the request.

## Route contract

| Route | Use when | Strategy |
|---|---|---|
| `transcript` | Ordinary answers and implementation work | `none` |
| `markdown` | Persistent, document-shaped narrative | `reuse` |
| `mermaid` | Graph topology is the required affordance | `reuse` |
| `file` | Exact/native artifact or existing source | `generate` for a new artifact; `reuse` for an existing file |
| `mcp-app` | A successful tool returns server-owned UI | `mount` |
| `component` | Standard controls or cross-source composition | `compose` |
| `html` | Bespoke motion, art direction, or slides | `generate` |
| `web-preview` | A running app/URL or existing HTML rendered as a page | `preview` |

The decision includes a confidence, strongest reason, complete evidence list,
runner-up routes, optional layout preset/viewer, and a concrete authoring
instruction. That makes misroutes inspectable instead of hiding them behind a
single label.

## Precedence

1. Explicit restraint and ordinary repository implementation work stay in the
   transcript. Format words inside code tasks are not presentation requests.
2. Exact/native deliverables stay files. A requested new file is `generate`;
   an existing file is `reuse`.
3. Successful MCP App metadata mounts the server-owned UI, unless the user asks
   for one cross-source agent-owned composition. Failed tool results never mount.
4. Existing Markdown, Mermaid, HTML, files, and running apps are reused rather
   than translated into a more expensive representation.
5. Explicit document, graph, standard-control, bespoke-HTML, and preview intent
   select the corresponding surface.
6. Cognitive-complexity scoring is a fallback for genuinely mixed information
   structures. Length alone is not a routing signal.
7. A promised, unavailable, or merely asserted surface is not an artifact.
   Response-stage future tense remains in the transcript until a tool or the
   response supplies observable material.
8. A name/count-only request suppresses rich source payloads returned by tools.
9. With no positive rich-representation signal, the transcript wins.

Negation and metalinguistic references are scoped separately. “Explain the
word Mermaid” is conversation; “draw a Mermaid sequence diagram” is a diagram.
“Show the exact HTML source; do not render it” is a file; “render this existing
HTML exactly as it looks” is a web preview.

## Runtime stages

The pure router accepts the same contract at three points:

- `prompt`: decide before generation and inject one authoring instruction.
- `tool`: reuse a file, local URL, or successful MCP App returned at runtime.
- `response`: identify already-authored Markdown/Mermaid/HTML without a second
  generation pass.

Run it directly with JSON on stdin:

```bash
printf '%s' '{"stage":"prompt","userPrompt":"Compare the options in a sortable decision dashboard."}' \
  | bun run src/router/cli.ts
```

Use `--compact` for one-line JSON.

Evaluate a frozen JSONL manifest whose rows are `{id, expected, input}`:

```bash
bun run src/router/evaluate.ts routing-evals/round22-stop-8.jsonl
```

The evaluator prints route transitions and mismatch IDs/reasons, and exits
nonzero on a literal disagreement. It never calls a model.

## Claude Code hooks and audit trail

`hooks/route.sh` invokes the router independently of daemon self-healing:

- `UserPromptSubmit` records the prompt decision and injects high-confidence
  routing context.
- `PostToolUse` records every tool decision and can upgrade the route when a
  tool reveals an MCP App, file, or running URL.
- `Stop` writes an outcome without emitting context, because Stop context would
  force another model call.

Traces live at:

```text
~/.parchment/sessions/<session>/routes/
  active.json
  turn-<timestamp>-<random>/
    decision.json
    tools/<tool-use-id>.json
    outcome.json
```

[Claude Code's hook payload](https://code.claude.com/docs/en/hooks) has a
session id but no prompt/turn id. Each `UserPromptSubmit` therefore creates an
atomic active-turn pointer; subsequent tool and Stop events resolve through it.
This prevents a visual tool from one turn contaminating the fulfillment audit
for a later transcript-only turn.

The Stop audit compares fulfillment against the latest successful non-Parchment
tool upgrade, not blindly against the initial prompt. Tool observations are
sorted by their recorded timestamps. Generated native files and routes without
an observable Parchment creation tool are marked `unverified`, never fabricated
as passes.

## Verification boundary

The router is deliberately deterministic and cheap, so it remains a policy
classifier rather than pretending to understand arbitrary language perfectly.
Every discovered boundary becomes a regression case. The current stopping test
combines the local unit corpus with fresh evaluators that lock expected routes
before invoking the CLI.

The local corpus currently contains 218 regression tests, including every
genuine failure found in the agent-authored loop. Holdout expectations were
fixed before the router ran. First-pass scores are retained below rather than
replaced by post-fix reruns:

| Frozen suite | Untouched first pass | Locked rerun | Adjudication |
|---|---:|---:|---|
| Acceptance round 9 | 39/64 | 63/64 literal | 64/64 policy |
| Generalization round 10 | 51/80 | 79/80 literal | 80/80 policy |
| Lifecycle round 11 | 32/64 | 59/64 literal | 64/64 policy |
| Cold balanced round 12 | 53/64 | 64/64 | All 11 disagreements were genuine |
| Negative stress round 12 | 24/32 | 32/32 | All 8 disagreements were genuine |
| Unseen round 13 | 12/16 | 16/16 | All 4 disagreements were genuine |
| Boundary rounds 14A/14B | 13/16 | 16/16 | All 3 disagreements were genuine |
| Boundary rounds 15A/15B | 13/16 | 16/16 | All 3 disagreements were genuine |
| Boundary rounds 16A/16B | 14/16 | 16/16 | Both disagreements were genuine |
| Boundary rounds 17A/17B | 11/16 | 16/16 | All 5 disagreements were genuine |
| Boundary rounds 18A/18B | 11/16 | 16/16 | All 5 disagreements were genuine |
| Unseen round 19 | 14/16 | 16/16 | Both disagreements were genuine |
| Unseen round 20 | 13/16 | 16/16 | All 3 disagreements were genuine |
| Unseen round 21 | 7/8 | 8/8 | The one disagreement was genuine |
| **Untouched stopping round 22** | **8/8** | **unchanged** | **Clean first pass; one case per route** |

“Policy” is not a euphemism for accepting an error. An independent adjudicator
rejected labels that requested an MCP App/component/preview from response-only
prose with no observable artifact, or treated an ordinary `Implement…` request
as presentation work. Those cases remain transcript by contract. Round 12's 19
disagreements were independently judged genuine and all became regressions.

All retained frozen manifests from rounds 12 through 22 rerun at 240/240. The
stopping manifest was hashed before evaluation as
`da918611e401f33d2d80f1bcb2dae64f3fa18c40398e54fa5b15891d3858d082`.
That is evidence of the exercised policy boundaries, not a claim that eight
final examples constitute statistical proof for arbitrary language.

The classifier invokes no model and consumes no classification tokens. The
latest local benchmark used three 250,000-decision rounds over all eight route
families. The median was 8.614 microseconds per decision (about 116,087
decisions/second). This is in-process timing on one machine, not hook
cold-start latency or a compatibility promise.

Routing is not the same as end-to-end rendering or a head-to-head token-savings
benchmark. This proof covers representation selection and zero-token
classification. Generated native files, `html`, and `web-preview` still need
concrete observable host tools before fulfillment can be automatically proved;
the audit reports that gap instead of claiming success.
