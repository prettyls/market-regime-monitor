import { describe, expect, it } from "vitest";
import { defaultPatternConfig } from "../src/config.js";
import { CompositeRegimeStrategy } from "../src/domain/strategy.js";
describe("strategy", () => { it("returns insufficient data safely", () => { const result = new CompositeRegimeStrategy().analyze([], defaultPatternConfig); expect(result.regime).toBe("INSUFFICIENT_DATA"); expect(result.confidence).toBe(0); }); });
