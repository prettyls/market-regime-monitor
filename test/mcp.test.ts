import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { createTradingMcpServer, validateConfig } from "../src/mcp/server.js";
const config = { apiUrl: "http://localhost:3000", agentToken: "a".repeat(32) };
const proposal = { analysisId: "analysis-1", strategyId: "test", symbol: "SPY", side: "BUY", quantity: 1, orderType: "LIMIT", limitPrice: "100.00", timeInForce: "DAY", reason: "Test", idempotencyKey: "test-key-001" };
async function setup(request: typeof fetch) {
  const server = createTradingMcpServer(config, request);
  const client = new Client({ name: "test-agent", version: "1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
describe("MCP agent adapter", () => {
  it("discovers all tools through the MCP protocol", async () => {
    const { client, close } = await setup(vi.fn());
    try {
      const result = await client.listTools();
      expect(result.tools.map(t => t.name)).toEqual(["get_trading_skill", "get_trading_context", "get_schwab_bars", "get_portfolio", "get_paper_portfolio", "get_recent_orders", "propose_trade", "get_trade_proposal", "get_live_trading_permission", "place_live_order"]);
      expect(result.tools.find(t => t.name === "propose_trade")?.annotations?.readOnlyHint).toBe(false);
    } finally { await close(); }
  });
  it("forwards all tools with agent authorization and fixed routes", async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ status: "SIMULATED" }));
    const { client, close } = await setup(request);
    try {
      for (const [name, args, path] of [
        ["get_trading_context", {}, "/api/v1/agent/context"],
        ["get_portfolio", {}, "/api/v1/agent/portfolio/accounts"],
        ["get_paper_portfolio", {}, "/api/v1/agent/portfolio/paper"],
        ["get_recent_orders", {}, "/api/v1/agent/portfolio/orders"],
        ["propose_trade", proposal, "/api/v1/trade-proposals"],
        ["get_trade_proposal", { id: "proposal-1" }, "/api/v1/trade-proposals/proposal-1"],
        ["get_trading_skill", { workflow: "live" }, "/api/v1/agent/skills/live"],
        ["get_schwab_bars", { symbol: "spy", interval: "5m" }, "/api/v1/agent/bars/SPY?interval=5m"],
      ] as const) {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError).not.toBe(true);
        expect(request).toHaveBeenLastCalledWith(`${config.apiUrl}${path}`, expect.objectContaining({ redirect: "error", headers: expect.objectContaining({ Authorization: `Bearer ${config.agentToken}` }) }));
      }
      expect(request.mock.calls[4]?.[1]?.body).toBe(JSON.stringify(proposal));
    } finally { await close(); }
  });
  it("rejects invalid proposals before reaching the API", async () => {
    const request = vi.fn<typeof fetch>(); const { client, close } = await setup(request);
    try {
      const result = await client.callTool({ name: "propose_trade", arguments: { ...proposal, side: "SELL" } });
      expect(result.isError).toBe(true); expect(request).not.toHaveBeenCalled();
    } finally { await close(); }
  });
  it("reports policy errors without leaking upstream bodies", async () => {
    const { client, close } = await setup(vi.fn(async () => new Response("private upstream body", { status: 422 })));
    try {
      const result = await client.callTool({ name: "propose_trade", arguments: proposal });
      expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain("422");
      expect(JSON.stringify(result)).not.toContain("private upstream body");
    } finally { await close(); }
  });
  it("marks uncertain outcomes as errors with safe retry guidance", async () => {
    const { client, close } = await setup(vi.fn().mockRejectedValue(new Error("private token")));
    try {
      const result = await client.callTool({ name: "propose_trade", arguments: proposal });
      expect(result.isError).toBe(true); expect(JSON.stringify(result)).toContain("same idempotency key");
      expect(JSON.stringify(result)).not.toContain("private token");
    } finally { await close(); }
  });
  it("requires secure destinations and credentials", () => {
    for (const apiUrl of ["http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com/?key=x", "file:///tmp/test"]) {
      expect(() => validateConfig({ ...config, apiUrl })).toThrow();
    }
    expect(() => validateConfig({ ...config, agentToken: "" })).toThrow();
    expect(validateConfig({ ...config, apiUrl: "https://example.com" }).apiUrl).toBe("https://example.com");
  });
});
