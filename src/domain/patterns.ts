import { clamp, linearSlope, mean, percentile, sma, zScore } from "./indicators.js";
import type { Bar, PatternConfig, PatternSignal } from "./types.js";

export interface PatternDetector { readonly name: string; detect(bars: readonly Bar[], config: PatternConfig): PatternSignal; }

const insufficient = (pattern: string): PatternSignal => ({ pattern, state: "INSUFFICIENT_DATA", score: 0, confidence: 0, evidence: [], metrics: {} });

export class DynamicRangeDetector implements PatternDetector {
  readonly name = "dynamic-range";
  detect(bars: readonly Bar[], config: PatternConfig): PatternSignal {
    const { lookback, percentileLow, percentileHigh } = config.range;
    if (bars.length < lookback) return insufficient(this.name);
    const closes = bars.slice(-lookback).map((bar) => bar.close);
    const low = percentile(closes, percentileLow)!;
    const high = percentile(closes, percentileHigh)!;
    const current = closes.at(-1)!;
    const inside = current >= low && current <= high;
    return { pattern: this.name, state: inside ? "IN_RANGE" : current > high ? "ABOVE_RANGE" : "BELOW_RANGE", score: inside ? 25 : 55, confidence: clamp(50 + lookback / 2), evidence: [{ code: "DYNAMIC_RANGE", message: `${current.toFixed(2)} is ${inside ? "inside" : "outside"} the ${low.toFixed(2)}–${high.toFixed(2)} dynamic range`, value: current, direction: "neutral", weight: 1 }], metrics: { low, high, current } };
  }
}

export class BreakoutDetector implements PatternDetector {
  readonly name = "breakout";
  detect(bars: readonly Bar[], config: PatternConfig): PatternSignal {
    const { lookback, confirmationBars, bufferPct } = config.breakout;
    if (bars.length < lookback + confirmationBars) return insufficient(this.name);
    const reference = bars.slice(-(lookback + confirmationBars), -confirmationBars).map((bar) => bar.close);
    const upper = Math.max(...reference) * (1 + bufferPct);
    const lower = Math.min(...reference) * (1 - bufferPct);
    const confirmation = bars.slice(-confirmationBars).map((bar) => bar.close);
    const up = confirmation.every((value) => value > upper);
    const down = confirmation.every((value) => value < lower);
    const state = up ? "CONFIRMED_UP" : down ? "CONFIRMED_DOWN" : "NONE";
    return { pattern: this.name, state, score: up ? 85 : down ? -85 : 0, confidence: up || down ? clamp(65 + confirmationBars * 8) : 45, evidence: up || down ? [{ code: "BREAKOUT_CONFIRMED", message: `${confirmationBars} closes confirmed a ${up ? "upward" : "downward"} breakout`, value: confirmation.at(-1)!, threshold: up ? upper : lower, direction: up ? "bullish" : "bearish", weight: 2 }] : [], metrics: { upper, lower, current: confirmation.at(-1)! } };
  }
}

export class MeanReversionDetector implements PatternDetector {
  readonly name = "mean-reversion";
  detect(bars: readonly Bar[], config: PatternConfig): PatternSignal {
    const { lookback, zScoreEntry } = config.meanReversion;
    if (bars.length < lookback) return insufficient(this.name);
    const closes = bars.slice(-lookback).map((bar) => bar.close);
    const current = closes.at(-1)!;
    const z = zScore(current, closes);
    const active = Math.abs(z) >= zScoreEntry;
    return { pattern: this.name, state: active ? (z > 0 ? "REVERT_DOWN" : "REVERT_UP") : "NONE", score: active ? -Math.sign(z) * clamp(Math.abs(z) * 30) : 0, confidence: active ? clamp(55 + Math.abs(z) * 12) : 40, evidence: active ? [{ code: "EXTREME_ZSCORE", message: `Close is ${z.toFixed(2)} standard deviations from its mean`, value: z, threshold: zScoreEntry, direction: z > 0 ? "bearish" : "bullish", weight: 1.5 }] : [], metrics: { mean: mean(closes), zScore: z, current } };
  }
}

export class TrendDetector implements PatternDetector {
  readonly name = "trend";
  detect(bars: readonly Bar[], config: PatternConfig): PatternSignal {
    const { fastPeriod, slowPeriod, slopePeriod } = config.trend;
    if (bars.length < Math.max(slowPeriod, slopePeriod)) return insufficient(this.name);
    const closes = bars.map((bar) => bar.close);
    const fast = sma(closes, fastPeriod)!;
    const slow = sma(closes, slowPeriod)!;
    const slope = linearSlope(closes.slice(-slopePeriod));
    const up = fast > slow && slope > 0;
    const down = fast < slow && slope < 0;
    const strength = Math.abs((fast - slow) / slow) * 100;
    return { pattern: this.name, state: up ? "UP" : down ? "DOWN" : "FLAT", score: up ? clamp(50 + strength * 20) : down ? -clamp(50 + strength * 20) : 0, confidence: up || down ? clamp(55 + strength * 15) : 40, evidence: up || down ? [{ code: "MA_TREND", message: `Fast average is ${up ? "above" : "below"} slow average with confirming slope`, value: fast, threshold: slow, direction: up ? "bullish" : "bearish", weight: 1 }] : [], metrics: { fast, slow, slope } };
  }
}

export const defaultDetectors: readonly PatternDetector[] = [new DynamicRangeDetector(), new BreakoutDetector(), new MeanReversionDetector(), new TrendDetector()];
