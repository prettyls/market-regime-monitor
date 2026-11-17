import { afterEach, expect, it, vi } from "vitest";
vi.mock("../src/trading/schwab.js", async importOriginal => ({ ...await importOriginal<typeof import("../src/trading/schwab.js")>(), readSchwabResource: vi.fn() }));
import { readSchwabResource } from "../src/trading/schwab.js";
import { estimateCalendar, schwabCalendar } from "../src/trading/calendar.js";
const read = vi.mocked(readSchwabResource);
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.resetAllMocks(); });
function trade(id: number, date: string, amount: number, cash: number, extra = {}) {
  return { activityId: id, time: `${date}T15:00:00Z`, type: "TRADE", status: "VALID", activityType: "EXECUTION", netAmount: cash,
    transferItems: [{ instrument: { assetType: "EQUITY", symbol: "SPY" }, amount, positionEffect: amount > 0 ? "OPENING" : "CLOSING" }], ...extra };
}
it("estimates partial FIFO closes from actual net cash, carries prior-month lots, and deduplicates transactions", () => {
  const rows = [trade(1, "2026-10-20", 10, -1001), trade(2, "2026-11-02", 10, -1201), trade(3, "2026-11-03", -15, 1949)];
  const result = estimateCalendar([rows[2], rows[0], rows[1], rows[2]], "2026-11", "2026-01-01", "2026-11-17T15:00:00Z");
  expect(result.totalRealizedPnl).toBe("347.5000");
  expect(result.days[1]).toMatchObject({ realizedPnl: "347.5000", closingTrades: 1 });
  expect(result).toMatchObject({ simulated: false, estimated: true, method: "OBSERVED_FIFO" });
  expect(JSON.stringify(result)).not.toContain('"SPY"');
});
it("marks missing basis and later related closes incomplete instead of fabricating profits", () => {
  const result = estimateCalendar([trade(1, "2026-11-02", -10, 1000), trade(2, "2026-11-03", 10, -900), trade(3, "2026-11-04", -10, 1100)], "2026-11", "2026-01-01", "now");
  expect(result.totalRealizedPnl).toBeNull();
  expect(result.days.every(day => day.realizedPnl === null)).toBe(true);
  expect(result.cumulativeSeries.every(day => day.realizedPnl === null)).toBe(true);
});
it("does not turn unsupported options or corrections into equity P/L", () => {
  const option = trade(1, "2026-11-02", -1, 50, { transferItems: [{ instrument: { assetType: "OPTION", symbol: "SPY CALL" }, amount: -1, positionEffect: "CLOSING" }] });
  const correction = trade(2, "2026-11-03", 1, -100, { activityType: "ACTIVITY_CORRECTION" });
  const result = estimateCalendar([option, correction], "2026-11", "2026-01-01", "now");
  expect(result.totalRealizedPnl).toBeNull();
});
it("uses Eastern dates and excludes pending transactions", () => {
  const result = estimateCalendar([trade(1, "2026-11-02", 1, -100, { time: "2026-11-03T01:00:00Z" }), trade(2, "2026-11-03", -1, 120, { status: "PENDING" })], "2026-11", "2026-01-01", "now");
  expect(result.days).toEqual([{ date: "2026-11-02", realizedPnl: "0.0000", closingTrades: 0 }]);
});
it("refuses ambiguous accounts before reading transactions", async () => {
  vi.stubEnv("SCHWAB_TRADE_ACCOUNT_HASH", "");
  read.mockResolvedValue([{ hashValue: "one" }, { hashValue: "two" }]);
  await expect(schwabCalendar({ month: "2026-11" })).rejects.toMatchObject({ code: "SCHWAB_ACCOUNT_SELECTION_REQUIRED" });
  expect(read).toHaveBeenCalledOnce();
});
it("reads only the configured linked account and returns aggregated estimates", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-17T17:00:00Z"));
  vi.stubEnv("SCHWAB_TRADE_ACCOUNT_HASH", "two");
  read.mockResolvedValueOnce([{ hashValue: "one" }, { hashValue: "two" }]).mockResolvedValueOnce([trade(1, "2026-11-02", 1, -100), trade(2, "2026-11-03", -1, 110)]).mockResolvedValueOnce([]);
  const result = await schwabCalendar({ month: "2026-11" });
  expect(read.mock.calls[1]?.[0]).toContain("accounts/two/transactions?");
  expect(result.totalRealizedPnl).toBe("10.0000");
  expect(JSON.stringify(result)).not.toContain('"two"');
});
