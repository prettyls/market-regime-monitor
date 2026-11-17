import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTradingMcpServer, McpConfigError } from "./mcp/server.js";

// No .env auto-load: this process needs only the agent token, not broker secrets.
try {
  const server = createTradingMcpServer({ apiUrl: process.env.MCP_API_URL ?? "http://localhost:3000", agentToken: process.env.MCP_AGENT_TOKEN ?? "" });
  const shutdown = async () => { await server.close(); process.exit(0); };
  process.once("SIGINT", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(error instanceof McpConfigError
    ? `MCP startup failed: ${error.message}. Set these variables in the MCP host child-process environment; .env is not loaded.`
    : "MCP startup failed while connecting the stdio transport.");
  process.exitCode = 1;
}
