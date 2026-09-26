import { describe, expect, it } from "vitest";
import { defaultPatternConfig } from "../src/config.js";
import type { Bar } from "../src/domain/types.js";
import { BreakoutDetector, DynamicRangeDetector, MeanReversionDetector, TrendDetector } from "../src/domain/patterns.js";
const bars = (closes: number[]): Bar[] => closes.map((close, i) => ({ timestamp: new Date(2020, 0, i + 1), open: close, high: close, low: close, close }));
describe("pattern detectors", () => {
  it("finds a confirmed breakout", () => { const config = { ...defaultPatternConfig, breakout: { lookback: 5, confirmationBars: 2, bufferPct: 0 } }; expect(new BreakoutDetector().detect(bars([1, 2, 3, 4, 5, 6, 7]), config).state).toBe("CONFIRMED_UP"); });
  it("finds a trend", () => { const config = { ...defaultPatternConfig, trend: { fastPeriod: 3, slowPeriod: 5, slopePeriod: 3 } }; expect(new TrendDetector().detect(bars([1, 2, 3, 4, 5, 6]), config).state).toBe("UP"); });
  it("finds an extreme eligible for mean reversion", () => { const config = { ...defaultPatternConfig, meanReversion: { lookback: 6, zScoreEntry: 1.5 } }; expect(new MeanReversionDetector().detect(bars([10, 10, 10, 10, 10, 20]), config).state).toBe("REVERT_DOWN"); });
  it("uses a data-driven range", () => { const config = { ...defaultPatternConfig, range: { lookback: 5, percentileLow: 0, percentileHigh: 1 } }; expect(new DynamicRangeDetector().detect(bars([1, 2, 3, 4, 5]), config).metrics).toEqual(expect.objectContaining({ low: 1, high: 5 })); });
});
