# clawd-canvas — Whole-Product Market Research

Compiled 2026-07-05. Scope: the SIX surfaces (genUI canvas, transcript, board, trace/session explorer, cost, security) and the whole-product positioning question. GenUI competitive field (Artifacts/thesys/MCP-Apps/A2UI/json-render) was covered in `docs/genui-research.md` and is NOT re-done here except where it bears on positioning.

Data sources: GitHub API (stars/issues/releases, direct repo lookups = reliable), firecrawl_search, HN Algolia API, Anthropic official docs. Reddit bodies are blocked to crawlers; Reddit quotes below are verbatim thread titles + verbatim search-snippet excerpts with URLs. Some star counts from GitHub *search* were implausibly inflated in this environment and were discarded — only direct-repo-lookup numbers are used.

---

## TL;DR

- The loud, paying-attention demand in the Claude Code community is **observability** (cost, trace, security, multi-session sprawl) — NOT generative UI. GenUI preference is real but latent/"show-don't-tell."
- The "visual workspace / editors" lane clawd-canvas's canvas+board+plan+diff occupy is **already owned by Nimbalyst** (ex-Crystal): free, MIT, cross-platform desktop+iOS, multi-harness, team multiplayer, extension marketplace, "trusted by thousands" logo wall. Competing head-on there is a losing fight.
- **White space:** nobody offers a polished local **subagent trace/replay graph** or a local **security/audit facts** layer. Cost is table-stakes but brutally saturated (ccusage 16.9k★) + first-party risk.
- **Recommended primary bet:** reposition from "a canvas" to **"the local mission control / session-observability + safety cockpit for Claude Code,"** wedge on **trace-graph + security** (highest differentiation, lowest competition), keep cost as a companion not a headline, and demote the genUI canvas to the *rendering engine* that makes the observability legible rather than the product itself.
- **Multi-harness (Codex/OpenCode) support is now table stakes** — overwhelming evidence. Architect the JSONL parser harness-agnostic as a fast-follow.

---

## A. Category Landscape — local companion / mission-control UIs for coding agents

Surface legend mapping to our six: **G**=genUI canvas · **T**=transcript · **B**=board/draw · **X**=trace/subagent graph · **$**=cost · **S**=security.

