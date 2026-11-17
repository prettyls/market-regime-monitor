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
  const read = vi.fn(async () => []);
  registerTradingRoutes(app, { analysis: { findMany: read } } as unknown as PrismaClient);
  registerMcpHttp(app);
  await app.ready();
  return { app, read };
}
const headers = { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream", "content-type": "application/json" };
it("serves stateless discovery and delegates tools through scoped API auth", async () => {
  const { app, read } = await setup();
  try {
    const init = await app.inject({ method: "POST", url: "/mcp", headers, payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } } });
    expect(init.statusCode).toBe(200);
    expect(init.json().result.serverInfo.name).toBe("market-regime-monitor");
    const tools = await app.inject({ method: "POST", url: "/mcp", headers, payload: { jsonrpc: "2.0", id: 2, method: "tools/list" } });
    expect(tools.json().result.tools).toHaveLength(6);
    const call = (name: string) => app.inject({ method: "POST", url: "/mcp", headers, payload: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: {} } } });
    expect((await call("get_trading_context")).json().result.isError).not.toBe(true);
    expect(read).toHaveBeenCalledOnce();
    expect((await call("get_portfolio")).json().result.isError).toBe(true);
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
