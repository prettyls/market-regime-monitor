import { z } from "zod";

export const proposalSchema = z.object({
  analysisId: z.string().min(1),
  strategyId: z.string().min(1).max(100),
  symbol: z.string().regex(/^[A-Za-z][A-Za-z0-9.\-]{0,14}$/).transform(s => s.toUpperCase()),
  side: z.literal("BUY"),
  quantity: z.number().int().positive().max(1000000),
  orderType: z.literal("LIMIT"),
  limitPrice: z.string().regex(/^\d{1,9}(\.\d{1,4})?$/).refine(s => Number(s) > 0),
  timeInForce: z.literal("DAY"),
  reason: z.string().min(1).max(2000),
  idempotencyKey: z.string().min(8).max(128),
}).strict();

export const policySchema = z.object({
  version: z.string().min(1),
  enabled: z.boolean().default(false),
  allowedSymbols: z.array(z.string().regex(/^[A-Z][A-Z0-9.\-]{0,14}$/)).min(1),
  maxOrderDollars: z.number().positive().max(1000000),
  maxDailyDollars: z.number().positive().max(1000000),
  maxAnalysisAgeHours: z.number().positive().max(168),
}).strict();
export type TradingPolicy = z.infer<typeof policySchema>;
export type ProposalInput = z.infer<typeof proposalSchema>;
export function notionalUnits(input: ProposalInput): number {
  const [whole, fraction = ""] = input.limitPrice.split(".");
  const units = (Number(whole) * 10000 + Number(fraction.padEnd(4, "0"))) * input.quantity;
  if (!Number.isSafeInteger(units)) throw new Error("Order value exceeds supported precision");
  return units;
}
export function validatePolicy(input: ProposalInput, policy: TradingPolicy, analysisDate: Date, now = new Date()): void {
  if (!policy.enabled) throw new Error("Trading proposals are paused");
  if (!policy.allowedSymbols.includes(input.symbol)) throw new Error("Symbol is not allowed by policy");
  if (notionalUnits(input) > Math.floor(policy.maxOrderDollars * 10000)) throw new Error("Order exceeds policy limit");
  const age = now.getTime() - analysisDate.getTime();
  if (age < 0 || age > policy.maxAnalysisAgeHours * 3600000) throw new Error("Analysis is stale or future dated");
}
