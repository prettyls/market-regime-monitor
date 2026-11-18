import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { afterEach, expect, it, vi } from "vitest";
import { registerAccess } from "../src/access.js";
import { liveOrderConfig } from "../src/trading/policy.js";
import { readAgentCredentials, registerTradingRoutes } from "../src/trading/routes.js";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const token = "a".repeat(32);
const targets = [
  ["GET", "/api/v1/agent/context"], ["GET", "/api/v1/agent/portfolio/accounts"],
  ["GET", "/api/v1/agent/portfolio/orders"], ["GET", "/api/v1/agent/portfolio/paper"], ["GET", "/api/v1/trade-proposals/test"],
  ["POST", "/api/v1/trade-proposals"],
  ["GET", "/api/v1/agent/live-orders/permission"], ["POST", "/api/v1/agent/live-orders"],
] as const;
it.each([undefined, "user", "admin"])("enforces admin role %s on all protected routes before work", async role => {
  vi.stubEnv("AGENT_CREDENTIALS_JSON", JSON.stringify([{ id: "test", token, ...(role ? { role } : {}), scopes: ["analysis:read", "portfolio:read", "trades:propose"] }]));
  vi.stubEnv("AGENT_LIVE_TRADING_ENABLED", "false");
  vi.stubEnv("ADMIN_PASSWORD", "b".repeat(32));
  const work = vi.fn(async () => []);
  const portfolio = vi.fn(async () => Response.json([])); vi.stubGlobal("fetch", portfolio);
  vi.stubEnv("SCHWAB_TRADE_ACCESS_TOKEN", "private");
  const app = Fastify(); registerAccess(app);
  const instruments = vi.fn(async () => []);
  registerTradingRoutes(app, { analysis: { findMany: work }, instrument: { findMany: instruments } } as unknown as PrismaClient);
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
    expect(instruments).not.toHaveBeenCalled();
    if (role === "admin") {
      const result = await app.inject({ url: "/api/v1/agent/context", headers: { authorization: `Bearer ${token}` } });
      expect(result.statusCode).toBe(200); expect(work).toHaveBeenCalledOnce();
      const denied = await app.inject({ method: "POST", url: "/api/v1/agent/live-orders", headers: { authorization: `Bearer ${token}` } });
      expect(denied.statusCode).toBe(403); expect(denied.json().scope).toBe("trades:execute");
    }
  } finally { await app.close(); }
});

