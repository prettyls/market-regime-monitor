import { atr, clamp, linearSlope, mean, percentile, sma, zScore } from "./indicators.js";
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
    return { pattern: this.name, state: inside ? "IN_RANGE" : current > high ? "ABOVE_RANGE" : "BELOW_RANGE", score: 0, confidence: clamp(50 + lookback / 2), evidence: [{ code: "DYNAMIC_RANGE", message: `${current.toFixed(2)} is ${inside ? "inside" : "outside"} the ${low.toFixed(2)}–${high.toFixed(2)} dynamic range`, value: current, direction: "neutral", weight: 1 }], metrics: { low, high, current } };
  }
}

export class BreakoutDetector implements PatternDetector {
  readonly name = "breakout";
  detect(bars: readonly Bar[], config: PatternConfig): PatternSignal {
    const { lookback, confirmationBars, bufferPct } = config.breakout;
    if (bars.length < lookback + confirmationBars) return insufficient(this.name);
    const reference = bars.slice(-(lookback + confirmationBars), -confirmationBars).map((bar) => bar.close);
    const volatility = atr(bars.slice(0, -confirmationBars), config.breakout.atrPeriod ?? 14);
    const atrBuffer = (volatility ?? 0) * (config.breakout.atrMultiplier ?? 0.5);
    const upper = Math.max(...reference) + Math.max(Math.abs(Math.max(...reference)) * bufferPct, atrBuffer);
    const lower = Math.min(...reference) - Math.max(Math.abs(Math.min(...reference)) * bufferPct, atrBuffer);
    const confirmation = bars.slice(-confirmationBars).map((bar) => bar.close);
    const up = confirmation.every((value) => value > upper);
    const down = confirmation.every((value) => value < lower);
    const state = up ? "CONFIRMED_UP" : down ? "CONFIRMED_DOWN" : "NONE";
    return { pattern: this.name, state, score: up ? 85 : down ? -85 : 0, confidence: up || down ? clamp(65 + confirmationBars * 8) : 45, evidence: up || down ? [{ code: "BREAKOUT_CONFIRMED", message: `${confirmationBars} closes confirmed a ${up ? "upward" : "downward"} breakout`, value: confirmation.at(-1)!, threshold: up ? upper : lower, direction: up ? "bullish" : "bearish", weight: 2 }] : [], metrics: { ...(volatility === undefined ? {} : { atr: volatility, atrBuffer }), upper, lower, current: confirmation.at(-1)! } };
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

export class VolumeDetector implements PatternDetector {
  readonly name = "volume";
  detect(bars: readonly Bar[], config: PatternConfig): PatternSignal {
    const settings = config.volume ?? { enabled: true, lookback: 20, lowRatio: 0.8, highRatio: 1.5 };
    const unavailable = (state: string): PatternSignal => ({ pattern: this.name, state, score: 0, confidence: 0, evidence: [{ code: "VOLUME_UNAVAILABLE", message: "Volume confirmation is unavailable; price signals remain usable.", direction: "neutral", weight: 0 }], metrics: {} });
    if (!settings.enabled) return unavailable("NOT_APPLICABLE");
    const count = config.breakout.confirmationBars;
    if (bars.length < settings.lookback + count) return unavailable("INSUFFICIENT_DATA");
    const baseline = bars.slice(-(settings.lookback + count), -count);
    const confirmation = bars.slice(-count);
    // Zero is treated as unavailable rather than evidence of weak participation.
    if ([...baseline, ...confirmation].some((bar) => bar.volume === undefined || !Number.isFinite(bar.volume) || bar.volume <= 0)) return unavailable("UNAVAILABLE");
    const average = mean(baseline.map((bar) => bar.volume!));
    const relativeVolume = confirmation.at(-1)!.volume! / average;
    const confirmationRatio = mean(confirmation.map((bar) => bar.volume!)) / average;
    const state = confirmationRatio < settings.lowRatio ? "WEAK_PARTICIPATION" : confirmationRatio >= settings.highRatio ? "ELEVATED_PARTICIPATION" : "TYPICAL_PARTICIPATION";
    return { pattern: this.name, state, score: 0, confidence: 0, evidence: [{ code: "RELATIVE_VOLUME", message: `Latest volume ${relativeVolume.toFixed(2)}× baseline; ${count}-session participation ${confirmationRatio.toFixed(2)}× (${state.toLowerCase().replaceAll("_", " ")}).`, value: confirmationRatio, direction: "neutral", weight: 0 }], metrics: { baselineVolume: average, relativeVolume, confirmationRatio } };
  }
}

export const defaultDetectors: readonly PatternDetector[] = [new DynamicRangeDetector(), new BreakoutDetector(), new MeanReversionDetector(), new TrendDetector(), new VolumeDetector()];