| Tool | Stars | Last activity | License / money | Surfaces (our 6) + what it really is | Top requests (from GitHub issues, verbatim) |
|---|---|---|---|---|---|
| **davila7/claude-code-templates** (aitmpl) | **28.5k★** | commits 2026-07-06 (hot); rel v1.28.3 2025-11 | MIT, free | mostly config/marketplace + a monitoring/analytics dashboard → **$**(partial), T(partial) | config/plugin mgmt focus |
| **BloopAI/vibe-kanban** | **27.3k★** | push 2026-04-24 (rel v0.1.44, ~2.5mo quiet) | Apache-2.0, Bloop AI (YC, ex-code-search); free, team/cloud implied | kanban orchestration + **T** + diff review; NOT G/B/X/$/S | #1697 "Add self-hosted Gitlab support" (25r); #765 "Configurable automatic cleanup of worktrees" (19r); #2509 "Beta UI feedback: please keep the Kanban board" (15r, redesign backlash); #1708 "Add Kiro CLI integration"; #2162 "Add goose coding agent" |
| **slopus/happy** | **22.4k★** | commit 2026-07-03 (hot); 846 open issues | MIT; hosted encrypted relay (monetization vector) | mobile/web remote client + **T** + multi-session; NOT G/B/X/$/S | #265 "OpenCode Support" (**52r**); #149 "Allow use of Claude Code v2.0.0" (27r); #1213 "Support pi coding harness" (22r); #248 "Cursor Agent CLI Support"; #1313 "Support Google Antigravity (agy) CLI" |
| **winfunc/opcode** (ex-getAsterisk/claudia) | **22.1k★** | **commit 2025-10-13 — DEAD ~9mo** | AGPL-3.0 | GUI: sessions/agents + usage dashboard + checkpoints + **T** + **$**(partial); NOT G/B/X/S | #105 "Plan mode" (**50r**); #163 "Remote Claude Code session support via SSH" (33r); #66 "Support CLI agents other than Claude Code" (17r); #332 "add the compiled Windows version" (17r); #94/#269 node-shebang crash (unfixed — abandonment) |
| **ccusage/ccusage** (ryoppippi) | **16.9k★** | commit 2026-07-05 (hot); rel v20.0.14 | NOASSERTION, free, npx | **$** only — the CLI cost-tracking default | #1300 "add `today`/`this-week` shortcut commands"; #1245 "Cache responses" |
| **siteboon/claudecodeui** (CloudCLI) | **12.4k★** | rel v1.36.0 2026-07-03 (hot) | AGPL-3.0; cloudcli.ai hosted | remote web/mobile UI + **T** + sessions; multi-CLI (CC/OpenCode/Cursor/Codex) | #187 "Remote Project Support via SSH (Willing to Contribute)" |
| **stravu/crystal → Nimbalyst** | 3.1k★ (repo) | crystal push 2026-02-26; Nimbalyst active | MIT, free; **Nimbalyst Teams = waitlist (paid tier vector)** | **THE whole-product rival:** G(visual editors) + **T**(agent window) + **B**(Excalidraw) + plan/diff/mermaid/datamodel/mockup/csv + session kanban + tasks + multiplayer. NO X/$/S | #26 "Support for Claude code running on remote machines"; #89 "Server Mode w/ Remote Access & Mobile UI"; #178 "Allow running without --dangerously-ignore-permissions" |
| **disler/claude-code-hooks-multi-agent-observability** | 1.5k★ | push 2026-02-08 (~5mo) | free | **X**(hooks-event viz) + $(partial) — closest to our trace surface, but crude | (hooks-based real-time event stream) |
| **chiphuyen/sniffly** | 1.2k★ | **push 2025-08-08 — stale ~11mo** | free | **$** + T(error analysis) + shareable dashboard | #17 "adding agents usage"; #19 "discrepancy between sniffly and cmonitor" (accuracy) |
| **Owloops/claude-powerline** | 1.1k★ | commit 2026-07-05 (hot); rel v1.27.0 | MIT, free | **$** in statusline (vim powerline) | (7 open issues, low) |
| **Iamshankhadeep/ccseva** | 0.8k★ | push 2026-06-15; rel v1.3.0 2025-07 | MIT, free | **$** menu-bar app | #23 "CCSeva falsely shows 100% Usage" (accuracy); #27 "Incorrect usage percentage" |
| **Conductor** (conductor.build, YC S24, Charlie Holtz) | Mac app (closed) | active | **Free — "we use your existing Claude Code login"** | multi-session parallel orchestration + **T** + diff/PR + Linear. NO G/B/X/$/S | (Mac-only, no public issues) |

**2026 newcomers found (the observability wave — see §B):** Sculptor (Imbue; Docker-sandbox safety play, Show HN), ObservAgent, Claudedash, Time Machine (fork+replay), Centrality (codebase-op viz), Ledger (menu-bar cost), Agx (agent kanban), cc-switch (multi-harness switcher, farion1231), Claude Trace (VS Code ext: "cost dashboard, multi-session cockpit, agent workflow builder"), nexu-io/open-design (visual design workspace).

**Structural reads:**
- **opcode is dead** (22k★ frozen since Oct 2025, unfixed crash bugs, rename churn getAsterisk→winfunc). Abandonment is a real risk in this category — a cautionary tale, and its 50r "Plan mode" / 17r "support other CLIs" backlog is now unserved demand.
- **Nimbalyst covers the most of our surfaces (3: G/T/B)** and is the only true whole-product rival to the "visual workspace" framing. It has **no** trace/cost/security.
- **Cost surface is a red ocean:** ccusage, ccseva, powerline, sniffly, opcode, Ledger, torii, Maxim, SigNoz, Honeycomb, Jellyfish all address it.
- **Nobody credibly owns trace-graph or local security-audit** — the two clearest gaps.

---

## B. Demand signals per surface (verbatim + links)

