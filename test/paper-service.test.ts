import { Prisma, type PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { paperConfigSchema, json } from "../src/paper/config.js";
const market = vi.hoisted(() => ({ sessionHours: vi.fn(), liveQuotes: vi.fn() }));
const agent = vi.hoisted(() => ({ requestDecision: vi.fn() }));
vi.mock("../src/paper/market.js", () => market);
vi.mock("../src/paper/agent.js", () => agent);
import { planPaperDay, executePaperDay, reportPaperDay } from "../src/paper/service.js";
const config = paperConfigSchema.parse({ enabled: true, symbols: ["SPY"] });
let account: any, run: any, report: any;
let fills: any[];
function database() {
  const db = {
    $executeRaw: vi.fn(),
    instrument: { findMany: vi.fn(async () => [{ id: "spy", symbol: "SPY", active: true, kind: "ETF" }]) },
    analysis: { findUnique: vi.fn(async () => ({ id: "analysis1", timestamp: new Date("2026-11-13T00:00:00Z"), regime: "TREND_UP", score: 75, confidence: 75 })) },
    paperAccount: {
      upsert: vi.fn(async () => account), findUniqueOrThrow: vi.fn(async () => account),
      update: vi.fn(async ({ data }) => { account = { ...account, ...data }; return account; }),
    },
    paperRun: {
      create: vi.fn(async ({ data }) => {
        if (run) throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });
        run = { id: "run1", ...data }; return run;
      }),
      update: vi.fn(async ({ data }) => { run = { ...run, ...data }; return run; }),
      findUnique: vi.fn(async () => run), findUniqueOrThrow: vi.fn(async () => run), findMany: vi.fn(async () => run ? [run] : []),
    },
    paperFill: { create: vi.fn(async ({ data }) => { fills.push(data); return data; }), findMany: vi.fn(async () => fills.map(f => ({ ...f, fee: new Prisma.Decimal(f.fee) }))) },
    marketBar: { findFirst: vi.fn(async () => ({ close: 102 })) },
    paperReport: { findUnique: vi.fn(async () => report), upsert: vi.fn(async ({ create }) => { report = { id: "report1", ...create }; return report; }) },
  };
  return Object.assign(db, { $transaction: async (fn: any) => fn(db) }) as unknown as PrismaClient;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-16T12:30:00Z"));
  vi.stubEnv("PAPER_TRADING_JSON", JSON.stringify(config));
  account = { id: config.accountId, initialCash: new Prisma.Decimal(10000), cash: new Prisma.Decimal(10000), positions: {}, benchmark: "SPY", benchmarkStartPrice: null };
  run = null; report = null; fills = [];
  market.sessionHours.mockImplementation(async (date: string) => ["2026-11-14", "2026-11-15"].includes(date) ? null : { start: `${date}T09:30:00-05:00`, end: `${date}T16:00:00-05:00` });
  market.liveQuotes.mockImplementation(async () => ({ SPY: { bid: 100, ask: 100.1, timestamp: Date.now() } }));
  agent.requestDecision.mockResolvedValue({ action: "REBALANCE", reason: "Test", targets: [{ symbol: "SPY", weight: 0.2 }] });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
const refreshed = [{ symbol: "SPY", timestamp: new Date("2026-11-13T00:00:00Z") }];
it("persists a plan, executes once, and produces an idempotent closing report", async () => {
  const db = database();
  expect((await planPaperDay(db, refreshed)).status).toBe("READY");
  expect(run.inputs.snapshots[0].analysis.id).toBe("analysis1");
  expect((await planPaperDay(db, refreshed)).status).toBe("ALREADY_PLANNED");
  expect(agent.requestDecision).toHaveBeenCalledOnce();
  vi.setSystemTime(new Date("2026-11-16T14:35:00Z"));
  expect((await executePaperDay(db)).status).toBe("EXECUTED");
  expect(fills).toHaveLength(1); expect(account.positions.SPY.quantity).toBe(9);
  expect((await executePaperDay(db)).status).toBe("NO_READY_PLAN"); expect(fills).toHaveLength(1);
  // Mock database decimal hydration after update.
  account.cash = new Prisma.Decimal(account.cash); account.benchmarkStartPrice = new Prisma.Decimal(account.benchmarkStartPrice);
  vi.setSystemTime(new Date("2026-11-16T21:15:00Z"));
  const result: any = await reportPaperDay(db);
  expect(result.metrics.simulated).toBe(true); expect(Number(result.metrics.equity)).toBeGreaterThan(10000);
  expect(await reportPaperDay(db)).toEqual(result); expect(db.paperReport.upsert).toHaveBeenCalledOnce();
});
it("blocks planning from stale or skipped collection results", async () => {
  await expect(planPaperDay(database(), [])).rejects.toThrow("No successful");
  expect(agent.requestDecision).not.toHaveBeenCalled();
});
it("records rejected agent decisions as FAILED and never executes them", async () => {
  const db = database(); agent.requestDecision.mockResolvedValue({ action: "REBALANCE", reason: "Bad", targets: [{ symbol: "SPY", weight: 1 }] });
  await expect(planPaperDay(db, refreshed)).rejects.toThrow("policy"); expect(run.status).toBe("FAILED");
  expect((await executePaperDay(db)).status).toBe("NO_READY_PLAN"); expect(fills).toEqual([]);
});
it("blocks premarket execution and changed policies without touching the ledger", async () => {
  const db = database(); await planPaperDay(db, refreshed);
  await expect(executePaperDay(db)).rejects.toThrow("regular equity session"); expect(fills).toEqual([]);
  vi.setSystemTime(new Date("2026-11-16T14:35:00Z"));
  vi.stubEnv("PAPER_TRADING_JSON", JSON.stringify({ ...config, maxOrderDollars: 500 }));
  await expect(executePaperDay(db)).rejects.toThrow("policy changed"); expect(fills).toEqual([]);
});
it("does nothing when disabled or the exchange is closed", async () => {
  vi.stubEnv("PAPER_TRADING_JSON", '{"enabled":false,"symbols":["SPY"]}');
  expect((await planPaperDay(database(), refreshed)).status).toBe("DISABLED");
  expect((await executePaperDay(database())).status).toBe("DISABLED");
  vi.stubEnv("PAPER_TRADING_JSON", JSON.stringify(config)); market.sessionHours.mockResolvedValue(null);
  expect((await planPaperDay(database(), refreshed)).status).toBe("CLOSED");
  expect(agent.requestDecision).not.toHaveBeenCalled();
});
it("does not execute against an absent plan", async () => {
  expect((await executePaperDay(database())).status).toBe("NO_READY_PLAN"); expect(market.liveQuotes).not.toHaveBeenCalled();
});
