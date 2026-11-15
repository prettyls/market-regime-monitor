import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { evaluatePerformance, reviewConfigSchema, reviewPaperRules } from "../src/paper/review.js";
import { paperConfigSchema } from "../src/paper/config.js";
import { tradingRules } from "../src/paper/rules.js";
const agent = vi.hoisted(() => ({ requestStructuredAgent: vi.fn() }));
vi.mock("../src/paper/agent.js", () => agent);
const cfg = reviewConfigSchema.parse({ enabled: true, windowSessions: 5 });
const reports = (values: number[]) => values.map((equity, i) => ({ session: `2026-11-${String(10 + i).padStart(2, "0")}`, metrics: { equity: String(equity), benchmarkReturn: i * 0.01 } }));
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-15T22:00:00Z")); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
it("uses N+1 reports to measure N return intervals", () => {
  expect(evaluatePerformance(reports([100, 99]), cfg)).toMatchObject({ ready: false, reason: "INSUFFICIENT_HISTORY" });
  const result = evaluatePerformance(reports([100, 102, 99, 97, 95, 94]), cfg);
  expect(result).toMatchObject({ ready: true, triggers: ["RETURN_BELOW_EXPECTATION", "BENCHMARK_UNDERPERFORMANCE", "DRAWDOWN_EXCEEDED"] });
  if (result.ready) { expect(result.totalReturn).toBeCloseTo(-0.06); expect(result.drawdown).toBeCloseTo(1 - 94 / 102); }
});
it("keeps successful performance unchanged and requires benchmark evidence", () => {
  expect(evaluatePerformance(reports([100, 102, 104, 106, 108, 110]), cfg)).toMatchObject({ triggers: [] });
  const data = reports([100, 100, 100, 100, 100, 100]); data[0]!.metrics.benchmarkReturn = null as unknown as number;
  expect(evaluatePerformance(data, cfg)).toMatchObject({ reason: "BENCHMARK_UNAVAILABLE" });
});
function db() {
  const paper = paperConfigSchema.parse({ enabled: true, symbols: ["SPY"] });
  vi.stubEnv("PAPER_TRADING_JSON", JSON.stringify(paper)); vi.stubEnv("PAPER_REVIEW_JSON", JSON.stringify(cfg));
  const database = {
    paperReport: { findMany: vi.fn(async () => reports([100, 102, 99, 97, 95, 94]).reverse()), count: vi.fn(async () => 1) },
    paperRun: { findMany: vi.fn(async () => [{ id: "run", session: "2026-11-15", status: "EXECUTED", inputs: { config: paper, rules: tradingRules }, decision: {}, execution: {} }]) },
    paperRuleReview: { findUnique: vi.fn(async () => null as any), findFirst: vi.fn(async () => null as any), create: vi.fn(async ({ data }) => ({ id: "review1", ...data })), update: vi.fn(async ({ data }) => ({ id: "review1", ...data })) },
  };
  return database;
}
it("persists bounded rule and skill candidates without activating either", async () => {
  const database = db(); agent.requestStructuredAgent.mockResolvedValue({ conclusion: "PROPOSE_REVISION", diagnosis: "Possible noise", proposedMinimumScore: 65, proposedMinimumConfidence: 70, skillAmendments: [{ change: "Discuss costs", rationale: "Costs matter" }], hypothesis: "Test stricter entries", validationPlan: "Prospective comparison" });
  const original = JSON.stringify(tradingRules);
  expect(await reviewPaperRules(database as unknown as PrismaClient)).toMatchObject({ status: "PROPOSED" });
  const data = database.paperRuleReview.update.mock.calls[0]?.[0]?.data;
  expect(data.proposal.activation).toBe("NOT_ACTIVE"); expect(data.proposal.candidateRules.minimumScore).toBe(65);
  expect(JSON.stringify(tradingRules)).toBe(original);
});
it("replays reviews without additional model calls and applies cooldown", async () => {
  const database = db(); database.paperRuleReview.findUnique.mockResolvedValue({ id: "old", status: "PROPOSED" });
  expect(await reviewPaperRules(database as unknown as PrismaClient)).toMatchObject({ reviewId: "old" });
  expect(agent.requestStructuredAgent).not.toHaveBeenCalled();
  database.paperRuleReview.findUnique.mockResolvedValue(null); database.paperRuleReview.findFirst.mockResolvedValue({ session: "2026-11-14" });
  expect(await reviewPaperRules(database as unknown as PrismaClient)).toMatchObject({ status: "COOLDOWN" });
  expect(agent.requestStructuredAgent).not.toHaveBeenCalled();
});
it("fails closed when the reviewer fails, and rejects mixed experiments", async () => {
  const database = db(); agent.requestStructuredAgent.mockRejectedValue(new Error("Unavailable"));
  await expect(reviewPaperRules(database as unknown as PrismaClient)).rejects.toThrow();
  expect(database.paperRuleReview.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
  database.paperRun.findMany.mockResolvedValue([{ id: "run", session: "2026-11-15", status: "EXECUTED", inputs: { config: {} as any, rules: tradingRules }, decision: {}, execution: {} }]);
  expect(await reviewPaperRules(database as unknown as PrismaClient)).toMatchObject({ status: "MIXED_OR_MISSING_EXPERIMENT" });
});