### Trace / subagent graph / replay (surface X) — STRONGEST latent demand, whole HN wave
1. "Show HN: ObservAgent – Observability for Claude Code (cost, tools, subagents)" — pitch: *"Why did it cost $4? Which tool took 10 seconds? When did the subagent silently fail?"* — https://news.ycombinator.com/item?id=47391414
2. "Show HN: Claudedash – real-time local dashboard for Claude Code agents" — *"Zero visibility into what's running, what's stuck, and how close to context overflow each session is."* — https://news.ycombinator.com/item?id=47119339
3. "Ask HN: How are you monitoring AI agents in production?" (AgentShield) — *"No visibility into what the agent did step-by-step, surprise LLM bills from untracked token usage."* — https://news.ycombinator.com/item?id=47301395
4. "Show HN: Time Machine – Debug AI Agents by Forking and Replaying from Any Step" — *"Teams burning $100+ per day on re-runs is normal… fork from step N and replay downstream"* (native Claude Code session capture) — https://news.ycombinator.com/item?id=47315394
5. "Built a local observability dashboard for Claude Code (live cost, tools, subagents)" — https://www.reddit.com/r/VibeCodeDevs/comments/1rpswfx/built_a_local_observability_dashboard_for_claude/
6. Tessl: *"Claude Code hid detailed file-level activity"* → a new open-source visibility tool emerged (Anthropic REDUCED visibility, opening a void) — https://tessl.io/blog/claude-code-hid-file-access-data-a-new-open-source-observability-tool-emerged/
7. "Show HN: Centrality – Visualize how Claude Code operates on your codebase" (per-agent cost rollups, visual attribution) — https://news.ycombinator.com/item?id=47788715

### Cost (surface $) — OVERWHELMING demand, but every competitor is here
8. "I accidentally burned ~$6,000 of Claude usage overnight with one [command]" — *"Every Claude API call sends your entire conversation history… Turn 46 sends [huge context]."* — https://www.reddit.com/r/ClaudeAI/comments/1t11mmy/i_accidentally_burned_6000_of_claude_usage/
9. "Spent $3k on Claude Code last month. Am I the only one?" — https://www.reddit.com/r/ClaudeCode/comments/1reh0fm/spent_3k_on_claude_code_last_month_am_i_the_only/
10. "$100 is the new $20? Token burn rate has skyrocketed since the [update]" — https://www.reddit.com/r/ClaudeCode/comments/1qz31g5/100_is_the_new_20_token_burn_rate_has_skyrocketed/
11. "Claude Suddenly Eating Up Your Usage?… consumed a whopping 60+% of my usage instantly on a 5x max plan doing a fairly routine [task]" — https://www.reddit.com/r/ClaudeCode/comments/1s2kdl9/claude_suddenly_eating_up_your_usage_here_is_what/
12. "Ledger: Cost MenuBar for Claude Code" — *"Native cost observability in Claude Code is lackluster"*; P99 runaway-session detection, per-PR costs, planning-vs-coding token split — https://news.ycombinator.com/item?id=48151035

### Security (surface S) — strong anxiety, almost NO tooling
13. "My agent stole my (api) keys." — *"My Claude has no access to any .env files… Yet, during a casual conversation, he pulled out my API keys like it was nothing."* — https://www.reddit.com/r/ClaudeAI/comments/1r186gl/my_agent_stole_my_api_keys/
14. "Audited my Claude Code permissions. The gaps were more [alarming than expected]" — *"the line has to be… at a hard programmatic boundary like pre-tool hooks that validate arguments."* — https://www.reddit.com/r/ClaudeCode/comments/1tgiekx/audited_my_claude_code_permissions_the_gaps_were/
15. "[Security] Claude Code reads .env files by default" — *"A simple consent prompt — 'Claude Code wants to access .env files' —"* — https://www.reddit.com/r/ClaudeAI/comments/1lgudw2/security_claude_code_reads_env_files_by_default/
16. "An active attack is planting backdoors inside Claude Code right now" — *"the malware abuses a legitimate Anthropic feature (the hooks API in ~/.claude)"* — https://www.reddit.com/r/ClaudeAI/comments/1u05t5e/an_active_attack_is_planting_backdoors_inside/
17. "Am I overthinking Claude Code security…?" — *"There is zero governance around agent coding harnesses, [the] skills they [use]."* — https://www.reddit.com/r/cybersecurity/comments/1tfksxd/am_i_overthinking_claude_code_security_or_is_this/
18. Sculptor (Imbue) Show HN — value prop is safety: *"safely and locally execute untrusted LLM code in an agentic loop, using a containerized environment you control"*; lets *"claude code 'go rogue' safely inside a container."* — https://news.ycombinator.com/item?id=45427697

### Multi-session sprawl (cross-cutting, feeds trace + transcript)
19. "I got tired of managing 15 terminal tabs for my Claude sessions, so I [built this]" — https://www.reddit.com/r/ClaudeCode/comments/1pxyn37/i_got_tired_of_managing_15_terminal_tabs_for_my/
20. "Mental burnout from too many parallel Claude Code sessions?" — https://www.reddit.com/r/ClaudeCode/comments/1r6y7od/mental_burnout_from_too_many_parallel_claude_code/
21. "I tried running multiple git worktrees in parallel which works, but got [overwhelmed] trying to manage each." — https://www.reddit.com/r/ClaudeAI/comments/1lwmwsc/i_tried_running_multiple_git_worktrees_in/
22. "I kept losing track of my Claude sessions, so I built this" — https://www.reddit.com/r/ClaudeCode/comments/1sgrxwz/i_kept_losing_track_of_my_claude_sessions_so_i/

