import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { afterEach, expect, it, vi } from "vitest";
import { registerAccess } from "../src/access.js";
import { registerTradingRoutes } from "../src/trading/routes.js";
import { registerMcpHttp } from "../src/mcp/http.js";
const token = "a".repeat(32);
afterEach(() => vi.unstubAllEnvs());
async function setup(role = "admin", scopes = ["analysis:read"]) {
  vi.stubEnv("AGENT_CREDENTIALS_JSON", JSON.stringify([{ id: "test", token, role, scopes }]));
  const app = Fastify(); registerAccess(app);
  const read = vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]);
  vi.stubEnv("TRADING_POLICY_JSON", undefined);
  const list = vi.fn(async () => [{ symbol: "QQQ" }, { symbol: "SPY" }]);
  const downloadHistory = vi.fn(async () => [
    { timestamp: new Date("2026-11-06T14:30:00Z"), open: 10, high: 12, low: 9, close: 11, volume: 0 },
    { timestamp: new Date("2026-11-06T14:35:00Z"), open: 11, high: 13, low: 10, close: 12, volume: 200 },
    { timestamp: new Date("2026-11-06T14:40:00Z"), open: 12, high: 14, low: 11, close: 13, volume: 250 },
    { timestamp: new Date("2026-11-06T14:45:00Z"), open: 13, high: 15, low: 12, close: 14 },
  ]);
  registerTradingRoutes(app, { analysis: { findMany: read }, instrument: { findMany: list } } as unknown as PrismaClient, undefined, { downloadHistory });
  registerMcpHttp(app);
  await app.ready();
  return { app, read, list, downloadHistory };
}
const headers = { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream", "content-type": "application/json" };
it("serves stateless discovery and delegates tools through scoped API auth", async () => {
  const { app, read, list, downloadHistory } = await setup();
  try {
    const init = await app.inject({ method: "POST", url: "/mcp", headers, payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } } });
    expect(init.statusCode).toBe(200);
    expect(init.json().result.serverInfo.name).toBe("market-regime-monitor");
    const tools = await app.inject({ method: "POST", url: "/mcp", headers, payload: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
    const discoveredTools = tools.json().result.tools;
    expect(discoveredTools).toHaveLength(10);
    const contextTool = discoveredTools.find((tool: { name: string }) => tool.name === "get_trading_context");
    expect(contextTool?.inputSchema).toMatchObject({
      type: "object",
      properties: { symbol: { type: "string", description: expect.stringContaining("latest saved analysis") } },
    });
    expect(contextTool?.inputSchema.required ?? []).not.toContain("symbol");
    const call = (name: string, args = {}) => app.inject({ method: "POST", url: "/mcp", headers, payload: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: args } } });
    const paper = (await call("get_trading_skill", { workflow: "paper" })).json().result;
    const paperSkill = JSON.parse(paper.content[0].text);
    expect(paperSkill).toMatchObject({ workflow: "paper", name: "market-regime-paper-trading", version: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(paperSkill.files.map((file: { path: string }) => file.path)).toEqual(["SKILL.md", "references/workflows.md", "references/revisions.md"]);
    expect(paperSkill.files[0].text).toContain("get_paper_portfolio");
    const live = (await call("get_trading_skill", { workflow: "live" })).json().result;
    expect(JSON.parse(live.content[0].text).files).toEqual([{ path: "SKILL.md", text: expect.stringContaining("get_live_trading_permission") }]);
    expect((await call("get_trading_skill", { workflow: "../paper" })).json().result.isError).toBe(true);
    const context = (await call("get_trading_context")).json().result;
    expect(JSON.parse(context.content[0].text).policy).toMatchObject({ enabled: false, allowedSymbols: ["QQQ", "SPY"] });
    expect(list).toHaveBeenCalledWith({
      where: { active: true, kind: { in: ["EQUITY", "ETF"] } },
      orderBy: { symbol: "asc" }, select: { symbol: true },
    });
    expect(read).toHaveBeenLastCalledWith({
      orderBy: { timestamp: "desc" }, take: 100,
      include: { instrument: { select: { symbol: true, kind: true } } },
    });
    const latest = { id: "latest-vix", instrument: { symbol: "VIX", kind: "INDEX" } };
    read.mockResolvedValueOnce([latest]);
    const filtered = (await call("get_trading_context", { symbol: " vix " })).json().result;
    expect(JSON.parse(filtered.content[0].text)).toEqual({
      ...JSON.parse(context.content[0].text), analyses: [latest],
    });
    expect(read).toHaveBeenLastCalledWith({
      where: { instrument: { symbol: "VIX" } },
      orderBy: { timestamp: "desc" }, take: 1,
      include: { instrument: { select: { symbol: true, kind: true } } },
    });
    const missing = (await call("get_trading_context", { symbol: "UNKNOWN" })).json().result;
    expect(JSON.parse(missing.content[0].text).analyses).toEqual([]);
    expect((await call("get_trading_context", { symbol: " " })).json().result.isError).toBe(true);
    expect(read).toHaveBeenCalledTimes(3);
    const bars = (await call("get_schwab_bars", { symbol: "SPY", interval: "5m" })).json().result;
    expect(JSON.parse(bars.content[0].text)).toMatchObject({
      provider: "charles_schwab", symbol: "SPY", interval: "5m",
      bars: [
        { volume: 0, volumeChange: null, volumeChangePct: null },
        { volume: 200, volumeChange: 200, volumeChangePct: null },
        { volume: 250, volumeChange: 50, volumeChangePct: 25 },
        { volumeChange: null, volumeChangePct: null },
      ],
    });
    expect(downloadHistory).toHaveBeenCalledWith("SPY", undefined, undefined, "5m", true);
    expect((await call("get_portfolio")).json().result.isError).toBe(true);
    expect((await call("get_live_trading_permission")).json().result.isError).toBe(true);
  } finally { await app.close(); }
});
it("rejects invalid tokens, non-admin roles, and cross-origin requests", async () => {
  const { app, read } = await setup("user");
  try {
    expect((await app.inject({ method: "POST", url: "/mcp", payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/mcp", headers, payload: {} })).statusCode).toBe(403);
    expect(read).not.toHaveBeenCalled();
  } finally { await app.close(); }
  const admin = await setup();
  try {
    expect((await admin.app.inject({ method: "POST", url: "/mcp", headers: { ...headers, origin: "https://evil.example" }, payload: {} })).statusCode).toBe(403);
    expect((await admin.app.inject({ url: "/mcp", headers })).statusCode).toBe(405);
  } finally { await admin.app.close(); }
});

it("requires analysis:read to fetch deployed trading skills", async () => {
  const { app } = await setup("admin", ["portfolio:read"]);
  try {
    const response = await app.inject({
      method: "POST", url: "/mcp", headers,
      payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params: {
        name: "get_trading_skill", arguments: { workflow: "paper" },
      } },
    });
    expect(response.json().result).toMatchObject({
      isError: true, content: [{ type: "text", text: expect.stringContaining("403") }],
    });
  } finally { await app.close(); }
});
