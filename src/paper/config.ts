import { z } from "zod";
import { blockedSymbolsSchema } from "../trading/policy.js";

export const paperConfigSchema = z.object({
  enabled: z.boolean().default(false),
  accountId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).default("paper-primary"),
  strategy: z.string().min(1).max(64).default("regime-allocation-v1"),
  symbols: z.array(z.string().regex(/^[A-Z][A-Z0-9.-]{0,14}$/)).min(1).max(20).refine(a => new Set(a).size === a.length),
  blockedSymbols: blockedSymbolsSchema,
  benchmark: z.string().regex(/^[A-Z][A-Z0-9.-]{0,14}$/).default("SPY"),
  initialCash: z.number().positive().max(10000000).default(10000),
  maxPositionWeight: z.number().positive().max(1).default(0.2),
  cashReserveWeight: z.number().min(0).max(1).default(0.2),
  maxOrderDollars: z.number().positive().max(1000000).default(1000),
  maxDailyDollars: z.number().positive().max(1000000).default(3000),
  slippageBps: z.number().min(0).max(100).default(5),
  feePerOrder: z.number().min(0).max(100).default(0),
  maxSpreadBps: z.number().positive().max(1000).default(50),
  maxQuoteAgeSeconds: z.number().positive().max(300).default(60),
}).strict();
export type PaperConfig = z.infer<typeof paperConfigSchema>;
export const paperConfig = () => paperConfigSchema.parse(JSON.parse(process.env.PAPER_TRADING_JSON ?? '{"enabled":false,"symbols":["SPY"]}'));
export const sessionDate = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
export const json = (value: unknown) => JSON.parse(JSON.stringify(value));