### Transcript read/share (surface T) — modest demand, table stakes
23. "How do you share your Claude code conversations?" — https://www.reddit.com/r/ClaudeCode/comments/1t73gjm/how_do_you_share_your_claude_code_conversations/
24. "How do you handle context loss between Claude sessions?" — *"Use the /export command to save the chat transcript…"* — https://www.reddit.com/r/ClaudeCode/comments/1qn5tfc/how_do_you_handle_context_loss_between_claude/

### Multi-harness demand (feeds pivot §D3) — very strong
25. happy #265 "OpenCode Support" (**52 reactions**) — https://github.com/slopus/happy/issues/265
26. opcode #66 "Support CLI agents other than Claude Code" (17r) — https://github.com/winfunc/opcode/issues/66
27. vibe-kanban tagline: *"Get 10X more out of Claude Code, Codex or any coding agent."* — plus #1708 Kiro, #2162 goose. Nearly every 2026 tool (cc-switch, claude-mem, ruflo, ECC, open-design, Nimbalyst) now advertises Claude Code + Codex + OpenCode + Cursor + Gemini + Hermes + OpenClaw support.

Board/Excalidraw (surface B): no meaningful organic demand thread found; Nimbalyst bundles it as one editor among ten. Treat as supporting, not a driver.

---

## C. Monetization & market

