import { describe, expect, it } from "bun:test";
import { routeVisual } from "./route.ts";
import { RoutePreset, RouteStage, VisualRoute, type RouteInput } from "./types.ts";

type Case = {
  name: string;
  input: RouteInput;
  expected: (typeof VisualRoute)[keyof typeof VisualRoute];
};

const cases: Case[] = [
  {
    name: "short factual answer stays in transcript",
    input: { stage: RouteStage.Prompt, userPrompt: "What does this function return?" },
    expected: VisualRoute.Transcript,
  },
  {
    name: "ordinary coding work does not become a visual artifact",
    input: { stage: RouteStage.Prompt, userPrompt: "Fix the null handling bug in src/parser.ts and add tests." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "UI nouns inside implementation work do not become presentation intent",
    input: { stage: RouteStage.Prompt, userPrompt: "Implement the dashboard view and Mermaid export in src/admin/overview.tsx." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "implementation path does not steal an explicit app preview",
    input: { stage: RouteStage.Prompt, userPrompt: "Fix the auth bug in src/login.ts, then show me the app in a browser preview." },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "explicit visual restraint wins",
    input: { stage: RouteStage.Prompt, userPrompt: "Compare the five options, but no canvas or visual UI. Just answer here." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "negated output nouns used metalinguistically stay in transcript",
    input: { stage: RouteStage.Prompt, userPrompt: "In a review comment, explain why the variable htmlDashboardView is misleading and suggest a clearer name; do not render HTML or create a dashboard." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "quoted route labels in a short explanation stay in transcript",
    input: { stage: RouteStage.Prompt, userPrompt: "Give me a three-sentence explanation of why the quoted words ‘Markdown’, ‘Mermaid’, ‘HTML’, and ‘component’ are category labels in our style guide, not requested output formats." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "a route name's etymology stays in transcript",
    input: { stage: RouteStage.Prompt, userPrompt: "In one sentence, explain why the name Mermaid was chosen; answer here." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "failed MCP UI plus a negated URL preview stays in transcript",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "The failed checker mentions https://status.acme.invalid/embed; explain the error briefly, but do not open, render, or preview that URL.",
      toolName: "status_embed.fetch",
      toolInput: { url: "https://status.acme.invalid/embed" },
      toolResult: { isError: true, content: [{ type: "text", text: "502 Bad Gateway" }], _meta: { "openai/outputTemplate": "ui://status/embed.html" } },
    },
    expected: VisualRoute.Transcript,
  },
  {
    name: "research becomes a directly rendered document",
    input: { stage: RouteStage.Prompt, userPrompt: "Research the current local-first database landscape and give me a sourced brief." },
    expected: VisualRoute.Markdown,
  },
  {
    name: "persistent handbook uses Markdown",
    input: { stage: RouteStage.Prompt, userPrompt: "Write a standalone onboarding handbook for weekend support, with titled sections, escalation rules, examples, and a final checklist; present it as a persistent document here." },
    expected: VisualRoute.Markdown,
  },
  {
    name: "negated rich formats do not steal a reusable runbook",
    input: { stage: RouteStage.Prompt, userPrompt: "Do not make a dashboard, HTML page, or interactive widget. Produce a reusable on-call handoff runbook with headings, prerequisites, numbered recovery steps, checkboxes, and an escalation table." },
    expected: VisualRoute.Markdown,
  },
  {
    name: "durable terminology guide outranks quoted format words",
    input: { stage: RouteStage.Prompt, userPrompt: "Create a short terminology style guide explaining when writers may use the words ‘view,’ ‘Mermaid,’ ‘HTML,’ and ‘dashboard’; format it as a durable reference note." },
    expected: VisualRoute.Markdown,
  },
  {
    name: "negated dashboard does not steal a document request",
    input: { stage: RouteStage.Prompt, userPrompt: "Draft a one-page ADR for Redis versus an in-process cache: context, decision, consequences. No dashboard." },
    expected: VisualRoute.Markdown,
  },
  {
    name: "explicit Markdown beats other content hints",
    input: { stage: RouteStage.Prompt, userPrompt: "Give me a Markdown report with a Mermaid diagram inside it." },
    expected: VisualRoute.Markdown,
  },
  {
    name: "deck uses HTML runtime",
    input: { stage: RouteStage.Prompt, userPrompt: "Turn these findings into a 10-slide presentation." },
    expected: VisualRoute.Html,
  },
  {
    name: "raw HTML is honored",
    input: { stage: RouteStage.Prompt, userPrompt: "Give me this as a single-file HTML prototype." },
    expected: VisualRoute.Html,
  },
  {
    name: "explicit diagram uses Mermaid",
    input: { stage: RouteStage.Prompt, userPrompt: "Draw a sequence diagram of the OAuth callback flow." },
    expected: VisualRoute.Mermaid,
  },
  {
    name: "service topology with labeled flows uses Mermaid",
    input: { stage: RouteStage.Prompt, userPrompt: "Show the topology of how ingestion, validation, enrichment, and storage services depend on one another, with labeled data flows." },
    expected: VisualRoute.Mermaid,
  },
  {
    name: "diagram negation does not confuse a mention of Mermaid with a request",
    input: { stage: RouteStage.Prompt, userPrompt: "Explain why Mermaid rejects this node label in two sentences. Do not render a diagram." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "Mermaid implementation task is not mistaken for a diagram request",
    input: { stage: RouteStage.Prompt, userPrompt: "Implement Mermaid support in the repo renderer and add tests." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "existing CSV gets a file viewer",
    input: { stage: RouteStage.Prompt, userPrompt: "Open results/benchmark.csv and show me the data." },
    expected: VisualRoute.File,
  },
  {
    name: "exact downloadable CSV deliverable stays a file",
    input: { stage: RouteStage.Prompt, userPrompt: "Create an exact UTF-8 CSV artifact named customer_churn.csv with the supplied header and three example rows, ready to download." },
    expected: VisualRoute.File,
  },
  {
    name: "named nonstandard project artifact stays a file",
    input: { stage: RouteStage.Prompt, userPrompt: "Create a Blender project named orbital-kiosk.blend containing a low-poly kiosk, three labeled material slots, and a camera positioned for an isometric render." },
    expected: VisualRoute.File,
  },
  {
    name: "exact diagram source stays a file instead of rendering",
    input: { stage: RouteStage.Prompt, userPrompt: "Show the exact source of diagrams/auth-flow.mmd; do not render it." },
    expected: VisualRoute.File,
  },
  {
    name: "diagram file render intent beats path inspection",
    input: { stage: RouteStage.Prompt, userPrompt: "Render diagrams/auth-flow.mmd as an editable graph." },
    expected: VisualRoute.Mermaid,
  },
  {
    name: "preview intent uses the running app",
    input: { stage: RouteStage.Prompt, userPrompt: "Launch the app and show me the browser preview." },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "start existing app with live preview intent uses web preview",
    input: { stage: RouteStage.Prompt, userPrompt: "Start the existing app in ./labs/pulse-board and give me a live working preview of the current build; I need to click through it, not redesign it." },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "render existing HTML exactly as it looks uses web preview",
    input: { stage: RouteStage.Prompt, userPrompt: "Render and show the existing /tmp/exports/coverage-map.html exactly as it currently looks; do not rewrite it." },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "explicit browser rendering of existing HTML beats source display",
    input: { stage: RouteStage.Prompt, userPrompt: "Open the existing /tmp/audit-report.html and explicitly render that HTML page in a browser preview." },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "existing HTML rendered as a page uses web preview",
    input: { stage: RouteStage.Prompt, userPrompt: "Render examples/report.html as a page; I do not want its source." },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "exact HTML source with render negation stays a file",
    input: { stage: RouteStage.Prompt, userPrompt: "Show the exact source of ./public/archive.html; do not render it as a page." },
    expected: VisualRoute.File,
  },
  {
    name: "a command mentioning an HTML deck stays in transcript",
    input: { stage: RouteStage.Prompt, userPrompt: "What exact command opens the existing HTML deck in Chrome? Just give me the command." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "bespoke animated simulation uses HTML",
    input: { stage: RouteStage.Prompt, userPrompt: "Build a standalone red-black-tree simulator with draggable insertions and animated rotations." },
    expected: VisualRoute.Html,
  },
  {
    name: "bespoke scrollytelling uses HTML",
    input: { stage: RouteStage.Prompt, userPrompt: "Present a bespoke full-screen scrollytelling data story with pinned chapters, parallax annotations, and a custom ending sequence." },
    expected: VisualRoute.Html,
  },
  {
    name: "bespoke spring-physics canvas animation uses HTML",
    input: { stage: RouteStage.Prompt, userPrompt: "Build a bespoke canvas animation of fireflies gathering into the word LUMEN, dispersing on pointer movement, and reforming with spring physics." },
    expected: VisualRoute.Html,
  },
  {
    name: "cross-source view rejects native apps and uses components",
    input: { stage: RouteStage.Prompt, userPrompt: "Combine P0 issues, PR status, test failures, and burn-down into one release-readiness view. Do not open either native app." },
    expected: VisualRoute.Component,
  },
  {
    name: "dashboard uses components",
    input: { stage: RouteStage.Prompt, userPrompt: "Show me an interactive dashboard of test health, latency, and cost." },
    expected: VisualRoute.Component,
  },
  {
    name: "multiple standard UI affordances use components",
    input: { stage: RouteStage.Prompt, userPrompt: "Make a filterable inventory risk view with warehouse and category controls, sortable rows, and expandable item details; use standard UI controls." },
    expected: VisualRoute.Component,
  },
  {
    name: "negated HTML and slides do not steal a standard controls UI",
    input: { stage: RouteStage.Prompt, userPrompt: "Do not produce raw HTML or an animated slide deck; make a compact UI with a search box, two dropdown filters, sortable rows, and a reset button for exploring the policy catalog." },
    expected: VisualRoute.Component,
  },
  {
    name: "domain-qualified interactive calculator uses components",
    input: { stage: RouteStage.Prompt, userPrompt: "Build an interactive mortgage calculator with sliders and an amortization table." },
    expected: VisualRoute.Component,
  },
  {
    name: "visual branching explanation uses Mermaid",
    input: { stage: RouteStage.Prompt, userPrompt: "Why does this request pass through gateway, auth, and worker before branching to cache or database? Give me a visual explanation." },
    expected: VisualRoute.Mermaid,
  },
  {
    name: "native PDF deliverable beats generic findings language",
    input: { stage: RouteStage.Prompt, userPrompt: "Create a PDF report of these findings." },
    expected: VisualRoute.File,
  },
  {
    name: "complex decision uses components",
    input: {
      stage: RouteStage.Prompt,
      userPrompt: "Compare Kafka, NATS, and RabbitMQ across latency, cost, operational risk, and delivery guarantees, then recommend one with evidence.",
    },
    expected: VisualRoute.Component,
  },
  {
    name: "MCP App resource outranks prose",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Show my open pull requests.",
      toolName: "github.list_pull_requests",
      toolResult: { _meta: { "ui/resourceUri": "ui://github/pull-requests" }, content: [{ type: "text", text: "12 open" }] },
    },
    expected: VisualRoute.McpApp,
  },
  {
    name: "MCP App MIME is recognized",
    input: {
      stage: RouteStage.Tool,
      toolResult: { content: [{ type: "resource", resource: { uri: "widget://x", mimeType: "text/html;profile=mcp-app", text: "<html/>" } }] },
    },
    expected: VisualRoute.McpApp,
  },
  {
    name: "failed MCP App result is never mounted",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Let me choose the issue using its picker.",
      toolResult: { isError: true, content: [{ type: "resource", resource: { uri: "ui://linear/issues", mimeType: "text/html;profile=mcp-app" } }] },
    },
    expected: VisualRoute.Transcript,
  },
  {
    name: "show me the app recognizes a local preview URL",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Show me the app and click through login.",
      toolName: "dev_server",
      toolResult: { output: "Local: http://localhost:5173" },
    },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "plain HTML tool text is not assumed to be an MCP App",
    input: { stage: RouteStage.Tool, userPrompt: "Read the response.", toolResult: { mimeType: "text/html", text: "<p>Hello</p>" } },
    expected: VisualRoute.Transcript,
  },
  {
    name: "standalone Mermaid response is reused",
    input: { stage: RouteStage.Response, assistantResponse: "Here is the flow:\n\n```mermaid\ngraph TD\n A --> B\n```" },
    expected: VisualRoute.Mermaid,
  },
  {
    name: "long structured response is reused as Markdown",
    input: {
      stage: RouteStage.Response,
      assistantResponse: "# Findings\n\n## What changed\n\n- One\n- Two\n- Three\n- Four\n\n## Recommendation\n\nUse the smaller design. ".repeat(12),
    },
    expected: VisualRoute.Markdown,
  },
  {
    name: "short completed response stays in transcript",
    input: { stage: RouteStage.Response, assistantResponse: "The test fails because the fixture uses the old field name." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "format names used only as field labels stay in transcript",
    input: { stage: RouteStage.Prompt, userPrompt: "The words Markdown, Mermaid, HTML, and web preview are merely field labels. Explain them in plain prose and explicitly do not produce those formats." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "durable repository onboarding guide uses Markdown despite route vocabulary",
    input: { stage: RouteStage.Prompt, userPrompt: "Create a durable repository onboarding guide with headings and checklists, including a section explaining the terms Markdown, Mermaid, HTML, component, and web preview." },
    expected: VisualRoute.Markdown,
  },
  {
    name: "short response with multiple headings reuses Markdown",
    input: {
      stage: RouteStage.Response,
      assistantResponse: "# Queue migration\n\n## Preconditions\n\n- Drain consumers\n- Capture lag\n\n## Rollback\n\n1. Restore the old group.\n2. Resume consumers.",
    },
    expected: VisualRoute.Markdown,
  },
  {
    name: "explicit compact decision table uses Markdown",
    input: { stage: RouteStage.Prompt, userPrompt: "Compare polling, webhooks, and SSE in a compact decision table, then give a two-sentence recommendation." },
    expected: VisualRoute.Markdown,
  },
  {
    name: "state transition map uses Mermaid",
    input: { stage: RouteStage.Prompt, userPrompt: "Map the order state transitions from cart through payment, fulfillment, cancellation, and refund." },
    expected: VisualRoute.Mermaid,
  },
  {
    name: "named path requested as a file creates a file artifact",
    input: { stage: RouteStage.Prompt, userPrompt: "Create config/scheduler.json as a file with keys for timezone, concurrency, retryLimit, and queues." },
    expected: VisualRoute.File,
  },
  {
    name: "prompt-only cross-source connected view composes components",
    input: { stage: RouteStage.Prompt, userPrompt: "Compose one connected view from selected Linear MCP issues and matching Slack MCP decisions." },
    expected: VisualRoute.Component,
  },
  {
    name: "standard notification preference controls use components",
    input: { stage: RouteStage.Prompt, userPrompt: "Create a notification-preferences panel with toggles, a delivery-frequency radio group, and Save and Reset actions." },
    expected: VisualRoute.Component,
  },
  {
    name: "implementing a reusable React component remains coding work",
    input: { stage: RouteStage.Prompt, userPrompt: "Implement a reusable React component for assigning owners in src/components/OwnerPicker.tsx." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "self-contained HTML CSS and JavaScript experience uses HTML",
    input: { stage: RouteStage.Prompt, userPrompt: "Build a self-contained HTML/CSS/JavaScript constellation visualization that reacts to pointer movement." },
    expected: VisualRoute.Html,
  },
  {
    name: "rendered visual before after preview uses web preview",
    input: { stage: RouteStage.Prompt, userPrompt: "Open a rendered preview of the latest layout change and show a visual before/after diff." },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "inline HTML requested as a live page uses web preview",
    input: { stage: RouteStage.Prompt, userPrompt: "Render this HTML as a live page I can inspect rather than showing source: <main><h1>Status</h1></main>" },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "written release checklist uses Markdown",
    input: { stage: RouteStage.Prompt, userPrompt: "Write a release-readiness checklist for a mobile app, grouped into security, observability, rollout, and rollback sections." },
    expected: VisualRoute.Markdown,
  },
  {
    name: "structured briefing after a plain-text tool result uses Markdown",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Use the retrieved policy notes to prepare a structured briefing with a summary, key changes, risks, and action items.",
      toolName: "policy.search",
      toolInput: { query: "retention policy changes" },
      toolResult: { ok: true, content: [{ type: "text", text: "Retention changes from 30 to 45 days. Legal hold remains indefinite. Regional rollout begins in October." }] },
    },
    expected: VisualRoute.Markdown,
  },
  {
    name: "hyphenated state-machine diagram uses Mermaid",
    input: { stage: RouteStage.Prompt, userPrompt: "Create a state-machine diagram for an order moving through pending, paid, packed, shipped, delivered, canceled, and refunded states." },
    expected: VisualRoute.Mermaid,
  },
  {
    name: "print-ready PDF invoice is a file artifact",
    input: { stage: RouteStage.Prompt, userPrompt: "Deliver the finalized customer invoice as a print-ready PDF file with the provided logo and line items." },
    expected: VisualRoute.File,
  },
  {
    name: "existing PPTX opens in its native file viewer",
    input: { stage: RouteStage.Prompt, userPrompt: "Open and show me the attached quarterly-results.pptx in its native slide viewer without rebuilding the deck." },
    expected: VisualRoute.File,
  },
  {
    name: "reusable date-range picker uses components",
    input: { stage: RouteStage.Prompt, userPrompt: "Let me interact with a reusable date-range picker here, including preset buttons, two calendars, and keyboard navigation." },
    expected: VisualRoute.Component,
  },
  {
    name: "reusable loan calculator uses components",
    input: { stage: RouteStage.Prompt, userPrompt: "Show a reusable loan calculator component in the conversation with principal and term sliders, an interest input, and a live monthly-payment total." },
    expected: VisualRoute.Component,
  },
  {
    name: "reusable interactive data table uses components",
    input: { stage: RouteStage.Prompt, userPrompt: "Present these fifty inventory rows in a reusable interactive data-table component with sorting, text filtering, and page controls." },
    expected: VisualRoute.Component,
  },
  {
    name: "reusable clickable onboarding stepper uses components",
    input: { stage: RouteStage.Prompt, userPrompt: "Give me a reusable onboarding stepper I can click through here, with Back and Next controls, progress status, and validation on each step." },
    expected: VisualRoute.Component,
  },
  {
    name: "browser product tour with morphing illustrations uses HTML",
    input: { stage: RouteStage.Prompt, userPrompt: "Design a new browser-based product tour whose scenes morph between custom illustrations as the visitor advances." },
    expected: VisualRoute.Html,
  },
  {
    name: "standalone HTML canvas animation uses HTML",
    input: { stage: RouteStage.Prompt, userPrompt: "Make a standalone HTML canvas animation of glowing particles orbiting a logo, with pointer-driven turbulence and a reduced-motion mode." },
    expected: VisualRoute.Html,
  },
  {
    name: "existing Next.js app requested in browser uses web preview",
    input: { stage: RouteStage.Prompt, userPrompt: "Preview the existing Next.js app in a browser at its current route. Do not modify any project files." },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "development-server URL upgrades a running dashboard to web preview",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Preview the running dashboard once the development server has started.",
      toolName: "dev_server.start",
      toolInput: { project: "dashboard" },
      toolResult: { ok: true, status: "running", url: "http://127.0.0.1:3000/dashboard" },
    },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "response exposing requested live local app uses web preview",
    input: {
      stage: RouteStage.Response,
      userPrompt: "Show me the existing app in a browser after starting it.",
      assistantResponse: "The existing application is running successfully at http://localhost:8080. Open that live URL now for the requested preview.",
    },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "three-source sortable explorer uses components",
    input: { stage: RouteStage.Prompt, userPrompt: "Using only the three source summaries in this prompt, make a sortable comparison explorer with tabs by theme." },
    expected: VisualRoute.Component,
  },
  {
    name: "cross-source evidence matrix uses components",
    input: { stage: RouteStage.Prompt, userPrompt: "Create a visual cross-source evidence matrix from the four excerpts below, with filters; do not fetch anything." },
    expected: VisualRoute.Component,
  },
  {
    name: "ICS calendar requested as the file itself is a file artifact",
    input: { stage: RouteStage.Prompt, userPrompt: "Generate a standards-compliant .ics calendar file for the four events below and return the file itself." },
    expected: VisualRoute.File,
  },
  {
    name: "new standalone HTML CSS JS experience uses HTML",
    input: { stage: RouteStage.Prompt, userPrompt: "Author a new standalone HTML/CSS/JS experience with a custom particle field that bends around the cursor and animated glass panels." },
    expected: VisualRoute.Html,
  },
  {
    name: "bespoke HTML art piece uses HTML",
    input: { stage: RouteStage.Prompt, userPrompt: "Create a bespoke one-page HTML art piece whose typography morphs on scroll and whose background reacts to pointer velocity." },
    expected: VisualRoute.Html,
  },
  {
    name: "new standalone HTML orbital clock uses HTML",
    input: { stage: RouteStage.Prompt, userPrompt: "Create new standalone HTML for an interactive orbital clock, including bespoke CSS animations and inline JavaScript." },
    expected: VisualRoute.Html,
  },
  {
    name: "fresh authored HTML microsite stays HTML despite render verb",
    input: { stage: RouteStage.Prompt, userPrompt: "Author a fresh HTML microsite with a custom canvas transition between sections; render the experience you create." },
    expected: VisualRoute.Html,
  },
  {
    name: "supplied complete HTML rendered as-is uses web preview",
    input: { stage: RouteStage.Prompt, userPrompt: "Here is a complete HTML document I already have: <!doctype html><html><body><h1>Status</h1></body></html>. Render this supplied page as-is." },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "explicitly forbidding either artifact and visual output stays transcript",
    input: { stage: RouteStage.Prompt, userPrompt: "Discuss when Mermaid versus Markdown would be appropriate, but do not generate either artifact or any visual output." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "meeting notes turned into a decision brief use Markdown",
    input: { stage: RouteStage.Prompt, userPrompt: "Turn the following meeting notes into a polished, readable decision brief with headings and callouts." },
    expected: VisualRoute.Markdown,
  },
  {
    name: "lasting written decision log uses Markdown despite HTML source",
    input: { stage: RouteStage.Prompt, userPrompt: "The source meeting export is HTML, but I need its decisions distilled into a lasting written decision log with owners and due dates." },
    expected: VisualRoute.Markdown,
  },
  {
    name: "dependency topology uses Mermaid",
    input: { stage: RouteStage.Prompt, userPrompt: "Map the service dependency topology from the mobile client through the gateway, auth service, catalog service, queues, and databases." },
    expected: VisualRoute.Mermaid,
  },
  {
    name: "multi-actor request sequence uses Mermaid",
    input: { stage: RouteStage.Prompt, userPrompt: "Show the request sequence among the browser, edge proxy, API, payment provider, and webhook consumer during a successful checkout." },
    expected: VisualRoute.Mermaid,
  },
  {
    name: "tool dependency edges requested as architecture graph use Mermaid",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Turn the discovered package relationships into an architecture graph that makes cycles and direction visible.",
      toolName: "dependency_scanner",
      toolInput: { workspace: "packages" },
      toolResult: { ok: true, edges: [["shell", "core"], ["core", "schema"], ["schema", "core"], ["api", "core"]] },
    },
    expected: VisualRoute.Mermaid,
  },
  {
    name: "branching topology beats negated interactive surfaces",
    input: { stage: RouteStage.Prompt, userPrompt: "Do not build an interactive dashboard or webpage. Show the branching topology of the disaster-recovery decision paths and their convergence points." },
    expected: VisualRoute.Mermaid,
  },
  {
    name: "native Word document revised in place remains a file",
    input: { stage: RouteStage.Prompt, userPrompt: "Revise the attached vendor-agreement.docx in place, keeping its tracked changes and Word styles, then return the edited document." },
    expected: VisualRoute.File,
  },
  {
    name: "response confirming native Draw.io artifact uses file route",
    input: { stage: RouteStage.Response, assistantResponse: "The editable diagram source has been created as network-layout.drawio and is ready to present as the exact native file." },
    expected: VisualRoute.File,
  },
  {
    name: "response confirming standard comparison controls uses components",
    input: { stage: RouteStage.Response, assistantResponse: "I assembled the alternatives into standard comparison cards with a feature toggle, a budget slider, and a selectable detail table." },
    expected: VisualRoute.Component,
  },
  {
    name: "successful search data requested as filterable grid uses components",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Put these successful search results into a standard filterable results grid with source chips and a sort menu.",
      toolName: "federated_search",
      toolInput: { query: "renewal risk" },
      toolResult: { ok: true, records: [{ source: "crm", title: "Acme" }, { source: "support", title: "Acme escalation" }], total: 2 },
    },
    expected: VisualRoute.Component,
  },
  {
    name: "explicit standard controls beat negated custom HTML and slides",
    input: { stage: RouteStage.Prompt, userPrompt: "Do not author custom HTML or a slide deck. Use standard tabs, checkboxes, and a timeline control to explore the rollout phases by department." },
    expected: VisualRoute.Component,
  },
  {
    name: "bespoke scrolling microsite from scratch uses HTML",
    input: { stage: RouteStage.Prompt, userPrompt: "Author a bespoke single-page microsite from scratch where an illustrated submarine descends as the reader scrolls through ocean-depth milestones." },
    expected: VisualRoute.Html,
  },
  {
    name: "response confirming new bespoke story page uses HTML",
    input: { stage: RouteStage.Response, assistantResponse: "I created a new interactive story page with a custom constellation canvas, animated chapter transitions, and bespoke hover behavior." },
    expected: VisualRoute.Html,
  },
  {
    name: "response confirming unchanged existing HTML preview uses web preview",
    input: { stage: RouteStage.Response, assistantResponse: "The existing checkout-demo.html has been supplied unchanged and is ready to open as a rendered browser preview." },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "failed UI-bearing result with ok false never mounts",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Show the issue picker.",
      toolResult: { ok: false, error: "unavailable", _meta: { "ui/resourceUri": "ui://issues/picker" } },
    },
    expected: VisualRoute.Transcript,
  },
  {
    name: "replace refactor in a source file stays transcript",
    input: { stage: RouteStage.Prompt, userPrompt: "In src/cache.ts, replace duplicated retry arithmetic with a small helper and update the call sites. Keep the explanation brief." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "language and rendering-format metadiscussion stays transcript",
    input: { stage: RouteStage.Prompt, userPrompt: "Tell me whether the words HTML, Markdown, and Mermaid name languages or rendering formats; do not produce any of them." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "failed app-data tool result falls back to transcript",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Show current stock in the inventory app.",
      toolName: "inventory.stock",
      toolInput: { warehouse: "north" },
      toolResult: { isError: true, content: [{ type: "text", text: "The inventory service timed out before any interface data was returned." }], _meta: { "openai/outputTemplate": "ui://inventory/stock.html" } },
    },
    expected: VisualRoute.Transcript,
  },
  {
    name: "Mermaid syntax explanation stays transcript",
    input: { stage: RouteStage.Prompt, userPrompt: "What does the arrow --> mean inside Mermaid sequence-diagram syntax? Answer in plain prose without drawing a diagram." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "already Markdown notes remain Markdown",
    input: { stage: RouteStage.Prompt, userPrompt: "Reformat these already Markdown notes without changing the format: ## Goals followed by - reduce latency and - simplify deploys." },
    expected: VisualRoute.Markdown,
  },
  {
    name: "tool-returned text markdown renders as Markdown",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Retrieve the field notes as written.",
      toolName: "notes.fetch",
      toolInput: { notebook: "wetlands" },
      toolResult: { ok: true, mimeType: "text/markdown", content: "# Field Notes\n\n- Heron observed at 06:40\n- Water level up three centimeters" },
    },
    expected: VisualRoute.Markdown,
  },
  {
    name: "generic tool text with strong Markdown structure renders as Markdown",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Bring back the weekly editorial brief.",
      toolName: "briefs.read",
      toolInput: { week: "2026-W29" },
      toolResult: { ok: true, content: [{ type: "text", text: "## Weekly Editorial Brief\n\n### Priorities\n- Publish the accessibility audit\n- Review the summer issue\n\n### Owners\n- Audit: Mina\n- Issue: Cole" }] },
    },
    expected: VisualRoute.Markdown,
  },
  {
    name: "structured tool Markdown does not override a one-fact question",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Who owns the accessibility audit?",
      toolName: "briefs.read",
      toolResult: { ok: true, content: [{ type: "text", text: "## Weekly Brief\n\n### Owners\n- Accessibility audit: Mina\n- Summer issue: Cole" }] },
    },
    expected: VisualRoute.Transcript,
  },
  {
    name: "tool-returned Mermaid MIME renders as Mermaid",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Return the topology source for the warehouse network.",
      toolName: "topology.read",
      toolInput: { site: "warehouse-7" },
      toolResult: { ok: true, mimeType: "text/mermaid", content: "flowchart LR\n  Scanner --> AccessPoint\n  AccessPoint --> Router\n  Router --> Cloud" },
    },
    expected: VisualRoute.Mermaid,
  },
  {
    name: "decision tree uses Mermaid graph affordance",
    input: { stage: RouteStage.Prompt, userPrompt: "Make a decision tree showing when a refund is automatic, when an agent must approve it, and when finance escalation is required." },
    expected: VisualRoute.Mermaid,
  },
  {
    name: "existing Markdown file requested unchanged stays a file reference",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Show me the existing architecture note without changing it.",
      toolName: "workspace.read_text",
      toolResult: { ok: true, path: "notes/edge-cache.md", text: "# Edge Cache\n\nRequests enter through the regional proxy.\n\n## Invalidations\n\nPurge messages fan out through the control plane." },
    },
    expected: VisualRoute.File,
  },
  {
    name: "native Word edit preserving styles remains a file",
    input: { stage: RouteStage.Prompt, userPrompt: "Edit the attached handbook.docx to replace the outdated safety section while preserving its Word styles and page layout." },
    expected: VisualRoute.File,
  },
  {
    name: "reusing native PowerPoint layouts remains a file",
    input: { stage: RouteStage.Prompt, userPrompt: "Reuse the attached board-template.pptx and populate its existing layouts with the July operating review." },
    expected: VisualRoute.File,
  },
  {
    name: "sandbox workbook download response uses file",
    input: { stage: RouteStage.Response, assistantResponse: "The completed workbook is ready: [Download the reconciled inventory file](sandbox:/mnt/data/inventory_reconciled.xlsx)." },
    expected: VisualRoute.File,
  },
  {
    name: "completed attached image response uses file",
    input: { stage: RouteStage.Response, assistantResponse: "The edited portrait is complete and attached as lakeside_portrait_retouched.png." },
    expected: VisualRoute.File,
  },
  {
    name: "finalize tool returning native document artifact uses file",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Package the finalized lease amendment for delivery.",
      toolName: "documents.finalize",
      toolInput: { documentId: "lease-amendment-12" },
      toolResult: { success: true, artifact: { filename: "lease-amendment-12.docx", path: "/mnt/data/lease-amendment-12.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } },
    },
    expected: VisualRoute.File,
  },
  {
    name: "compact filter component with standard controls uses components",
    input: { stage: RouteStage.Prompt, userPrompt: "Build a compact date-range filter component with a team dropdown, an Include archived toggle, and an Apply button; this is not a full webpage." },
    expected: VisualRoute.Component,
  },
  {
    name: "composed CRM and billing comparison panel uses components",
    input: { stage: RouteStage.Prompt, userPrompt: "Compose one comparison panel that pairs account health from the CRM with unpaid balance from billing for each customer." },
    expected: VisualRoute.Component,
  },
  {
    name: "accessible tab component uses components",
    input: { stage: RouteStage.Prompt, userPrompt: "Create an accessible tab component for Overview, Activity, and Permissions, including arrow-key navigation and active-state styling." },
    expected: VisualRoute.Component,
  },
  {
    name: "three-source operations card composition uses components",
    input: { stage: RouteStage.Prompt, userPrompt: "Combine shipment status, local weather alerts, and driver check-ins from their three sources into a single operations card component." },
    expected: VisualRoute.Component,
  },
  {
    name: "bespoke scroll-driven web story uses HTML",
    input: { stage: RouteStage.Prompt, userPrompt: "Build a bespoke scroll-driven web story about a river journey, where the palette, typography, and animated route change between chapters." },
    expected: VisualRoute.Html,
  },
  {
    name: "from-scratch morphing full-screen tour uses HTML",
    input: { stage: RouteStage.Prompt, userPrompt: "Create a from-scratch full-screen product tour that morphs between illustrated scenes as the visitor chooses different paths." },
    expected: VisualRoute.Html,
  },
  {
    name: "response exposing supplied remote review build uses web preview",
    input: { stage: RouteStage.Response, assistantResponse: "A supplied review build is available at https://preview.example.org/builds/olive-219; render that existing site interactively." },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "preview server tool returning local URL uses web preview",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Present the running documentation site.",
      toolName: "preview_server.status",
      toolInput: { name: "docs-next" },
      toolResult: { success: true, state: "ready", previewUrl: "http://127.0.0.1:4400", source: "existing dev server" },
    },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "existing served admin portal uses web preview",
    input: { stage: RouteStage.Prompt, userPrompt: "Inspect the existing admin portal currently served on port 3007 in an interactive browser surface." },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "fenced TSX component source remains transcript",
    input: { stage: RouteStage.Response, assistantResponse: "Here is the reusable control:\n```tsx\nexport function SortControl() {\n  return <label>Sort <select><option>Newest</option><option>Oldest</option></select></label>;\n}\n```" },
    expected: VisualRoute.Transcript,
  },
  {
    name: "response confirming linked-card component composition uses components",
    input: { stage: RouteStage.Response, assistantResponse: "I composed a React AccountSnapshot component that combines support ticket count, renewal date, and current invoice status in three linked cards." },
    expected: VisualRoute.Component,
  },
  {
    name: "response confirming standalone HTML slide experience uses HTML",
    input: { stage: RouteStage.Response, assistantResponse: "I authored the slide experience as standalone HTML source with full-viewport scenes, presenter-key navigation, and CSS transitions; the first slide opens with the title Coastal Futures." },
    expected: VisualRoute.Html,
  },
  {
    name: "response confirming complete bespoke HTML configurator uses HTML",
    input: { stage: RouteStage.Response, assistantResponse: "The newly authored experience is a complete HTML configurator with a custom canvas backdrop, animated material swatches, and a live bespoke preview of the chosen bicycle." },
    expected: VisualRoute.Html,
  },
  {
    name: "compact authored Markdown checklist is reused",
    input: { stage: RouteStage.Response, assistantResponse: "## Release Checklist\n\n- [ ] Freeze translations\n- [ ] Confirm rollback owner\n- [ ] Publish support notes" },
    expected: VisualRoute.Markdown,
  },
  {
    name: "tool metadata declaring a finalized Markdown document is reused",
    input: { stage: RouteStage.Tool, toolResult: "document_drafter completed successfully with output_type `markdown_document`; the returned body contains the finalized governance charter." },
    expected: VisualRoute.Markdown,
  },
  {
    name: "structured Markdown content request is explicit",
    input: { stage: RouteStage.Prompt, userPrompt: "Write a publication-ready FAQ for new grant recipients, delivered only as structured Markdown content." },
    expected: VisualRoute.Markdown,
  },
  {
    name: "tool completion containing inline Mermaid source is reused",
    input: { stage: RouteStage.Tool, toolResult: "topology_mapper succeeded and returned `graph TD; Sensor-->Gateway; Gateway-->Archive;` as Mermaid text." },
    expected: VisualRoute.Mermaid,
  },
  {
    name: "byte-for-byte existing Markdown remains a file",
    input: { stage: RouteStage.Prompt, userPrompt: "Hand back the existing `/private/tmp/legal-review-notes.md` byte-for-byte unchanged." },
    expected: VisualRoute.File,
  },
  {
    name: "already supplied SVG requested unchanged remains a file",
    input: { stage: RouteStage.Prompt, userPrompt: "Reuse the already supplied `assets/ember-mark.svg` exactly as it is; do not redraw or edit it." },
    expected: VisualRoute.File,
  },
  {
    name: "native multi-sheet Excel request is a file",
    input: { stage: RouteStage.Prompt, userPrompt: "Build a native Excel workbook with separate budget, actuals, and variance sheets." },
    expected: VisualRoute.File,
  },
  {
    name: "prose tool completion with artifact path is a file",
    input: { stage: RouteStage.Tool, toolResult: "word_export completed successfully; artifact_path is `/private/tmp/partner-agreement.docx`." },
    expected: VisualRoute.File,
  },
  {
    name: "attached Markdown requested as the same attachment remains a file",
    input: { stage: RouteStage.Prompt, userPrompt: "Return my attached `launch-copy.md` as the same attachment with no content or formatting changes." },
    expected: VisualRoute.File,
  },
  {
    name: "embedded MCP UI resource URI in a tool response mounts the app",
    input: { stage: RouteStage.Tool, toolResult: "CRM connector completed successfully and returned an interactive `ui://crm/account-482` account workspace." },
    expected: VisualRoute.McpApp,
  },
  {
    name: "tool response declaring a live UI resource mounts the app",
    input: { stage: RouteStage.Tool, toolResult: "calendar_mcp.render_week finished with status success; content includes a live UI resource for the populated week view." },
    expected: VisualRoute.McpApp,
  },
  {
    name: "response-only MCP URI claim does not mount an app",
    input: { stage: RouteStage.Response, assistantResponse: "The inventory connector returned the interactive stock explorer below, with resource id `ui://inventory/explorer/91`." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "tool response declaring a functional MCP app mounts it",
    input: { stage: RouteStage.Tool, toolResult: "issue_tracker.open_triage_board succeeded and returned a functional MCP app surface containing the selected sprint." },
    expected: VisualRoute.McpApp,
  },
  {
    name: "successful MCP result declaring a rendered explorer mounts it",
    input: { stage: RouteStage.Tool, toolResult: "analytics_mcp result is successful; the payload contains a rendered interactive cohort explorer rather than a link or file." },
    expected: VisualRoute.McpApp,
  },
  {
    name: "response-only connector UI claim remains transcript",
    input: { stage: RouteStage.Response, assistantResponse: "The forms connector successfully returned a usable grant-intake UI, embedded below as `ui://forms/grant-intake-7`." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "returned_ui tool metadata mounts the MCP app",
    input: { stage: RouteStage.Tool, toolResult: "travel_mcp.plan_view completed; returned_ui is present and exposes the booked itinerary with working expand controls." },
    expected: VisualRoute.McpApp,
  },
  {
    name: "registered MCP UI URI from tool lifecycle mounts the app",
    input: { stage: RouteStage.Tool, toolResult: "invocation finished successfully, resource registration completed, and the connector returned `ui://warehouse/pick-run/204` for display." },
    expected: VisualRoute.McpApp,
  },
  {
    name: "documentation text merely mentioning a UI URI stays transcript",
    input: { stage: RouteStage.Tool, toolResult: "The URI syntax uses ui:// followed by a server and resource name." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "failed prose tool result never mounts its advertised UI URI",
    input: { stage: RouteStage.Tool, toolResult: "calendar_connector failed before returning the registered ui://calendar/week resource." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "standard searchable combobox request uses components",
    input: { stage: RouteStage.Prompt, userPrompt: "Build a standard searchable combobox that supports keyboard selection and a clear button." },
    expected: VisualRoute.Component,
  },
  {
    name: "response-only pagination claim does not invent a component",
    input: { stage: RouteStage.Response, assistantResponse: "Here is the requested pagination control with previous, next, current-page, and total-page states." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "standard upload dropzone request uses components",
    input: { stage: RouteStage.Prompt, userPrompt: "Create an accessible file-upload dropzone component with progress and validation messages." },
    expected: VisualRoute.Component,
  },
  {
    name: "cross-source sortable review table uses components",
    input: { stage: RouteStage.Prompt, userPrompt: "Combine pull requests from GitHub and tickets from Jira into one sortable review table." },
    expected: VisualRoute.Component,
  },
  {
    name: "tool-returned standard FilterBar uses components",
    input: { stage: RouteStage.Tool, toolResult: "component_renderer completed and returned a standard FilterBar component with text, status, and owner controls." },
    expected: VisualRoute.Component,
  },
  {
    name: "bare implement dialog instruction remains coding work",
    input: { stage: RouteStage.Prompt, userPrompt: "Implement a conventional confirmation dialog with cancel, continue, focus trapping, and escape-to-close behavior." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "one-off launch page with custom art direction uses HTML",
    input: { stage: RouteStage.Prompt, userPrompt: "Design a new one-off launch page for an imaginary lunar greenhouse, with custom motion and an unusual editorial layout." },
    expected: VisualRoute.Html,
  },
  {
    name: "inline doctype response for a new bespoke experience uses HTML",
    input: { stage: RouteStage.Response, assistantResponse: "`<!doctype html><html><head><title>Signal Garden</title></head><body><main class=\"kinetic-story\">…</main></body></html>` is the new bespoke experience." },
    expected: VisualRoute.Html,
  },
  {
    name: "original mission-control wall with cinematic transitions uses HTML",
    input: { stage: RouteStage.Prompt, userPrompt: "Prototype an original mission-control wall for a fictional deep-sea expedition, with layered sonar visuals and cinematic transitions." },
    expected: VisualRoute.Html,
  },
  {
    name: "tool-returned self-contained bespoke page uses HTML",
    input: { stage: RouteStage.Tool, toolResult: "bespoke_page_generator succeeded and returned an inline, self-contained HTML experience for the museum night exhibit." },
    expected: VisualRoute.Html,
  },
  {
    name: "browser navigation returning a live viewport uses web preview",
    input: { stage: RouteStage.Tool, toolResult: "browser navigation succeeded for the already-running admin console, and the live viewport is available for inspection." },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "response-only claimed existing URL preview remains transcript",
    input: { stage: RouteStage.Response, assistantResponse: "The provided storefront has loaded in the preview pane at its existing URL; I have not generated a replacement." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "reopen a previously viewed prototype uses web preview",
    input: { stage: RouteStage.Prompt, userPrompt: "Reopen the prototype we were just viewing and inspect how its current mobile menu behaves." },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "tool lifecycle returning a rendered viewport uses web preview",
    input: { stage: RouteStage.Tool, toolResult: "the supplied site finished loading, browser status is ready, and a rendered viewport was returned." },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "visit a previously supplied public demo link uses web preview",
    input: { stage: RouteStage.Prompt, userPrompt: "Visit the public demo link I gave you and examine the visible checkout layout as it currently runs." },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "plain dependency explanation with visual rejection stays transcript",
    input: { stage: RouteStage.Prompt, userPrompt: "Explain dependency injection in three sentences. I only want the explanation, not a diagram or visual." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "Markdown mode definition with document rejection stays transcript",
    input: { stage: RouteStage.Prompt, userPrompt: "In this parser documentation, what does the term ‘Markdown mode’ mean? Answer conversationally; do not create a document." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "unavailable production preview response stays transcript",
    input: { stage: RouteStage.Response, userPrompt: "Open the production preview.", assistantResponse: "I can open a production preview after the application has been deployed, but no live URL or running surface is available yet." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "future dashboard promise stays transcript",
    input: { stage: RouteStage.Response, userPrompt: "Give me an interactive customer dashboard.", assistantResponse: "I’ll create an interactive customer dashboard with filters, sortable columns, and detail panels next." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "native workbook update preserving formulas remains a file",
    input: { stage: RouteStage.Prompt, userPrompt: "Update the Excel workbook finance/Q3-forecast.xlsx with the new assumptions while preserving its formulas, formatting, named ranges, and charts." },
    expected: VisualRoute.File,
  },
  {
    name: "tool-returned GLB file URI uses the 3D file viewer",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Display the generated 3D enclosure model.",
      toolName: "cad_export",
      toolInput: { assembly: "sensor-enclosure", format: "glb" },
      toolResult: { ok: true, files: [{ uri: "file:///private/tmp/cad/sensor-enclosure-v7.glb", mimeType: "model/gltf-binary" }] },
    },
    expected: VisualRoute.File,
  },
  {
    name: "returned rollout groups arranged as filtered status cards use components",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Arrange the returned rollout groups as status cards and add an environment filter plus pause and resume controls.",
      toolName: "rollout_status",
      toolResult: { ok: true, groups: [{ environment: "staging", progress: 100, state: "complete" }, { environment: "canary", progress: 35, state: "running" }] },
    },
    expected: VisualRoute.Component,
  },
  {
    name: "full-screen animated museum kiosk uses HTML",
    input: { stage: RouteStage.Prompt, userPrompt: "Design a full-screen museum kiosk experience for the Apollo guidance computer with animated schematics, tactile-looking controls, and chapter navigation." },
    expected: VisualRoute.Html,
  },
  {
    name: "custom product-launch microsite with no dashboard chrome uses HTML",
    input: { stage: RouteStage.Prompt, userPrompt: "Build a custom product-launch microsite with a morphing hero illustration, smooth scene transitions, interactive feature reveals, and no standard dashboard chrome." },
    expected: VisualRoute.Html,
  },
  {
    name: "running development server application uses web preview",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Open the application once the development server is ready.",
      toolName: "dev_server_start",
      toolInput: { command: "bun run dev", port: 5178 },
      toolResult: { ok: true, status: "running", url: "http://localhost:5178", pid: 24018 },
    },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "ready remote review environment uses web preview",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Display the live review environment created for this branch.",
      toolName: "review_environment_create",
      toolResult: { ok: true, environment: { state: "ready", kind: "web", url: "https://usage-alerts.review.acme-example.net" } },
    },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "definition of web preview stays transcript",
    input: { stage: RouteStage.Prompt, userPrompt: "In one sentence, define what a web preview is in an IDE." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "compact readiness card with badges uses components",
    input: { stage: RouteStage.Prompt, userPrompt: "Arrange API healthy, queue delayed, and database healthy into one compact status card on the canvas with colored badges. No website and no source-code changes." },
    expected: VisualRoute.Component,
  },
  {
    name: "future PDF promise stays transcript",
    input: { stage: RouteStage.Response, userPrompt: "Export the audit as a PDF.", assistantResponse: "I’ll generate audit-report.pdf and attach it when the export finishes." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "future component promise stays transcript",
    input: { stage: RouteStage.Response, userPrompt: "Show the metrics in a dashboard.", assistantResponse: "I can assemble those metrics into an interactive dashboard with filters in the next step." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "tiny explicit Markdown artifact is reused",
    input: { stage: RouteStage.Response, userPrompt: "Give me the release status as a tiny Markdown artifact.", assistantResponse: "## Release status\n\n- API: green\n- Web: amber\n- Worker: green" },
    expected: VisualRoute.Markdown,
  },
  {
    name: "name-only question suppresses structured tool Markdown",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Who owns the accessibility audit? Reply with the person's name only; do not open or render the report.",
      toolName: "knowledge.search",
      toolResult: { mimeType: "text/markdown", content: "# Accessibility audit\n\n## Owner\n\n- Priya Shah\n\n## Scope\n\n- Checkout\n- Account settings" },
    },
    expected: VisualRoute.Transcript,
  },
  {
    name: "count-only question suppresses returned Mermaid",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "How many services are in this topology? Return only the number; do not display the diagram.",
      toolName: "topology.get",
      toolResult: { content: [{ type: "text", mimeType: "text/mermaid", text: "flowchart LR\n  API --> Queue\n  Queue --> Worker\n  Worker --> DB" }], metadata: { serviceCount: 4 } },
    },
    expected: VisualRoute.Transcript,
  },
  {
    name: "exact Markdown file viewer intent scopes artifact negation",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Open the existing file notes/edge-cache.md itself in the file viewer so I can edit that exact file. Do not re-render its Markdown as a new artifact.",
      toolName: "filesystem.stat",
      toolResult: { path: "notes/edge-cache.md", absolutePath: "/workspace/notes/edge-cache.md", exists: true, kind: "file", mimeType: "text/markdown", size: 4821 },
    },
    expected: VisualRoute.File,
  },
  {
    name: "broad no-canvas request still overrides exact file viewer intent",
    input: { stage: RouteStage.Prompt, userPrompt: "Open the existing file notes/edge-cache.md itself in the file viewer, but no canvas or visual artifact; just tell me its path here." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "tool-returned ADR preserves its Markdown structure",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Present the architecture decision record returned by the repository, preserving its Markdown structure.",
      toolName: "adr_fetch",
      toolResult: { ok: true, document: { mimeType: "text/markdown", text: "# ADR 037: Partition event storage\n\n## Status\nAccepted\n\n## Context\nWrite volume is outgrowing the shared cluster.\n\n## Decision\nPartition by tenant and calendar month.\n\n## Consequences\nBackfills require partition-aware tooling." } },
    },
    expected: VisualRoute.Markdown,
  },
  {
    name: "entity relationships with cardinalities use Mermaid",
    input: { stage: RouteStage.Prompt, userPrompt: "Diagram the entity relationships among organizations, users, workspaces, memberships, projects, and API keys, including cardinalities." },
    expected: VisualRoute.Mermaid,
  },
  {
    name: "expense approval form with conventional fields uses components",
    input: { stage: RouteStage.Prompt, userPrompt: "Create an expense-approval form with receipt preview, amount and category fields, a policy-warning banner, approver select, notes area, and Approve and Reject controls." },
    expected: VisualRoute.Component,
  },
  {
    name: "ready live branch tunnel uses web preview",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Show the live branch environment after the tunnel is established.",
      toolName: "preview_tunnel_create",
      toolInput: { service: "checkout-ui", port: 3008 },
      toolResult: { ok: true, tunnel: { state: "ready", url: "https://checkout-ui-7f3.dev-tunnel.example", localPort: 3008 } },
    },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "lasting Markdown policy manual is a document",
    input: { stage: RouteStage.Prompt, userPrompt: "Draft a lasting Markdown policy manual for handling customer data deletion requests, with scope, responsibilities, verification procedure, exceptions, and an audit checklist." },
    expected: VisualRoute.Markdown,
  },
  {
    name: "exact interview MP4 uses the file viewer",
    input: { stage: RouteStage.Prompt, userPrompt: "Open and display the exact interview recording at research/sessions/participant-17.mp4." },
    expected: VisualRoute.File,
  },
  {
    name: "animated full-screen HTML museum exhibit uses HTML",
    input: { stage: RouteStage.Prompt, userPrompt: "Build a full-screen animated HTML museum exhibit with a scroll-driven timeline and cinematic scene transitions." },
    expected: VisualRoute.Html,
  },
  {
    name: "exact nested Blender scene remains a file",
    input: { stage: RouteStage.Prompt, userPrompt: "Open the exact Blender scene at industrial-design/assembly-line-v9.blend so I can inspect the native artifact." },
    expected: VisualRoute.File,
  },
  {
    name: "replace content in native deck while preserving theme remains a file",
    input: { stage: RouteStage.Prompt, userPrompt: "Replace the quarterly metrics in the existing deck reports/board-update.pptx while preserving its theme, slide layouts, and animations." },
    expected: VisualRoute.File,
  },
  {
    name: "animated HTML geothermal cutaway uses HTML",
    input: { stage: RouteStage.Prompt, userPrompt: "Create an animated HTML cutaway that lets readers explore the layers of a geothermal plant, with hotspots, smooth transitions, and a full-screen narrative mode." },
    expected: VisualRoute.Html,
  },
  {
    name: "rendered interactive feature flag panel uses components",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Render the feature-flag controls as an interactive panel.",
      toolName: "canvas_render",
      toolInput: { surface: "panel", schema: { type: "panel", children: [{ type: "search" }, { type: "select" }, { type: "switch" }, { type: "button" }] } },
      toolResult: { ok: true, renderId: "flags-panel-72", interactive: true },
    },
    expected: VisualRoute.Component,
  },
  {
    name: "reusable Markdown syllabus is a document",
    input: { stage: RouteStage.Prompt, userPrompt: "Create a reusable Markdown syllabus for the internal distributed-systems course, with learning objectives, weekly modules, readings, labs, grading criteria, and an instructor checklist." },
    expected: VisualRoute.Markdown,
  },
  {
    name: "brief answer with explicit no-document context stays in transcript",
    input: { stage: RouteStage.Prompt, userPrompt: "Compare polling and webhooks in three brief bullets for an engineer choosing between them. This is just an answer, not a reusable document or UI." },
    expected: VisualRoute.Transcript,
  },
  {
    name: "durable Markdown operating charter is a document",
    input: { stage: RouteStage.Prompt, userPrompt: "Write a durable Markdown operating charter for the architecture council, covering its mandate, membership, meeting cadence, proposal process, decision records, and review checklist." },
    expected: VisualRoute.Markdown,
  },
  {
    name: "ranked applicant review table with controls uses components",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Turn these applicants into a ranked review table with skill filters, expandable evidence, shortlist checkboxes, and Advance and Decline actions.",
      toolName: "candidate_match",
      toolInput: { openingId: "eng-platform-42" },
      toolResult: {
        success: true,
        candidates: [
          { id: "can_19", name: "Ari Nolan", score: 92, skills: ["Go", "Kubernetes"] },
          { id: "can_73", name: "Samira Chen", score: 88, skills: ["Rust", "AWS"] },
          { id: "can_31", name: "Luis Ortega", score: 84, skills: ["TypeScript", "GCP"] },
        ],
      },
    },
    expected: VisualRoute.Component,
  },
  {
    name: "ready live catalog sandbox uses web preview",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Open the live catalog sandbox returned by the environment provisioner.",
      toolName: "sandbox_environment_provision",
      toolInput: { service: "parts-catalog", revision: "rev_91d" },
      toolResult: { ok: true, environment: { phase: "available", webUrl: "https://parts-catalog-rev91d.sandbox.example.com", health: "passing" } },
    },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "interactive sortable pricing comparison uses components",
    input: { stage: RouteStage.Prompt, userPrompt: "Build an interactive pricing comparison table with sortable columns, billing-period tabs, feature filters, and Select-plan buttons." },
    expected: VisualRoute.Component,
  },
  {
    name: "durable Markdown glossary is a document",
    input: { stage: RouteStage.Prompt, userPrompt: "Create a durable Markdown glossary for the machine-learning platform, organized alphabetically with concise definitions, cross-references, examples, and a maintenance section for future editors." },
    expected: VisualRoute.Markdown,
  },
  {
    name: "self-contained cinematic HTML journey uses HTML",
    input: { stage: RouteStage.Prompt, userPrompt: "Create a self-contained cinematic HTML journey through continental drift, with animated plate motion, evolving coastlines, a deep-time scrubber, and layered geological annotations." },
    expected: VisualRoute.Html,
  },
  {
    name: "YAML edit preserving native syntax remains a file",
    input: { stage: RouteStage.Prompt, userPrompt: "Edit the existing config/deployment.yaml to add the canary region while preserving its comments, anchors, and key ordering." },
    expected: VisualRoute.File,
  },
  {
    name: "custom animated HTML explainer outranks component controls",
    input: { stage: RouteStage.Prompt, userPrompt: "Build a custom animated HTML explainer for a satellite deployment, with an interactive orbital cutaway, scene controls, and cinematic transitions." },
    expected: VisualRoute.Html,
  },
  {
    name: "completed deployment URL is a web preview",
    input: { stage: RouteStage.Response, userPrompt: "Put the revised status page online and show me the result.", assistantResponse: "The revised status page is deployed at https://status-v2.saffron.example and is ready to preview." },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "filename-only question suppresses a returned source file",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Which single repository file handles the literal term \"Mermaid\" in our help text? Reply with the filename only; do not show, render, or explain its contents.",
      toolName: "read_source_file",
      toolInput: { path: "src/help/formatTerms.ts" },
      toolResult: { path: "src/help/formatTerms.ts", mimeType: "text/typescript", content: "export const formatTerms = { mermaid: \"A named diagram syntax used in help copy\" };" },
    },
    expected: VisualRoute.Transcript,
  },
  {
    name: "standard approval form ignores negated bespoke motion",
    input: { stage: RouteStage.Prompt, userPrompt: "Compose an agent-owned approval form using standard controls: a cost-center dropdown, amount field, urgent toggle, approver picker, and Submit and Reset buttons. No bespoke animation or art direction is needed." },
    expected: VisualRoute.Component,
  },
  {
    name: "persistent Markdown glossary survives metalinguistic content and scoped negations",
    input: { stage: RouteStage.Prompt, userPrompt: "Write a persistent Markdown glossary article explaining how our style guide uses the word \"Mermaid\". Use headings and examples, but do not draw a diagram and do not make a downloadable file." },
    expected: VisualRoute.Markdown,
  },
  {
    name: "server-owned UI negation is scoped to a cross-source composition",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Combine CRM opportunities and billing renewals into one agent-owned composition with shared filters and a sortable table. Do not mount either source's server-owned UI.",
      toolName: "mcp__workspace__fetch_comparison_sources",
      toolInput: { sources: ["crm", "billing"] },
      toolResult: {
        isError: false,
        content: [{ type: "text", text: "Both source datasets and the CRM server UI are available." }],
        structuredContent: {
          crm: [{ account: "Northwind", stage: "proposal" }],
          billing: [{ account: "Northwind", renewalMonth: "October" }],
        },
        _meta: {
          "openai/outputTemplate": "ui://crm/opportunity-board.html",
          "ui/resourceUri": "ui://crm/opportunity-board.html",
        },
      },
    },
    expected: VisualRoute.Component,
  },
  {
    name: "rendering exact existing HTML as a page outranks file reuse",
    input: { stage: RouteStage.Prompt, userPrompt: "Render the existing HTML at /workspace/demos/solar-system/index.html exactly as it looks in a page preview. Do not show or return the HTML source." },
    expected: VisualRoute.WebPreview,
  },
  {
    name: "rendering an already-running portal uses its returned local preview",
    input: {
      stage: RouteStage.Tool,
      userPrompt: "Render the already-running customer portal as a page so I can interact with it; do not show the HTML source.",
      toolName: "start_preview_server",
      toolInput: { project: "customer-portal", port: 4627 },
      toolResult: { status: "running", url: "http://127.0.0.1:4627/portal", pid: 24627 },
    },
    expected: VisualRoute.WebPreview,
  },
];

describe("routeVisual", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(routeVisual(testCase.input).route).toBe(testCase.expected);
    });
  }

  it("returns an inspectable deck decision", () => {
    const decision = routeVisual({
      stage: RouteStage.Prompt,
      userPrompt: "Make a slide deck from the research.",
    });
    expect(decision.route).toBe(VisualRoute.Html);
    expect(decision.preset).toBe(RoutePreset.Deck);
    expect(decision.confidence).toBeGreaterThanOrEqual(0.9);
    expect(decision.evidence.some((item) => item.signal === "explicit-format")).toBe(true);
  });

  it("explains a named source deliverable as a file artifact", () => {
    const decision = routeVisual({
      stage: RouteStage.Prompt,
      userPrompt: "Give me the raw HTML source as an index.html file; do not render or preview the page.",
    });
    expect(decision.route).toBe(VisualRoute.File);
    expect(decision.strategy).toBe("generate");
    expect(decision.evidence.some((item) => item.signal === "named-file-deliverable")).toBe(true);
  });

  it("keeps existing files on reuse strategy", () => {
    const decision = routeVisual({
      stage: RouteStage.Prompt,
      userPrompt: "Open results/benchmark.csv and show me the data.",
    });
    expect(decision.route).toBe(VisualRoute.File);
    expect(decision.strategy).toBe("reuse");
  });

  it("selects native viewers for slide and calendar files", () => {
    const slides = routeVisual({
      stage: RouteStage.Prompt,
      userPrompt: "Open quarterly-results.pptx in its native viewer.",
    });
    const calendar = routeVisual({
      stage: RouteStage.Prompt,
      userPrompt: "Generate a standards-compliant .ics calendar file and return the file itself.",
    });
    expect(slides.viewer).toBe("slides");
    expect(calendar.viewer).toBe("calendar");
    expect(calendar.strategy).toBe("generate");
  });

  it("does not claim negated raw HTML source was explicitly requested", () => {
    const decision = routeVisual({
      stage: RouteStage.Prompt,
      userPrompt: "Design and present a bespoke product-launch microsite with a full-bleed hero, custom typography, layered scroll animation, and art-directed sections; do not send raw HTML source.",
    });
    expect(decision.route).toBe(VisualRoute.Html);
    expect(decision.evidence.some((item) => item.signal === "explicit-format")).toBe(false);
    expect(decision.evidence.some((item) => item.signal === "bespoke-experience")).toBe(true);
  });
});
