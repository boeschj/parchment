#!/usr/bin/env bun
// hello-app: the smallest real MCP app (SEP-1865) parchment can host.
//
// A stdio MCP server exposing a task board. `show_task_board` returns a
// ui:// resource (mime text/html;profile=mcp-app) whose HTML speaks raw
// JSON-RPC-over-postMessage with the host: it handshakes via ui/initialize,
// receives the tool result, calls `add_task` back on this server through
// the host bridge, and pushes the board state into the model's next turn
// with ui/update-model-context.
//
// Register + open from a Claude Code session:
//   canvas_app { server: "hello-app", command: "bun",
//                args: ["<repo>/examples/apps/hello-app/server.ts"],
//                tool: "show_task_board" }

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const APP_MIME_TYPE = "text/html;profile=mcp-app";
const BOARD_RESOURCE_URI = "ui://hello-app/board";

const tasks: string[] = ["Ship the MCP app host", "Demo it in a parchment slot"];

const server = new McpServer({ name: "hello-app", version: "0.1.0" });

server.registerResource(
  "task-board-ui",
  BOARD_RESOURCE_URI,
  { title: "Task board UI", mimeType: APP_MIME_TYPE },
  async () => ({
    contents: [{ uri: BOARD_RESOURCE_URI, mimeType: APP_MIME_TYPE, text: boardHtml() }],
  }),
);

server.registerTool(
  "show_task_board",
  {
    title: "Show the task board",
    description: "Render the interactive task board UI.",
    inputSchema: z.object({}),
    _meta: { "ui/resourceUri": BOARD_RESOURCE_URI },
  },
  async () => ({
    content: [
      { type: "text" as const, text: `Task board with ${tasks.length} tasks.` },
      {
        type: "resource" as const,
        resource: { uri: BOARD_RESOURCE_URI, mimeType: APP_MIME_TYPE, text: boardHtml() },
      },
    ],
    structuredContent: { tasks: [...tasks] },
  }),
);

server.registerTool(
  "add_task",
  {
    title: "Add a task",
    description: "Add a task to the board.",
    inputSchema: z.object({ title: z.string().min(1) }),
  },
  async ({ title }) => {
    tasks.push(title);
    return {
      content: [{ type: "text" as const, text: `Added "${title}" — ${tasks.length} tasks now.` }],
      structuredContent: { tasks: [...tasks] },
    };
  },
);

server.registerTool(
  "list_tasks",
  {
    title: "List tasks",
    description: "Current tasks on the board.",
    inputSchema: z.object({}),
  },
  async () => ({
    content: [{ type: "text" as const, text: tasks.map((task) => `- ${task}`).join("\n") }],
    structuredContent: { tasks: [...tasks] },
  }),
);

function boardHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 20px; background: transparent; }
  h1 { font-size: 16px; margin: 0 0 12px; }
  ul { list-style: none; padding: 0; margin: 0 0 16px; }
  li { padding: 8px 12px; margin-bottom: 6px; border: 1px solid rgba(128,128,128,.35); border-radius: 10px; font-size: 13px; }
  .row { display: flex; gap: 8px; }
  input { flex: 1; padding: 8px 12px; border: 1px solid rgba(128,128,128,.35); border-radius: 999px; font-size: 13px; background: transparent; color: inherit; }
  button { padding: 8px 14px; border: 0; border-radius: 999px; font-size: 13px; cursor: pointer; background: #b8860b; color: #fff; }
  button.secondary { background: transparent; color: inherit; border: 1px solid rgba(128,128,128,.45); }
  #status { font-size: 11px; opacity: .65; margin-top: 10px; }
  .dark body, body.dark { color: #eee; }
</style>
</head>
<body>
<h1>hello-app · task board</h1>
<ul id="tasks"></ul>
<div class="row">
  <input id="title" placeholder="New task title" aria-label="New task title">
  <button id="add">Add task</button>
  <button id="send" class="secondary">Send board to model</button>
</div>
<p id="status">connecting to host…</p>
<script>
(() => {
  // Minimal SEP-1865 guest: JSON-RPC 2.0 over postMessage to the host.
  let nextId = 1;
  const pending = new Map();
  let tasks = [];

  function request(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    });
  }

  function notify(method, params) {
    window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
  }

  function respond(id, result) {
    window.parent.postMessage({ jsonrpc: "2.0", id, result }, "*");
  }

  function setStatus(text) {
    document.getElementById("status").textContent = text;
  }

  function renderTasks() {
    const list = document.getElementById("tasks");
    list.innerHTML = "";
    for (const task of tasks) {
      const item = document.createElement("li");
      item.textContent = task;
      list.appendChild(item);
    }
  }

  function adoptStructuredContent(structuredContent) {
    if (structuredContent && Array.isArray(structuredContent.tasks)) {
      tasks = structuredContent.tasks;
      renderTasks();
    }
  }

  function applyTheme(hostContext) {
    if (hostContext && hostContext.theme === "dark") document.body.classList.add("dark");
    if (hostContext && hostContext.theme === "light") document.body.classList.remove("dark");
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;

    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
      return;
    }

    if (message.method === "ui/notifications/tool-result" && message.params) {
      adoptStructuredContent(message.params.structuredContent);
      setStatus("received tool result from host");
      return;
    }
    if (message.method === "ui/notifications/tool-input") {
      setStatus("received tool input");
      return;
    }
    if (message.method === "ui/notifications/host-context-changed" && message.params) {
      applyTheme(message.params.hostContext || message.params);
      return;
    }
    if (message.id !== undefined && message.method === "ui/resource-teardown") {
      respond(message.id, {});
      return;
    }
    if (message.id !== undefined && message.method === "ping") {
      respond(message.id, {});
    }
  });

  async function updateModelContext() {
    const summary = "hello-app task board: " + (tasks.join("; ") || "(empty)");
    await request("ui/update-model-context", {
      content: [{ type: "text", text: summary }],
      structuredContent: { tasks },
    });
    setStatus("board state sent to the model's next turn");
  }

  document.getElementById("add").addEventListener("click", async () => {
    const input = document.getElementById("title");
    const title = input.value.trim();
    if (!title) return;
    setStatus("calling add_task on the app server…");
    const result = await request("tools/call", { name: "add_task", arguments: { title } });
    adoptStructuredContent(result.structuredContent);
    input.value = "";
    setStatus("add_task round-trip complete");
    await updateModelContext();
  });

  document.getElementById("send").addEventListener("click", () => {
    void updateModelContext();
  });

  const resizeObserver = new ResizeObserver(() => {
    notify("ui/notifications/size-changed", { height: document.body.scrollHeight + 40 });
  });
  resizeObserver.observe(document.body);

  (async () => {
    const initResult = await request("ui/initialize", {
      appInfo: { name: "hello-app", version: "0.1.0" },
      appCapabilities: {},
      protocolVersion: "2026-01-26",
    });
    notify("ui/notifications/initialized", {});
    applyTheme(initResult && initResult.hostContext);
    renderTasks();
    setStatus("connected to " + (initResult && initResult.hostInfo ? initResult.hostInfo.name : "host"));
  })();
})();
</script>
</body>
</html>`;
}

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
