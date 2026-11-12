import { describe, expect, it } from "vitest";
import { linearSlope, percentile, sma, zScore } from "../src/domain/indicators.js";
describe("indicators", () => {
  it("calculates moving averages", () => expect(sma([1, 2, 3, 4], 3)).toBe(3));
  it("interpolates percentiles", () => expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5));
  it("recognizes slope direction", () => { expect(linearSlope([1, 2, 3])).toBeGreaterThan(0); expect(linearSlope([3, 2, 1])).toBeLessThan(0); });
  it("computes a standardized score", () => expect(zScore(3, [1, 2, 3])).toBeCloseTo(1.2247, 3));
});

import { atr } from "../src/domain/indicators.js";
it("includes overnight gaps and applies Wilder smoothing", () => {
  const bars = [10, 15, 17, 20].map((close, i) => ({ timestamp: new Date(i), open: close, high: close + 1, low: close - 1, close }));
  expect(atr(bars.slice(0, 2), 2)).toBeUndefined();
  expect(atr(bars.slice(0, 3), 2)).toBe(4.5);
  expect(atr(bars, 2)).toBe(4.25);
});
