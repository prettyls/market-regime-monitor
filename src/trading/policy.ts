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
  maxOrderDollars: z.number().positive().max(1000000),
  maxDailyDollars: z.number().positive().max(1000000),
  maxAnalysisAgeHours: z.number().positive().max(168),
}).strict();
// Accept legacy environment settings while deriving eligible symbols from the registry.
export const simulationPolicyConfigSchema = policySchema.extend({
  allowedSymbols: z.unknown().optional(),
}).transform(({ allowedSymbols: _allowedSymbols, ...policy }) => policy);

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
  if (notionalUnits(input) > Math.floor(policy.maxOrderDollars * 10000)) throw new Error("Order exceeds policy limit");
  const age = now.getTime() - analysisDate.getTime();
  if (age < 0 || age > policy.maxAnalysisAgeHours * 3600000) throw new Error("Analysis is stale or future dated");
}

export const liveOrderSchema = proposalSchema
  .omit({ analysisId: true, strategyId: true })
  .extend({ side: z.enum(["BUY", "SELL"]) });
export type LiveOrderInput = z.infer<typeof liveOrderSchema>;

export const liveOrderConfigSchema = policySchema
  .pick({ maxOrderDollars: true, maxDailyDollars: true })
  .extend({
    // Ignore retired fields in existing deployments.
    accountHash: z.unknown().optional(),
    allowedSymbols: z.unknown().optional(),
  })
  .transform(({ accountHash: _accountHash, allowedSymbols: _allowedSymbols, ...limits }) => limits);

const accountHashSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/).max(256);
export const configuredSchwabAccountHash = () => process.env.SCHWAB_TRADE_ACCOUNT_HASH || undefined;

export function liveOrderConfig() {
  if (process.env.AGENT_LIVE_TRADING_ENABLED !== "true") return undefined;
  const account = accountHashSchema.safeParse(configuredSchwabAccountHash());
  if (!account.success) throw new Error("Invalid or missing SCHWAB_TRADE_ACCOUNT_HASH for live trading");
  try {
    const limits = liveOrderConfigSchema.parse(JSON.parse(process.env.AGENT_LIVE_TRADING_JSON ?? "{}"));
    return { ...limits, accountHash: account.data };
  } catch {
    throw new Error("Invalid AGENT_LIVE_TRADING_JSON");
  }
}
