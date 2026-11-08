import { describe, expect, it } from "vitest";
import { classifyStatus, withStatus } from "../src/domain/status.js";
import type { PatternSignal } from "../src/domain/types.js";

const signal = (pattern: string, state: string): PatternSignal => ({ pattern, state, score: 0, confidence: 50, evidence: [], metrics: {} });

describe("status", () => {
  it("labels a confirmed breakout in either direction as ALERT", () => {
    expect(classifyStatus([signal("breakout", "CONFIRMED_UP"), signal("trend", "FLAT")])).toBe("ALERT");
    expect(classifyStatus([signal("breakout", "CONFIRMED_DOWN"), signal("trend", "UP")])).toBe("ALERT");
  });

  it("labels a trend without a breakout as WARNING", () => {
    expect(classifyStatus([signal("breakout", "NONE"), signal("trend", "UP")])).toBe("WARNING");
    expect(classifyStatus([signal("breakout", "NONE"), signal("trend", "DOWN")])).toBe("WARNING");
  });

  it("labels a trend as WARNING even when mean reversion takes the regime", () => {
    expect(classifyStatus([signal("breakout", "NONE"), signal("mean-reversion", "REVERT_DOWN"), signal("trend", "UP")])).toBe("WARNING");
  });

  it("labels no breakout and no trend as NORMAL", () => {
    expect(classifyStatus([signal("breakout", "NONE"), signal("trend", "FLAT")])).toBe("NORMAL");
    expect(classifyStatus([signal("breakout", "INSUFFICIENT_DATA"), signal("trend", "INSUFFICIENT_DATA")])).toBe("NORMAL");
    expect(classifyStatus([])).toBe("NORMAL");
  });

  it("attaches status and color to stored analyses with JSON signals", () => {
    expect(withStatus({ regime: "TREND_UP", signals: [signal("trend", "UP")] })).toMatchObject({ regime: "TREND_UP", status: "WARNING", color: "orange" });
    expect(withStatus({ regime: "MIXED", signals: null })).toMatchObject({ status: "NORMAL", color: "green" });
  });
});
