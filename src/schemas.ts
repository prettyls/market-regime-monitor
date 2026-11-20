import { z } from "zod";
import { historyIntervals } from "./providers/provider.js";

const patternConfigSchema = z.object({
  volume: z.object({ enabled: z.boolean(), lookback: z.number().int().min(2), lowRatio: z.number().positive(), highRatio: z.number().positive() }).refine((v) => v.lowRatio < v.highRatio).optional(),
  range: z.object({ lookback: z.number().int().min(5), percentileLow: z.number().min(0).max(1), percentileHigh: z.number().min(0).max(1) }).refine((v) => v.percentileLow < v.percentileHigh),
  breakout: z.object({ lookback: z.number().int().min(2), confirmationBars: z.number().int().min(1), bufferPct: z.number().min(0).max(1), atrPeriod: z.number().int().min(2).optional(), atrMultiplier: z.number().min(0).max(10).optional() }),
  meanReversion: z.object({ lookback: z.number().int().min(5), zScoreEntry: z.number().positive() }),
  trend: z.object({ fastPeriod: z.number().int().positive(), slowPeriod: z.number().int().positive(), slopePeriod: z.number().int().min(2), atrPeriod: z.number().int().min(2).optional(), minGapAtr: z.number().nonnegative().optional(), minSlopeAtr: z.number().nonnegative().optional() }).refine((v) => v.fastPeriod < v.slowPeriod)
});
export const instrumentInputSchema = z.object({ symbol: z.string().min(1).max(30).transform((s) => s.toUpperCase()), name: z.string().min(1), kind: z.enum(["INDEX", "ETF", "EQUITY", "RATE", "COMMODITY", "OTHER"]), provider: z.string().min(1), providerSymbol: z.string().min(1), config: patternConfigSchema });
export const historyQuerySchema = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });
export const priceHistoryQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  interval: z.enum(historyIntervals).default("1d"),
}).refine(({ from, to, interval }) => !from || !to ||
  (interval === "1d" ? from <= to : from < to), "Invalid price history window");

const agentSymbolSchema = z.string().trim().min(1).max(30).transform(symbol => symbol.toUpperCase());

export const tradingContextInputSchema = z.object({
  symbol: agentSymbolSchema.optional().describe("Source analysis symbol. Returns only its latest saved analysis."),
}).strict();

export const schwabBarsInputSchema = z.object({
  symbol: agentSymbolSchema,
  interval: z.enum(historyIntervals),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
}).strict();
export const alertQuerySchema = z.object({ symbol: z.string().optional(), severity: z.enum(["INFO", "WATCH", "WARNING", "CRITICAL"]).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) });

export const tradingSkillInputSchema = z.object({ workflow: z.enum(["paper", "live"]) }).strict();
