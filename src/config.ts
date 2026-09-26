import { z } from "zod";
import type { InstrumentDefinition, PatternConfig } from "./domain/types.js";

export const envSchema = z.object({ DATABASE_URL: z.string().min(1), PORT: z.coerce.number().int().positive().default(3000), HOST: z.string().default("0.0.0.0"), LOG_LEVEL: z.string().default("info") });
export const env = () => envSchema.parse(process.env);

export const defaultPatternConfig: PatternConfig = {
  range: { lookback: 60, percentileLow: 0.2, percentileHigh: 0.8 },
  breakout: { lookback: 20, confirmationBars: 2, bufferPct: 0.005 },
  meanReversion: { lookback: 30, zScoreEntry: 2 },
  trend: { fastPeriod: 10, slowPeriod: 30, slopePeriod: 10 }
};

export const vixDefinition: InstrumentDefinition = { symbol: "VIX", name: "CBOE Volatility Index", kind: "INDEX", provider: "stooq", providerSymbol: "^VIX", config: defaultPatternConfig };
