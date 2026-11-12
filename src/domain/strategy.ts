import { clamp } from "./indicators.js";
import { defaultDetectors, type PatternDetector } from "./patterns.js";
import type { AnalysisResult, Bar, PatternConfig, Regime } from "./types.js";

export interface Strategy { analyze(bars: readonly Bar[], config: PatternConfig): AnalysisResult; }

export class CompositeRegimeStrategy implements Strategy {
  constructor(private readonly detectors: readonly PatternDetector[] = defaultDetectors) {}

  analyze(bars: readonly Bar[], config: PatternConfig): AnalysisResult {
    const signals = this.detectors.map((detector) => detector.detect(bars, config));
    const usable = signals.filter((signal) => signal.pattern !== "volume" && signal.state !== "INSUFFICIENT_DATA");
    const latest = bars.at(-1)?.timestamp ?? new Date(0);
    if (usable.length === 0) return { timestamp: latest, regime: "INSUFFICIENT_DATA", score: 0, confidence: 0, signals, evidence: [] };
    const breakout = signals.find((signal) => signal.pattern === "breakout");
    const trend = signals.find((signal) => signal.pattern === "trend");
    const reversion = signals.find((signal) => signal.pattern === "mean-reversion");
    const range = signals.find((signal) => signal.pattern === "dynamic-range");
    let regime: Regime = "MIXED";
    if (breakout?.state === "CONFIRMED_UP") regime = "BREAKOUT_UP";
    else if (breakout?.state === "CONFIRMED_DOWN") regime = "BREAKOUT_DOWN";
    else if (trend?.state === "UP") regime = "TREND_UP";
    else if (trend?.state === "DOWN") regime = "TREND_DOWN";
    else if (reversion?.state.startsWith("REVERT_")) regime = "MEAN_REVERSION";
    else if (range?.state === "IN_RANGE") regime = "RANGE";
    // Use the selected regime's directional signal; neutral context and
    // countertrend extension warnings must not reverse its score.
    const primary = regime.startsWith("BREAKOUT") ? breakout : regime.startsWith("TREND") ? trend : regime === "MEAN_REVERSION" ? reversion : regime === "RANGE" ? range : undefined;
    const volume = signals.find((signal) => signal.pattern === "volume");
    const directional = regime.startsWith("BREAKOUT") || regime.startsWith("TREND");
    const adjustment = !directional ? 0 : volume?.state === "WEAK_PARTICIPATION" ? -10 : volume?.state === "ELEVATED_PARTICIPATION" ? 10 : 0;
    const score = primary?.score ?? 0;
    const confidence = clamp((primary?.confidence ?? 0) + adjustment);
    const evidence = signals.flatMap((signal) => signal.evidence);
    if (regime.startsWith("TREND") && reversion?.state.startsWith("REVERT_")) evidence.push({ code: "TREND_EXTENDED", message: "Price is stretched relative to its recent mean; the trend remains active with possible mean-reversion risk.", direction: "neutral", weight: 0 });
    return { timestamp: latest, regime, score: Math.round(score * 100) / 100, confidence: Math.round(confidence * 100) / 100, signals, evidence };
  }
}
