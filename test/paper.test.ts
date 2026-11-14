import { afterEach, describe, expect, it, vi } from "vitest";
import { paperConfigSchema, sessionDate } from "../src/paper/config.js";
import { rebalance, validateDecision, type Decision } from "../src/paper/engine.js";
import { sessionHours, validateQuote } from "../src/paper/market.js";
import { requestDecision } from "../src/paper/agent.js";
const config = paperConfigSchema.parse({ enabled: true, symbols: ["SPY"] });
const decision: Decision = { action: "REBALANCE", reason: "Test allocation", targets: [{ symbol: "SPY", weight: 0.2 }] };
const quotes = { SPY: { bid: 99.9, ask: 100.1, timestamp: Date.now() } };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("paper portfolio", () => {
  it("buys with adverse slippage within order and exposure limits", () => {
    const result = rebalance("10000", {}, quotes, decision, config);
    expect(result.fills).toHaveLength(1);
    expect(result.fills[0]).toMatchObject({ symbol: "SPY", side: "BUY", quantity: 9, price: "100.1501" });
    expect(Number(result.cash)).toBeGreaterThan(9000);
    expect(Number(result.turnover)).toBeLessThanOrEqual(1000);
    expect(result.positions.SPY?.quantity).toBe(9);
  });
  it("sells only owned shares and realizes profit after fees", () => {
    const result = rebalance("0", { SPY: { quantity: 5, costBasis: "400" } }, quotes,
      { action: "REBALANCE", reason: "Exit", targets: [{ symbol: "SPY", weight: 0 }] }, { ...config, feePerOrder: 1 });
    expect(result.fills[0]?.side).toBe("SELL");
    expect(result.positions.SPY?.quantity).toBe(0);
    expect(result.positions.SPY?.costBasis).toBe("0.0000");
    expect(Number(result.realizedPnl)).toBeCloseTo(Number(result.cash) - 400, 4);
  });
  it("keeps HOLD unchanged and never shorts or spends cash reserve", () => {
    const raw = { SPY: { quantity: 2, costBasis: "190" } };
    const hold = rebalance("50", raw, quotes, { action: "HOLD", reason: "No signal", targets: [] }, config);
    expect(hold.cash).toBe("50.0000"); expect(hold.fills).toEqual([]); expect(raw.SPY.quantity).toBe(2);
    const result = rebalance("1000", {}, quotes, decision, { ...config, cashReserveWeight: 0.8 });
    expect(Number(result.cash)).toBeGreaterThanOrEqual(800);
  });
  it("rejects invented symbols, duplicate targets and excessive allocation", () => {
    for (const targets of [[{ symbol: "QQQ", weight: 0.1 }], [{ symbol: "SPY", weight: 0.9 }], [{ symbol: "SPY", weight: 0.1 }, { symbol: "SPY", weight: 0.1 }]]) {
      expect(() => validateDecision({ ...decision, targets }, config)).toThrow();
    }
    expect(() => validateDecision({ action: "HOLD", reason: "x", targets: decision.targets }, config)).toThrow();
    expect(() => rebalance("-1", {}, quotes, decision, config)).toThrow();
  });
  it("caps shared turnover across several symbols", () => {
    const cfg = { ...config, symbols: ["SPY", "QQQ"], maxDailyDollars: 1100 };
    const result = rebalance("10000", {}, { ...quotes, QQQ: quotes.SPY }, { ...decision, targets: [{ symbol: "SPY", weight: 0.2 }, { symbol: "QQQ", weight: 0.2 }] }, cfg);
    expect(Number(result.turnover)).toBeLessThanOrEqual(1100);
    expect(result.fills).toHaveLength(2);
  });
  it("uses the Eastern calendar across UTC day and daylight-saving boundaries", () => {
    expect(sessionDate(new Date("2026-11-17T01:00:00Z"))).toBe("2026-11-16");
    expect(sessionDate(new Date("2026-07-17T03:00:00Z"))).toBe("2026-07-16");
  });
});
describe("paper external inputs", () => {
  it("rejects stale, delayed, crossed and wide quotes", () => {
    const now = Date.now(); const raw = { assetMainType: "EQUITY", realtime: true, quote: { bidPrice: 100, askPrice: 100.1, quoteTime: now } };
    expect(validateQuote(raw, config, now).bid).toBe(100);
    for (const value of [{ ...raw, realtime: false }, { ...raw, assetMainType: "OPTION" }, { ...raw, quote: { ...raw.quote, quoteTime: now - 120000 } }, { ...raw, quote: { ...raw.quote, askPrice: 99 } }, { ...raw, quote: { ...raw.quote, askPrice: 110 } }]) {
      expect(() => validateQuote(value, config, now)).toThrow();
    }
  });
  it("skips holidays and rejects missing calendar data", async () => {
    vi.stubEnv("SCHWAB_MARKET_ACCESS_TOKEN", "test");
    const request = vi.fn(async () => Response.json({ equity: { EQ: { isOpen: false } } })); vi.stubGlobal("fetch", request);
    expect(await sessionHours("2026-12-25")).toBeNull();
    request.mockImplementation(async () => Response.json({ equity: {} }));
    await expect(sessionHours("2026-12-25")).rejects.toThrow("unavailable");
  });
  it("requests and validates a structured agent decision without broker tools", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key"); vi.stubEnv("PAPER_AGENT_MODEL", "configured-model");
    const request = vi.fn<typeof fetch>(async () => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(decision) }] }] }));
    vi.stubGlobal("fetch", request);
    expect(await requestDecision({ config })).toEqual(decision);
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(body.store).toBe(false); expect(body.text.format.strict).toBe(true); expect(body.tools).toBeUndefined();
  });
  it("rejects agent refusals/incomplete output rather than inventing trades", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key"); vi.stubEnv("PAPER_AGENT_MODEL", "configured-model");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "incomplete", output: [] })));
    await expect(requestDecision({})).rejects.toThrow();
  });
});
