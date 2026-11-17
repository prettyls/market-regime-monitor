import { describe, expect, it } from "vitest";
import { paperConfigSchema } from "../src/paper/config.js";
import { validateTradingRules } from "../src/paper/rules.js";
import type { Decision } from "../src/paper/engine.js";
const config = paperConfigSchema.parse({ symbols: ["SPY"] });
const account = { cash: "9000", positions: { SPY: { quantity: 10, costBasis: "900" } } };
const rows = (regime: string, score = 75, confidence = 75) => [{ instrument: { symbol: "SPY" }, analysis: { regime, score, confidence }, referenceClose: 100 }];
const target = (weight: number): Decision => ({ action: "REBALANCE", reason: "Test", targets: [{ symbol: "SPY", weight }] });
describe("versioned scheduled trading rules", () => {
  it("allows qualified bullish allocations", () => {
    for (const regime of ["TREND_UP", "BREAKOUT_UP"]) expect(() => validateTradingRules(target(0.2), config, rows(regime), account)).not.toThrow();
  });
  it("blocks allocation increases on weak or nonbullish signals", () => {
    for (const data of [rows("RANGE"), rows("MIXED"), rows("MEAN_REVERSION"), rows("TREND_UP", 49, 75), rows("TREND_UP", 75, 59)]) {
      expect(() => validateTradingRules(target(0.2), config, data, account)).toThrow("prohibit increasing");
      expect(() => validateTradingRules(target(0.05), config, data, account)).not.toThrow();
    }
  });
  it("requires zero bearish targets instead of HOLD for existing holdings", () => {
    const hold: Decision = { action: "HOLD", reason: "Test", targets: [] };
    for (const regime of ["TREND_DOWN", "BREAKOUT_DOWN"]) {
      expect(() => validateTradingRules(hold, config, rows(regime), account)).toThrow("zero target");
      expect(() => validateTradingRules(target(0.05), config, rows(regime), account)).toThrow("zero target");
      expect(() => validateTradingRules(target(0), config, rows(regime), account)).not.toThrow();
      expect(() => validateTradingRules(hold, config, rows(regime), { cash: "10000", positions: {} })).not.toThrow();
    }
  });
  it("rejects missing reference data rather than inventing allocations", () => {
    expect(() => validateTradingRules(target(0.1), config, [], account)).toThrow("Missing");
    expect(() => validateTradingRules(target(0.1), config, [{ ...rows("TREND_UP")[0], referenceClose: 0 }], account)).toThrow();
  });
});
