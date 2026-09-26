import { clamp } from "./indicators.js";
import { defaultDetectors, type PatternDetector } from "./patterns.js";
import type { AnalysisResult, Bar, PatternConfig, Regime } from "./types.js";

export interface Strategy { analyze(bars: readonly Bar[], config: PatternConfig): AnalysisResult; }

export class CompositeRegimeStrategy implements Strategy {
  constructor(private readonly detectors: readonly PatternDetector[] = defaultDetectors) {}

  analyze(bars: readonly Bar[], config: PatternConfig): AnalysisResult {
    const signals = this.detectors.map((detector) => detector.detect(bars, config));
    const usable = signals.filter((signal) => signal.state !== "INSUFFICIENT_DATA");
    const latest = bars.at(-1)?.timestamp ?? new Date(0);
    if (usable.length === 0) return { timestamp: latest, regime: "INSUFFICIENT_DATA", score: 0, confidence: 0, signals, evidence: [] };
    const breakout = signals.find((signal) => signal.pattern === "breakout");
    const trend = signals.find((signal) => signal.pattern === "trend");
    const reversion = signals.find((signal) => signal.pattern === "mean-reversion");
    const range = signals.find((signal) => signal.pattern === "dynamic-range");
    let regime: Regime = "MIXED";
    if (breakout?.state === "CONFIRMED_UP") regime = "BREAKOUT_UP";
    else if (breakout?.state === "CONFIRMED_DOWN") regime = "BREAKOUT_DOWN";
    else if (reversion?.state.startsWith("REVERT_")) regime = "MEAN_REVERSION";
    else if (trend?.state === "UP") regime = "TREND_UP";
    else if (trend?.state === "DOWN") regime = "TREND_DOWN";
    else if (range?.state === "IN_RANGE") regime = "RANGE";
    const totalWeight = usable.reduce((sum, signal) => sum + Math.max(0.1, signal.confidence / 100), 0);
    const score = usable.reduce((sum, signal) => sum + signal.score * Math.max(0.1, signal.confidence / 100), 0) / totalWeight;
    const confidence = clamp(usable.reduce((sum, signal) => sum + signal.confidence, 0) / usable.length);
    return { timestamp: latest, regime, score: Math.round(score * 100) / 100, confidence: Math.round(confidence * 100) / 100, signals, evidence: signals.flatMap((signal) => signal.evidence) };
  }
}
