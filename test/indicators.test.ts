import { describe, expect, it } from "vitest";
import { linearSlope, percentile, sma, zScore } from "../src/domain/indicators.js";
describe("indicators", () => {
  it("calculates moving averages", () => expect(sma([1, 2, 3, 4], 3)).toBe(3));
  it("interpolates percentiles", () => expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5));
  it("recognizes slope direction", () => { expect(linearSlope([1, 2, 3])).toBeGreaterThan(0); expect(linearSlope([3, 2, 1])).toBeLessThan(0); });
  it("computes a standardized score", () => expect(zScore(3, [1, 2, 3])).toBeCloseTo(1.2247, 3));
});