it.each([
  ["false", "BUY"],
  ["false", "SELL"],
  ["true", "BUY"],
  ["true", "SELL"],
])("with live trading set to %s, gates and deduplicates %s orders", async (enabled, side) => {
  vi.stubEnv("AGENT_CREDENTIALS_JSON", JSON.stringify([{ id: "live", token, role: "admin", scopes: ["trades:execute"] }]));
  vi.stubEnv("AGENT_LIVE_TRADING_ENABLED", enabled);
  vi.stubEnv("SCHWAB_TRADE_ACCOUNT_HASH", "test-account");
  vi.stubEnv("AGENT_LIVE_TRADING_JSON", JSON.stringify({
    maxOrderDollars: 200, maxDailyDollars: 400,
    ...(side === "SELL" ? { allowedSymbols: ["AAPL"], accountHash: "obsolete-account" } : {}),
  }));
  vi.stubEnv("SCHWAB_TRADE_TOKEN_STORE", "env");
  vi.stubEnv("SCHWAB_TRADE_ACCESS_TOKEN", "mock-schwab-token");
  const broker = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 201, headers: { location: "/orders/7123" } }));
  vi.stubGlobal("fetch", broker);
  let persisted: { id: string; createdAt: Date; status: string; requestHash: string } | undefined;
  const instruments = new Map([
    ["AAPL", { active: true, kind: "EQUITY" }],
    ["SPY", { active: true, kind: "ETF" }],
    ["VIX", { active: true, kind: "INDEX" }],
    ["INACTIVE", { active: false, kind: "ETF" }],
  ]);
  const tx = {
    $executeRaw: vi.fn(),
    instrument: {
      findUnique: async ({ where }: { where: { symbol: string; active: boolean; kind: { in: string[] } } }) => {
        const instrument = instruments.get(where.symbol);
        return instrument?.active === where.active && where.kind.in.includes(instrument.kind) ? instrument : null;
      },
    },
    liveOrder: {
      findUnique: async () => persisted,
      aggregate: async () => ({ _sum: { notional: null } }),
      create: async ({ data }: { data: { status: string; requestHash: string } }) => {
        persisted = { id: "receipt", createdAt: new Date(), status: data.status, requestHash: data.requestHash };
        return { id: persisted.id };
      },
    },
  };
  const app = Fastify();
  registerAccess(app);
  registerTradingRoutes(app, {
    instrument: { findMany: async () => [{ symbol: "AAPL" }, { symbol: "SPY" }] },
    $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx),
    liveOrder: {
      update: async ({ data }: { data: { status: string; brokerOrderId: string } }) => {
        persisted = { ...persisted!, ...data };
        return { id: persisted.id, ...data };
      },
    },
  } as unknown as PrismaClient);
  try {
    const headers = { authorization: `Bearer ${token}` };
    const permission = await app.inject({ url: "/api/v1/agent/live-orders/permission", headers });
    expect(permission.json().enabled).toBe(enabled === "true");
    if (enabled === "true") expect(permission.json().allowedSymbols).toEqual(["AAPL", "SPY"]);
    const payload = {
      symbol: side === "BUY" ? "AAPL" : "SPY", side, quantity: 1, orderType: "LIMIT", limitPrice: "100.00",
      timeInForce: "DAY", reason: "Test mock order", idempotencyKey: "live-test-key",
    };
    const request = { method: "POST" as const, url: "/api/v1/agent/live-orders", headers, payload };
    if (enabled === "true") {
      for (const symbol of ["VIX", "INACTIVE", "UNREGISTERED"]) {
        const denied = await app.inject({ ...request, payload: { ...payload, symbol } });
        expect(denied.statusCode).toBe(422);
      }
      expect(broker).not.toHaveBeenCalled();
    }
    const submitted = await app.inject(request);
    if (enabled === "false") {
      expect(submitted.statusCode).toBe(403);
      expect(broker).not.toHaveBeenCalled();
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      return;
    }
    expect(submitted.statusCode).toBe(201);
    expect(submitted.json()).toMatchObject({ status: "SUBMITTED", brokerOrderId: "7123" });
    const replay = await app.inject(request);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ status: "SUBMITTED", brokerOrderId: "7123" });
    expect(replay.json()).not.toHaveProperty("requestHash");
    expect((await app.inject({ ...request, payload: { ...payload, side: side === "BUY" ? "SELL" : "BUY" } })).statusCode).toBe(409);
    expect(broker).toHaveBeenCalledOnce();
    const [url, options] = broker.mock.calls[0]!;
    expect(url).toBe("https://api.schwabapi.com/trader/v1/accounts/test-account/orders");
    expect(options.method).toBe("POST");
    expect(JSON.parse(String(options.body))).toMatchObject({
      orderLegCollection: [{ instruction: side, quantity: 1, instrument: { symbol: payload.symbol } }],
    });
  } finally { await app.close(); }
});

it("omits malformed credential contents from configuration errors", () => {
  vi.stubEnv("AGENT_CREDENTIALS_JSON", "private-test-credential");
  expect(() => readAgentCredentials()).toThrow(/^Invalid AGENT_CREDENTIALS_JSON$/);
});


it("requires the shared account selector when live trading is enabled", () => {
  vi.stubEnv("AGENT_LIVE_TRADING_ENABLED", "true");
  vi.stubEnv("SCHWAB_TRADE_ACCOUNT_HASH", "");
  vi.stubEnv("AGENT_LIVE_TRADING_JSON", '{"accountHash":"legacy","maxOrderDollars":200,"maxDailyDollars":400}');
  expect(() => liveOrderConfig()).toThrow("Invalid or missing SCHWAB_TRADE_ACCOUNT_HASH for live trading");
});
