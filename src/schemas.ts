import { z } from "zod";

const patternConfigSchema = z.object({
  range: z.object({ lookback: z.number().int().min(5), percentileLow: z.number().min(0).max(1), percentileHigh: z.number().min(0).max(1) }).refine((v) => v.percentileLow < v.percentileHigh),
  breakout: z.object({ lookback: z.number().int().min(2), confirmationBars: z.number().int().min(1), bufferPct: z.number().min(0).max(1) }),
  meanReversion: z.object({ lookback: z.number().int().min(5), zScoreEntry: z.number().positive() }),
  trend: z.object({ fastPeriod: z.number().int().positive(), slowPeriod: z.number().int().positive(), slopePeriod: z.number().int().min(2) }).refine((v) => v.fastPeriod < v.slowPeriod)
});
export const instrumentInputSchema = z.object({ symbol: z.string().min(1).max(30).transform((s) => s.toUpperCase()), name: z.string().min(1), kind: z.enum(["INDEX", "ETF", "EQUITY", "RATE", "COMMODITY", "OTHER"]), provider: z.string().min(1), providerSymbol: z.string().min(1), config: patternConfigSchema });
export const historyQuerySchema = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });
export const priceHistoryQuerySchema = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), interval: z.enum(["1d"]).default("1d") });
export const alertQuerySchema = z.object({ symbol: z.string().optional(), severity: z.enum(["INFO", "WATCH", "WARNING", "CRITICAL"]).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) });
