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

import { VolumeDetector } from "../src/domain/patterns.js";
const volumeConfig = { ...defaultPatternConfig, volume: { enabled: true, lookback: 3, lowRatio: 0.8, highRatio: 1.5 } };
it("excludes the entire confirmation window from the volume baseline", () => {
  const input = bars([10, 10, 10, 11, 12]).map((bar, i) => ({ ...bar, volume: [100, 100, 100, 200, 300][i]! }));
  const result = new VolumeDetector().detect(input, volumeConfig);
  expect(result.state).toBe("ELEVATED_PARTICIPATION");
  expect(result.metrics).toEqual({ baselineVolume: 100, relativeVolume: 3, confirmationRatio: 2.5 });
  expect(result.score).toBe(0);
});
it.each([undefined, 0, -1, NaN])("does not interpret invalid volume %s as weak participation", (volume) => {
  const input = bars([10, 10, 10, 11, 12]).map((bar) => ({ ...bar, volume: 100 }));
  const { volume: _oldVolume, ...last } = input.pop()!;
  expect(new VolumeDetector().detect([...input, { ...last, ...(volume === undefined ? {} : { volume }) }], volumeConfig).state).toBe("UNAVAILABLE");
});
it("disables volume for instruments without meaningful native volume", () => {
  expect(new VolumeDetector().detect([], { ...volumeConfig, volume: { ...volumeConfig.volume, enabled: false } }).state).toBe("NOT_APPLICABLE");
});
it("uses reference ATR without including the breakout candles", () => {
  const config = { ...defaultPatternConfig, breakout: { lookback: 3, confirmationBars: 2, bufferPct: 0, atrPeriod: 2, atrMultiplier: 1 } };
  const input = bars([10, 10, 10, 12, 12]).map((bar, i) => ({ ...bar, high: i < 3 ? 11 : 100, low: i < 3 ? 9 : 1 }));
  const result = new BreakoutDetector().detect(input, config);
  expect(result.metrics.atr).toBe(2);
  expect(result.metrics.upper).toBe(12);
  expect(result.state).toBe("NONE");
  expect(new BreakoutDetector().detect(input, { ...config, breakout: { ...config.breakout, atrMultiplier: 0 } }).state).toBe("CONFIRMED_UP");
});
it("gives ranges no directional bias below support", () => {
  expect(new DynamicRangeDetector().detect(bars(Array.from({ length: 60 }, (_, i) => 100 - i)), defaultPatternConfig).score).toBe(0);
});
