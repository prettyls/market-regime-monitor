import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proposalSchema, policySchema, validatePolicy } from "../src/trading/policy.js";
import { registerTradingRoutes } from "../src/trading/routes.js";

const input = { analysisId: "a1", strategyId: "test", symbol: "spy", side: "BUY", quantity: 2, orderType: "LIMIT", limitPrice: "100.0001", timeInForce: "DAY", reason: "Test proposal", idempotencyKey: "request-123" };
const policy = { version: "v1", enabled: true, allowedSymbols: ["SPY"], maxOrderDollars: 1000, maxDailyDollars: 5000, maxAnalysisAgeHours: 96 };
afterEach(() => vi.unstubAllEnvs());

describe("trading boundary", () => {
  it("rejects unsupported order types, sells, and extra broker fields", () => {
    for (const patch of [{ side: "SELL" }, { orderType: "MARKET" }, { quantity: 0 }, { accountId: "live" }, { limitPrice: "1e5" }]) {
      expect(proposalSchema.safeParse({ ...input, ...patch }).success).toBe(false);
    }
  });
  it("enforces pause, symbols, size and freshness independently", () => {
    const order = proposalSchema.parse(input);
    expect(() => validatePolicy(order, policy, new Date())).not.toThrow();
    for (const patch of [{ enabled: false }, { allowedSymbols: ["QQQ"] }, { maxOrderDollars: 200 }]) {
      expect(() => validatePolicy(order, { ...policy, ...patch }, new Date())).toThrow();
    }
    expect(() => validatePolicy(order, policy, new Date(0))).toThrow("stale");
    expect(() => validatePolicy(order, policy, new Date(Date.now() + 60000))).toThrow("future");
    expect(policySchema.safeParse({ ...policy, maxDailyDollars: -1 }).success).toBe(false);
  });
  it("denies missing credentials and insufficient scopes before database access", async () => {
    vi.stubEnv("AGENT_CREDENTIALS_JSON", JSON.stringify([{ id: "reader", token: "x".repeat(32), scopes: ["analysis:read"] }]));
    const app = Fastify(); registerTradingRoutes(app, {} as PrismaClient);
    expect((await app.inject({ url: "/api/v1/agent/context" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/v1/trade-proposals", headers: { authorization: `Bearer ${"x".repeat(32)}` }, payload: input })).statusCode).toBe(403);
    await app.close();
  });
  it("persists one snapshot and audit event, replays retries, rejects changed payloads", async () => {
    vi.stubEnv("AGENT_CREDENTIALS_JSON", JSON.stringify([{ id: "agent", token: "x".repeat(32), scopes: ["trades:propose"] }]));
    vi.stubEnv("TRADING_POLICY_JSON", JSON.stringify(policy));
    let saved: any;
    const tx = {
      $executeRaw: vi.fn(),
      instrument: { findUnique: vi.fn(async () => ({ symbol: "SPY", kind: "ETF" })) },
      tradeProposal: {
        findUnique: vi.fn(async () => saved), findMany: vi.fn(async () => []),
        create: vi.fn(async ({ data }) => { saved = { id: "p1", ...data }; return saved; }),
      },
      analysis: { findUnique: vi.fn(async () => ({ id: "a1", timestamp: new Date(), instrument: { symbol: "VIX", config: {} } })) },
      tradingAuditEvent: { create: vi.fn() },
    };
    const db = { $transaction: async (fn: any) => fn(tx) } as unknown as PrismaClient;
    const app = Fastify(); registerTradingRoutes(app, db);
    const send = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/v1/trade-proposals", headers: { authorization: `Bearer ${"x".repeat(32)}` }, payload });
    const first = await send(input);
    expect(first.statusCode).toBe(201);
    expect(first.json().simulation.brokerOrderSubmitted).toBe(false);
    expect(first.json().snapshot.analysis.id).toBe("a1");
    expect((await send(input)).statusCode).toBe(200);
    expect((await send({ ...input, quantity: 3 })).statusCode).toBe(409);
    expect(tx.tradeProposal.create).toHaveBeenCalledTimes(1);
    expect(tx.tradingAuditEvent.create).toHaveBeenCalledTimes(1);
    await app.close();
  });
  it.each(["EQUITY", "ETF", "INDEX", "RATE", "COMMODITY", "OTHER", null])("checks the target instrument type: %s", async kind => {
    vi.stubEnv("AGENT_CREDENTIALS_JSON", JSON.stringify([{ id: "agent", token: "x".repeat(32), scopes: ["trades:propose"] }]));
    vi.stubEnv("TRADING_POLICY_JSON", JSON.stringify(policy));
    const create = vi.fn(async ({ data }) => ({ id: "p1", ...data }));
    const tx = {
      $executeRaw: vi.fn(),
      instrument: { findUnique: vi.fn(async () => kind ? { symbol: "SPY", kind } : null) },
      analysis: { findUnique: async () => ({ id: "a1", timestamp: new Date(), instrument: { symbol: "VIX", kind: "INDEX" } }) },
      tradeProposal: { findUnique: async () => null, findMany: async () => [], create },
      tradingAuditEvent: { create: vi.fn() },
    };
    const app = Fastify();
    registerTradingRoutes(app, { $transaction: async (fn: any) => fn(tx) } as unknown as PrismaClient);
    const response = await app.inject({ method: "POST", url: "/api/v1/trade-proposals", headers: { authorization: `Bearer ${"x".repeat(32)}` }, payload: input });
    const allowed = kind === "EQUITY" || kind === "ETF";
    expect(response.statusCode).toBe(allowed ? 201 : 422);
    expect(tx.instrument.findUnique).toHaveBeenCalledWith({ where: { symbol: "SPY" } });
    expect(create).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(tx.tradingAuditEvent.create).toHaveBeenCalledTimes(allowed ? 1 : 0);
    if (allowed) expect(response.json().snapshot.tradingInstrument.kind).toBe(kind);
    await app.close();
  });
  it("blocks proposals when the shared daily budget is exhausted", async () => {
    vi.stubEnv("AGENT_CREDENTIALS_JSON", JSON.stringify([{ id: "agent", token: "x".repeat(32), scopes: ["trades:propose"] }]));
    vi.stubEnv("TRADING_POLICY_JSON", JSON.stringify(policy));
    const { Prisma } = await import("@prisma/client");
    const create = vi.fn();
    const tx = { $executeRaw: vi.fn(), instrument: { findUnique: async () => ({ symbol: "SPY", kind: "ETF" }) }, tradeProposal: { findUnique: async () => null, findMany: async () => [{ quantity: 1, limitPrice: new Prisma.Decimal(4900) }], create }, analysis: { findUnique: async () => ({ timestamp: new Date(), instrument: {} }) } };
    const app = Fastify(); registerTradingRoutes(app, { $transaction: async (fn: any) => fn(tx) } as unknown as PrismaClient);
    const result = await app.inject({ method: "POST", url: "/api/v1/trade-proposals", headers: { authorization: `Bearer ${"x".repeat(32)}` }, payload: input });
    expect(result.statusCode).toBe(422);
    expect(create).not.toHaveBeenCalled();
    await app.close();
  });
});
