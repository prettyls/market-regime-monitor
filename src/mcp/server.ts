import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { proposalSchema } from "../trading/policy.js";

export interface AgentApiConfig { apiUrl: string; agentToken: string }
export class McpConfigError extends Error {}
export function validateConfig(config: AgentApiConfig): AgentApiConfig {
  let url: URL;
  try { url = new URL(config.apiUrl); }
  catch { throw new McpConfigError("MCP_API_URL must be a valid HTTP or HTTPS origin"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      !(url.protocol === "https:" || (local && url.protocol === "http:"))) {
    throw new McpConfigError("MCP_API_URL must be an HTTPS origin or localhost HTTP origin without credentials, path, query or fragment");
  }
  if (config.agentToken.length < 32 || /\s/.test(config.agentToken)) throw new McpConfigError("MCP_AGENT_TOKEN must be an agent token of at least 32 characters");
  return { apiUrl: url.origin, agentToken: config.agentToken };
}

export function createTradingMcpServer(config: AgentApiConfig, request: typeof fetch = fetch) {
  const { apiUrl, agentToken } = validateConfig(config);
  const server = new McpServer({ name: "market-regime-monitor", version: "0.1.0" }, {
    instructions: "Trading is SIMULATION ONLY. Read context and policy before proposing a trade. SIMULATED does not mean a broker order or fill. Reuse the exact proposal and idempotency key after an uncertain result. Source analysis may differ from the trading instrument. Never request Schwab credentials.",
  });
  async function call(path: string, body?: unknown) {
    try {
      const response = await request(`${apiUrl}${path}`, {
        method: body === undefined ? "GET" : "POST", redirect: "error",
        headers: { Authorization: `Bearer ${agentToken}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        const advice: Record<number, string> = {
          400: "Invalid proposal input.", 401: "Check the MCP agent token.", 403: "Agent lacks the required API scope.",
          404: "Analysis or proposal not found, or proposal belongs to another agent.",
          409: "Idempotency conflict or concurrent request; retry the identical request with the same key.",
          422: "Policy rejected the proposal; check registered EQUITY/ETF symbol, allowlist, analysis age and budgets.",
          502: "Schwab upstream request failed; check API server diagnostics and trading authorization.",
          503: "Service or Schwab authorization unavailable.",
        };
        return { isError: true, content: [{ type: "text" as const, text: `Agent API HTTP ${response.status}. ${advice[response.status] ?? "Check API server diagnostics."}` }] };
      }
      const data: unknown = await response.json();
      return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
    } catch {
      return { isError: true, content: [{ type: "text" as const, text: "Agent API connection or response failed. For a proposal, the outcome may be uncertain: retry the exact request with the same idempotency key." }] };
    }
  }
  const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  server.registerTool("get_trading_context", { description: "Read saved market analyses, current simulation policy and mode. Analysis confidence is heuristic, not a probability.", inputSchema: z.object({}).strict(), annotations: readAnnotations }, () => call("/api/v1/agent/context"));
  server.registerTool("get_portfolio", { description: "Read Schwab trading accounts, balances and positions. Contains private financial data.", inputSchema: z.object({}).strict(), annotations: readAnnotations }, () => call("/api/v1/agent/portfolio/accounts"));
  server.registerTool("get_paper_portfolio", { description: "Read the simulated portfolio ledger, recent agent decisions and closing performance reports. These are hypothetical results, not actual broker positions.", inputSchema: z.object({}).strict(), annotations: readAnnotations }, () => call("/api/v1/agent/portfolio/paper"));
  server.registerTool("get_recent_orders", { description: "Read actual Schwab broker orders from the trailing seven days. Simulations are separate records.", inputSchema: z.object({}).strict(), annotations: readAnnotations }, () => call("/api/v1/agent/portfolio/orders"));
  server.registerTool("propose_trade", {
    description: "Persist a simulated BUY LIMIT DAY proposal. Only registered EQUITY/ETF targets allowed by server policy. No broker order is submitted. Choose a unique idempotency key for each decision and reuse the exact request on retries. The simulator assumes the supplied limit price without validating quotes or fills.",
    inputSchema: proposalSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, input => call("/api/v1/trade-proposals", input));
  server.registerTool("get_trade_proposal", { description: "Read one saved simulation owned by this agent.", inputSchema: z.object({ id: z.string().min(1).max(128) }).strict(), annotations: readAnnotations }, ({ id }) => call(`/api/v1/trade-proposals/${encodeURIComponent(id)}`));
  return server;
}
