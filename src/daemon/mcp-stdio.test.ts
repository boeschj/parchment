import { describe, it } from "bun:test";

// src/daemon/mcp-stdio.ts starts an MCP stdio server as a side effect of
// module import (it constructs a McpServer + StdioServerTransport at the top
// level) and exports no helper functions. There is nothing importable to
// unit test, and importing the file at all would attempt to start a server
// during the test run. Skipped per task instructions rather than worked
// around — see src/daemon/mcp-stdio.ts.
describe.skip("src/daemon/mcp-stdio.ts", () => {
  it("is intentionally not imported or tested — see the comment above", () => {});
});
