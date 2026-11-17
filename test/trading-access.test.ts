import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { afterEach, expect, it, vi } from "vitest";
import { registerAccess } from "../src/access.js";
import { registerTradingRoutes } from "../src/trading/routes.js";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const token = "a".repeat(32);
const targets = [
  ["GET", "/api/v1/agent/context"], ["GET", "/api/v1/agent/portfolio/accounts"],
  ["GET", "/api/v1/agent/portfolio/orders"], ["GET", "/api/v1/agent/portfolio/paper"], ["GET", "/api/v1/trade-proposals/test"],
  ["POST", "/api/v1/trade-proposals"],
] as const;
it.each([undefined, "user", "admin"])("enforces admin role %s on all protected routes before work", async role => {
  vi.stubEnv("AGENT_CREDENTIALS_JSON", JSON.stringify([{ id: "test", token, ...(role ? { role } : {}), scopes: ["analysis:read", "portfolio:read", "trades:propose"] }]));
  vi.stubEnv("ADMIN_PASSWORD", "b".repeat(32));
  const work = vi.fn(async () => []);
  const portfolio = vi.fn(async () => Response.json([])); vi.stubGlobal("fetch", portfolio);
  vi.stubEnv("SCHWAB_TRADE_ACCESS_TOKEN", "private");
  const app = Fastify(); registerAccess(app);
  registerTradingRoutes(app, { analysis: { findMany: work } } as unknown as PrismaClient);
  try {
    for (const [method, url] of targets) {
      for (const authorization of [undefined, "Bearer invalid", `Basic ${Buffer.from(`admin:${"b".repeat(32)}`).toString("base64")}`]) {
        const result = await app.inject({ method, url, headers: authorization ? { authorization } : {} });
        expect(result.statusCode).toBe(401);
        expect(result.headers["cache-control"]).toBe("no-store");
      }
      if (role !== "admin") {
        const result = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` } });
        expect(result.statusCode).toBe(403);
      }
    }
    expect(work).not.toHaveBeenCalled(); expect(portfolio).not.toHaveBeenCalled();
    if (role === "admin") {
      const result = await app.inject({ url: "/api/v1/agent/context", headers: { authorization: `Bearer ${token}` } });
      expect(result.statusCode).toBe(200); expect(work).toHaveBeenCalledOnce();
    }
  } finally { await app.close(); }
});