**Do people pay for coding-agent observability today?**
- **API/agent-SDK observability IS a paid category** — Langfuse (OSS + paid cloud), LangSmith (paid), Braintrust, Helicone, Arize/Phoenix, Laminar, W&B Weave. They monetize seats/volume on API traces. Langfuse ships an official **Claude Agent SDK** integration (https://langfuse.com/integrations/frameworks/claude-agent-sdk); LangChain published coding-agent spend governance *"Your coding agent bill doubled. Here's how to fix it"* covering Claude Code/Cursor/Copilot (https://www.langchain.com/blog/fix-your-coding-agent-bill). **But these target the API/SDK path and teams/enterprise, not the local Claude Code CLI power user.**
- **Enterprise CC monitoring via OTel IS monetized** — SigNoz, Honeycomb, Jellyfish, Datadog, torii, Maxim all sell dashboards on Claude Code's OTel export (https://www.toriihq.com/articles/five-claude-code-usage-dashboards-and-monitoring-tools). Money is at the org/governance layer.
- **The local CLI-tool space is almost entirely FREE/OSS.** Conductor: *"It's free—we use your existing Claude Code login."* Nimbalyst: *"completely free for individual users with no feature limits or trial period"* (MIT). ccusage/happy/opcode/vibe-kanban/sniffly all free. Nascent monetization = **Team/cloud tiers** (Nimbalyst Teams waitlist; happy hosted encrypted relay; Bloop cloud implied). No individual is paying for a local cockpit today.

**Anthropic first-party risk per surface** (ground truth from https://code.claude.com/docs/en/monitoring-usage):
- **Cost ($): HIGH.** Native `/cost` + `/usage` commands; OTel metric `claude_code.cost.usage` with attributes `model / skill.name / plugin.name / agent.name / mcp_server.name / effort`. **BUT** *"Cost metrics are approximations. For official billing data, refer to your API provider"* — and **there is NO native visual dashboard** ("all visualization is external"). Anthropic plumbs data, ships no local viz.
- **Trace (X): MEDIUM.** OTel events (`api_request`, `tool_result`, `tool_decision`, `mcp_server_connection`, `skill_activated`…), distributed **traces in beta** behind `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`, and a crude `--verbose-agents` / `--stream-logs` (per SitePoint, June-2026, treat as semi-reliable). No local subagent-graph UI. The data exists; the *visual layer is unbuilt by Anthropic*.
- **Security (S): MEDIUM.** OTel events are *"the audit data source… every event carries identity attributes that tie tool calls, MCP activity, and permission decisions back to the user."* Ships permissions/deny-rules; scoped sub-agent permissions + sandboxing efforts reported. But this is enterprise/OTel-only; **no local audit-facts UI**.
- **GenUI (G): HIGH.** Artifacts, MCP Apps rendering risk, possible live-artifact backchannel in CLI (see genui-research threats).
- **Transcript (T): HIGH.** It's literally terminal output + `/export`. Anthropic owns it.
- **Board (B): LOW.** Anthropic unlikely to ship a collaborative whiteboard in the CLI.
- **Desktop-app trajectory — FLAG:** third-party pieces claim a "Claude Code Desktop Redesign: Parallel Agents (2026)" (https://www.eigent.ai/blog/claude-code-desktop-redesign). If Anthropic ships a first-party parallel-agent desktop GUI, it threatens ALL of Conductor/Nimbalyst/vibe-kanban/this product. Unverified — worth monitoring.

**Where the money/white space is:** individuals won't pay for a local cockpit; **teams/orgs pay for governance rollups** (cost attribution, security audit, per-dev spend). Monetization path = stay free/OSS local, monetize a **Team observability + security governance** tier later — but that pits you against LangSmith/SigNoz/Jellyfish at the org layer, so it's a hedge, not the wedge.

**White-space summary (uncontested):**
1. Polished **subagent trace / fork-replay graph** (disler & ObservAgent are crude hooks dashboards; nobody has the git-graph animated replay).
2. **Local security/audit facts** layer (Sculptor sandboxes but doesn't *audit*; URLhaus/permission-denial/sensitive-file/flagged-command local audit is unserved).
3. **Accurate** cost (ccusage estimates; ccseva has open "falsely shows 100%" accuracy bugs; calibrated-to-the-cent is a genuine edge — but crowded).
4. **Multi-harness observability** (every observability tool is Claude-Code-only; none unify Codex + Claude Code traces).

---

## D. Synthesis

### D1. Opportunity map (1-5; higher = more attractive on each axis, i.e. differentiation is "our upside," first-party-risk is inverted so higher = SAFER shown separately)

| Surface | Demand | Competition density | First-party risk | Differentiation potential | One-line justification |
|---|---|---|---|---|---|
| **Trace / subagent graph (X)** | **5** | 4 | 3 | **5** | Whole HN wave (ObservAgent/Claudedash/Time Machine/Centrality) + "what did my agent do" + Anthropic hid file activity; rivals are crude hooks dashboards → our typed-JSONL git-graph replay is genuinely novel. **Best bet.** |
| **Security center (S)** | 4 | **2** | 3 | **4** | Loud anxiety ("stole my keys", .env reads, hooks backdoors, "zero governance") but almost no local tooling — Sculptor sandboxes, doesn't audit. Facts-not-scores audit is unserved. **Sleeper wedge.** |
| **Cost dashboard ($)** | **5** | **5** | **4** | 3 | Demand is overwhelming but ccusage(16.9k★)+ccseva+powerline+sniffly+Ledger+enterprise-OTel own it, and Anthropic ships `/cost`+cost.usage. Table stakes, not a wedge. Differentiate only on accuracy-to-the-cent + context explorer. |
| **GenUI canvas (G)** | 3 | 3 | **4** | 4 | Strong preference data (Stanford 84%, Google 82.8%) but latent, not organically demanded in CC community; Artifacts/MCP-Apps/thesys/Nimbalyst editors contest it; high Anthropic risk. Differentiated (json-render contract + roundtrip forms) but not the thing users ask for. |
| **Transcript (T)** | 3 | **4** | **4** | 2 | Every tool ships a transcript view (table stakes); `/export` exists; Anthropic owns it. Necessary, not differentiating. |
| **Board / Excalidraw (B)** | 2 | 2 | 2 | 3 | No organic demand thread; Nimbalyst bundles it as 1 of 10 editors. Supporting surface, not a driver. |

### D2. Positioning: "a canvas" or "the local mission control for Claude Code"?

**The data says: mission control, decisively.** Three arguments:
1. **Demand asymmetry.** The verbatim, upvoted, tool-spawning demand is observability (cost/trace/security/multi-session), not "render me a nicer UI." Users aren't asking for a canvas; they're asking *"what did my agent do, why did it cost $4, did it touch my .env, which of my 15 sessions is stuck?"*
2. **The canvas lane is already lost to Nimbalyst.** Nimbalyst is a free, MIT, cross-platform + iOS, multiplayer, multi-harness "visual workspace" with markdown/mockup/Excalidraw/mermaid/diff/datamodel/code editors + session kanban + extension marketplace + enterprise logo wall. clawd-canvas's canvas+board+plan+diff is a strict subset of that. You cannot win "best visual editor for Claude Code" — they've planted the flag and are executing.
3. **The observability lane is Nimbalyst-, Conductor-, and vibe-kanban-free.** None of the whole-product rivals have cost, trace, or security. clawd-canvas's actual unique asset is the **typed JSONL parser + calibrated-to-the-cent cost + animated subagent graph + safety facts, all local-first read-only over `~/.claude`** — that is a *mission-control / observability* product, and it is uncontested at the polished-local-GUI tier.

Positioning statement: **"clawd-canvas is the local mission control for Claude Code — see what every agent did, what it cost, and what it touched — with a generative canvas that renders the answer."** The canvas becomes the *how* (the render layer), not the *what*.

### D3. Pivot analysis — one primary bet

Options weighed against evidence:
- **(a) Double-down on genUI canvas** — REJECT. Latent demand, high Anthropic risk, and Nimbalyst owns the visual-workspace superset. Fighting on their turf.
- **(b) Rebalance toward observability (trace/cost/security)** — STRONGEST. Matches loudest demand, lands in competitor white space, exploits the one asset (typed session parser) rivals lack.
- **(c) Go multi-agent-tool (Codex/OpenClaw/OpenCode)** — YES, but as a *fast-follow dimension*, not the bet itself. Demand is overwhelming (happy #265 52r; every 2026 tool is multi-harness; single-tool lock-in is now a *disadvantage*). Do it after the wedge lands, by generalizing the JSONL parser.
- **(d) Unbundle one surface as the wedge** — YES, and this is how to execute (b): lead with the sharpest single surface rather than shipping six half-surfaces.

**PRIMARY BET:** Rebalance to observability and **wedge on the subagent trace-graph + security-audit pairing** — the two surfaces with the highest differentiation and lowest competition. Concretely:
- **Lead surface = Trace/session explorer with the animated subagent git-graph + fork/replay** ("what did my agent do"). It is the single most demanded, least-well-served capability, and the typed-JSONL parser is a moat rivals (hooks-based) can't easily copy.
- **Companion wedge = Security facts** (flagged commands, `.env`/sensitive-file access, permission denials, domain/URLhaus checks) — near-zero competition, high anxiety, cheap to differentiate ("facts, never scores").
- **Cost = table-stakes companion, NOT the headline.** Ship it (accuracy-to-the-cent beats ccusage's estimates and ccseva's bugs) but don't try to out-market ccusage; let it ride alongside the trace graph where it's contextual (per-turn, per-subagent, per-session cost on the graph).
- **GenUI canvas = demoted to the rendering engine.** It's *how* the trace/cost/security views are drawn and stay interactive — the differentiator that makes clawd-canvas's cockpit prettier and more legible than disler/ObservAgent, not a standalone product.
- **Transcript + board = supporting surfaces**, kept because they're cheap and expected, not marketed as reasons-to-adopt.
- **Fast-follow = harness-agnostic parser** (Codex/OpenCode session formats) once the wedge lands.

Reasoning in one line: *go where the demand is loud, the competitors are absent, and you already have the hard-to-copy asset — that is local subagent observability + safety, rendered on the canvas you've already built.*

### D4. Top 8 shippable feature requests across the market

| # | Feature | Surface | Effort | Evidence |
|---|---|---|---|---|
| 1 | **Subagent trace + fork/replay graph** ("what did my agent do", replay from step N) | X | **L** | HN Time Machine 47315394; ObservAgent 47391414 |
| 2 | **Runaway-session / cost-spike live alerts** (P99 detection, per-agent budget caps) | $ | M | Reddit $6k-overnight 1t11mmy; Ledger HN 48151035 |
| 3 | **Permission/access audit review** (flagged shell cmds, `.env`/secret reads, denials) | S | M | Reddit 1tgiekx (audit); 1lgudw2 (.env); 1r186gl (keys) |
| 4 | **Multi-session cockpit / overview** (stop juggling 15 terminals; status per session) | X/T | **L** | Reddit 1pxyn37 (15 tabs); 1lwmwsc (worktrees overwhelmed) |
| 5 | **Per-session context-overflow health meter** (how close to compaction) | X | **S** | Claudedash HN 47119339 |
| 6 | **Transcript share/export as a link** (send a session to a teammate) | T | **S** | Reddit 1t73gjm; 1qn5tfc (/export workflow) |
| 7 | **Multi-harness session parsing** (Codex / OpenCode / Cursor CLI) | all/parser | **L** | happy #265 (52r); opcode #66; cc-switch/ecosystem |
| 8 | **Per-PR / per-task cost attribution** (chargeback-grade) | $ | M | Ledger HN 48151035; Anthropic `--attribution`/cost.usage attrs |

### D5. Chart-ready JSON

```json
// competitors — stars are direct-repo-lookup (reliable); surfaces map to [G,T,B,X,$,S]
[
  {"competitor":"claude-code-templates","stars":28467,"surfaces_covered":["$","T"],"last_activity":"2026-07-06","status":"hot","money":"free/MIT","multi_harness":true},
  {"competitor":"vibe-kanban","stars":27278,"surfaces_covered":["T"],"last_activity":"2026-04-24","status":"quiet-2.5mo","money":"free/Apache, YC Bloop","multi_harness":true},
  {"competitor":"happy","stars":22431,"surfaces_covered":["T"],"last_activity":"2026-07-03","status":"hot","money":"free/MIT, hosted relay","multi_harness":true},
  {"competitor":"opcode","stars":22146,"surfaces_covered":["T","$"],"last_activity":"2025-10-13","status":"DEAD-9mo","money":"free/AGPL","multi_harness":false},
  {"competitor":"ccusage","stars":16877,"surfaces_covered":["$"],"last_activity":"2026-07-05","status":"hot","money":"free","multi_harness":false},
  {"competitor":"claudecodeui-CloudCLI","stars":12396,"surfaces_covered":["T"],"last_activity":"2026-07-03","status":"hot","money":"free/AGPL, hosted","multi_harness":true},
  {"competitor":"crystal-Nimbalyst","stars":3097,"surfaces_covered":["G","T","B"],"last_activity":"2026-02-26","status":"active","money":"free/MIT, Teams waitlist","multi_harness":true},
  {"competitor":"disler-observability","stars":1478,"surfaces_covered":["X"],"last_activity":"2026-02-08","status":"stale-5mo","money":"free","multi_harness":false},
  {"competitor":"sniffly","stars":1243,"surfaces_covered":["$","T"],"last_activity":"2025-08-08","status":"stale-11mo","money":"free","multi_harness":false},
  {"competitor":"claude-powerline","stars":1129,"surfaces_covered":["$"],"last_activity":"2026-07-05","status":"hot","money":"free/MIT","multi_harness":false},
  {"competitor":"ccseva","stars":797,"surfaces_covered":["$"],"last_activity":"2026-06-15","status":"active","money":"free/MIT","multi_harness":false},
  {"competitor":"Conductor","stars":null,"surfaces_covered":["T"],"last_activity":"2026","status":"active-closed","money":"free, YC S24","multi_harness":true},
  {"competitor":"clawd-canvas (us)","stars":null,"surfaces_covered":["G","T","B","X","$","S"],"last_activity":"2026-07","status":"active","money":"free/MIT local","multi_harness":false}
]
```

```json
// surface opportunity scores (1-5). first_party_risk: higher = MORE risk (worse).
[
  {"surface":"trace_subagent_graph","demand_score":5,"competition":4,"first_party_risk":3,"differentiation":5},
  {"surface":"security_center","demand_score":4,"competition":2,"first_party_risk":3,"differentiation":4},
  {"surface":"cost_dashboard","demand_score":5,"competition":5,"first_party_risk":4,"differentiation":3},
  {"surface":"genui_canvas","demand_score":3,"competition":3,"first_party_risk":4,"differentiation":4},
  {"surface":"transcript","demand_score":3,"competition":4,"first_party_risk":4,"differentiation":2},
  {"surface":"board_excalidraw","demand_score":2,"competition":2,"first_party_risk":2,"differentiation":3}
]
```

```json
// surface coverage count across competitors — shows white space
[
  {"surface":"cost","competitors_covering":7,"note":"red ocean: ccusage/ccseva/powerline/sniffly/opcode/templates/Ledger + enterprise OTel"},
  {"surface":"transcript","competitors_covering":8,"note":"table stakes, everyone has it"},
  {"surface":"genui_canvas","competitors_covering":2,"note":"Nimbalyst editors, open-design; contested by Artifacts/thesys/MCP-Apps"},
  {"surface":"board","competitors_covering":1,"note":"only Nimbalyst (Excalidraw as 1 of 10 editors)"},
  {"surface":"trace_subagent_graph","competitors_covering":1,"note":"only disler (crude hooks); HN newcomers pre-traction — WHITE SPACE"},
  {"surface":"security_center","competitors_covering":0,"note":"nobody audits locally; Sculptor sandboxes only — WHITE SPACE"}
]
```

```json
// multi-harness demand (GitHub issue reactions) — support is now table stakes
[
  {"request":"OpenCode support (happy #265)","reactions":52},
  {"request":"Claude Code v2 support (happy #149)","reactions":27},
  {"request":"pi harness (happy #1213)","reactions":22},
  {"request":"support non-Claude CLIs (opcode #66)","reactions":17},
  {"request":"Kiro CLI (vibe-kanban #1708)","reactions":11},
  {"request":"goose agent (vibe-kanban #2162)","reactions":11}
]
```

```json
// Anthropic first-party coverage (ground truth: code.claude.com/docs/en/monitoring-usage)
{
  "native_metrics": 8,
  "native_events": "20+",
  "cost_usage_attributes": ["model","skill.name","plugin.name","agent.name","mcp_server.name","effort","speed"],
  "native_visual_dashboard": false,
  "cli_commands": ["/cost","/usage"],
  "traces": "beta behind CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1",
  "cost_accuracy": "approximations; official billing = API provider",
  "audit_story": "OTel events are the audit data source; enterprise/OTel-only, no local UI",
  "implication": "Anthropic plumbs DATA, ships NO local visual layer — that gap is our wedge"
}
```

### D6. Competitor screenshots (direct image URLs for a visual report)

Nimbalyst product editor shots (the key rival — shows the whole-product surface overlap):
- Markdown editor + agent sidebar: `https://nimbalyst.com/_astro/editor-markdown.BURaoex0_2kRtAw.webp`
- Excalidraw editor: `https://nimbalyst.com/_astro/editor-excalidraw.Du9E3PWw_9q1Wj.webp`
- Mermaid editor: `https://nimbalyst.com/_astro/editor-mermaid.C7gOBHK6_1uAOgc.webp`
- Code/diff editor: `https://nimbalyst.com/_astro/editor-code-typescript.CK9RcqQR_Z1edqmC.webp`
- Data-model / ERD editor: `https://nimbalyst.com/_astro/editor-datamodel.BKvDe2D-_Zqbydh.webp`
- Session kanban: `https://nimbalyst.com/_astro/feature-session-kanban.CPa-_1cP_Z1PEj87.webp`
- Agent window (transcript): `https://nimbalyst.com/_astro/ai-session-history.BGRqWm8x_7dE6N.webp`
- File-edits sidebar: `https://nimbalyst.com/_astro/ai-agent-transcript-crop-files-sidebar.CEFkzl09_ZUv8dC.webp`
- Multiplayer doc: `https://nimbalyst.com/_astro/collab-real-multiplayer-doc.laS9hl03_Zq3ooq.webp`
- OG hero: `https://nimbalyst.com/og-image.png`

Other competitors:
- ccusage logo: `https://cdn.jsdelivr.net/gh/ryoppippi/ccusage@main/docs/public/logo.png`
- CloudCLI (claudecodeui) OG: `https://cdn.sanity.io/images/s150envk/production/0dcef7522508c0162b22f1ee2ddf5391cca4b5e9-1200x630.png`
- aitmpl (claude-code-templates) logo: `https://www.aitmpl.com/logo.png`
- GitHub repo preview cards (guaranteed to render): `https://opengraph.githubassets.com/1/BloopAI/vibe-kanban` · `.../1/winfunc/opcode` · `.../1/slopus/happy` · `.../1/chiphuyen/sniffly` · `.../1/disler/claude-code-hooks-multi-agent-observability` · `.../1/Iamshankhadeep/ccseva`

---

## Caveats
- Reddit crawler-blocked → quotes are verbatim titles + verbatim search-snippet excerpts, not full comment bodies. Links are canonical.
- SitePoint "June 2026 features" (--attribution, scoped sub-agent permissions, --verbose-agents, --stream-logs, checkpointing) reads partly AI-generated with invented config schemas — treat as directional, not authoritative. The Anthropic `monitoring-usage` docs are the reliable first-party ground truth.
- GitHub *search-API* star counts were implausibly inflated in this environment and were discarded; all competitor stars above are direct-repo-lookup values.
- "Claude Code Desktop Redesign (2026)" first-party desktop-app signal is third-party/unverified — monitor.
