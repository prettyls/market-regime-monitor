export type Bar = Readonly<{ timestamp: Date; open: number; high: number; low: number; close: number; volume?: number }>;

export type Evidence = Readonly<{
  code: string;
  message: string;
  value?: number;
  threshold?: number;
  direction: "bullish" | "bearish" | "neutral";
  weight: number;
}>;

export type PatternSignal = Readonly<{
  pattern: string;
  state: string;
  score: number;
  confidence: number;
  evidence: readonly Evidence[];
  metrics: Readonly<Record<string, number>>;
}>;

export type Regime = "INSUFFICIENT_DATA" | "RANGE" | "BREAKOUT_UP" | "BREAKOUT_DOWN" | "MEAN_REVERSION" | "TREND_UP" | "TREND_DOWN" | "MIXED";

export type AnalysisResult = Readonly<{
  timestamp: Date;
  regime: Regime;
  score: number;
  confidence: number;
  signals: readonly PatternSignal[];
  evidence: readonly Evidence[];
}>;

export type PatternConfig = Readonly<{
  volume?: { enabled: boolean; lookback: number; lowRatio: number; highRatio: number } | undefined;
  range: { lookback: number; percentileLow: number; percentileHigh: number };
  breakout: { lookback: number; confirmationBars: number; bufferPct: number; atrPeriod?: number | undefined; atrMultiplier?: number | undefined };
  meanReversion: { lookback: number; zScoreEntry: number };
  trend: { fastPeriod: number; slowPeriod: number; slopePeriod: number };
}>;

export type InstrumentDefinition = Readonly<{
  symbol: string;
  name: string;
  kind: "INDEX" | "ETF" | "EQUITY" | "RATE" | "COMMODITY" | "OTHER";
  provider: string;
  providerSymbol: string;
  config: PatternConfig;
}>;
