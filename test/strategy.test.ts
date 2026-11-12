import { describe, expect, it } from "vitest";
import { defaultPatternConfig } from "../src/config.js";
import { CompositeRegimeStrategy } from "../src/domain/strategy.js";
describe("strategy", () => { it("returns insufficient data safely", () => { const result = new CompositeRegimeStrategy().analyze([], defaultPatternConfig); expect(result.regime).toBe("INSUFFICIENT_DATA"); expect(result.confidence).toBe(0); }); });

import type { PatternSignal } from "../src/domain/types.js";
const signal = (pattern: string, state: string, score: number, confidence = 80): PatternSignal => ({ pattern, state, score, confidence, evidence: [], metrics: {} });
const analyzeSignals = (...signals: PatternSignal[]) => new CompositeRegimeStrategy(signals.map((s) => ({ name: s.pattern, detect: () => s }))).analyze([], defaultPatternConfig);
it("keeps a stretched trend active and explains the conflict", () => {
  const result = analyzeSignals(signal("trend", "UP", 75), signal("mean-reversion", "REVERT_DOWN", -95));
  expect(result.regime).toBe("TREND_UP");
  expect(result.score).toBe(75);
  expect(result.evidence.some((e) => e.code === "TREND_EXTENDED")).toBe(true);
});
it("keeps bearish breakout direction and adjusts only strength for volume", () => {
  const result = analyzeSignals(signal("breakout", "CONFIRMED_DOWN", -85), signal("trend", "UP", 100), signal("volume", "WEAK_PARTICIPATION", 0, 0));
  expect(result.regime).toBe("BREAKOUT_DOWN");
  expect(result.score).toBe(-85);
  expect(result.confidence).toBe(70);
});
it("does not penalize unavailable volume or classify volume alone", () => {
  expect(analyzeSignals(signal("trend", "DOWN", -75), signal("volume", "UNAVAILABLE", 0, 0)).confidence).toBe(80);
  expect(analyzeSignals(signal("volume", "ELEVATED_PARTICIPATION", 0, 0)).regime).toBe("INSUFFICIENT_DATA");
});
