import { afterEach, expect, it, vi } from "vitest";
vi.mock("../src/trading/schwab.js", async importOriginal => ({ ...await importOriginal<typeof import("../src/trading/schwab.js")>(), readSchwabResource: vi.fn() }));
import { readSchwabResource } from "../src/trading/schwab.js";
import { calendarKey, estimateCalendar, readCalendar } from "../src/trading/calendar.js";
import { syncCalendar } from "../src/trading/calendar-sync.js";
import type { PrismaClient } from "@prisma/client";
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
it("estimates Schwab trades with compact offsets and no activity type", () => {
  const rows = [
    trade(1, "2026-11-02", 1, -100, { time: "2026-11-02T15:00:00+0000", activityType: undefined }),
    trade(2, "2026-11-03", -1, 115, {
      time: "2026-11-03T15:00:00+0000", tradeDate: "2026-11-03T00:00:00+0000", activityType: undefined,
    }),
  ];
  const result = estimateCalendar(rows, "2026-11", "2026-01-01", "now");
  expect(result.days[1]).toMatchObject({ date: "2026-11-03", realizedPnl: "15.0000" });
});
it("refuses ambiguous accounts before fetching transactions", async () => {
  read.mockResolvedValue([{ hashValue: "one" }, { hashValue: "two" }]);
  await expect(syncCalendar({} as PrismaClient)).rejects.toMatchObject({ code: "SCHWAB_ACCOUNT_SELECTION_REQUIRED" });
  expect(read).toHaveBeenCalledOnce();
});

it("backfills, syncs an overlapping window, and publishes revised P/L from storage", async () => {
  const opening = trade(1, "2026-10-02", 1, -100);
  const closing = trade(2, "2026-11-17", -1, 115);
  let transactions: Array<{ time: Date; payload: unknown }> = [];
  let snapshot: { accountKey: string; historyStart: string; syncedAt: Date; days: unknown } | null = null;
  const snapshots = {
    findUnique: async () => snapshot,
    findFirst: vi.fn(async () => snapshot),
    upsert: async ({ update }: { update: NonNullable<typeof snapshot> }) => { snapshot = update; },
  };
  const tx = {
    $executeRaw: vi.fn(),
    schwabCalendarSnapshot: snapshots,
    schwabCalendarTransaction: {
      deleteMany: async ({ where }: { where: { OR?: [{ time: { gte: Date } }] } }) => {
        const start = where.OR?.[0].time.gte;
        transactions = start ? transactions.filter(row => row.time < start) : [];
      },
      createMany: async ({ data }: { data: typeof transactions }) => { transactions.push(...data); },
      findMany: async () => transactions,
    },
  };
  const db = { schwabCalendarSnapshot: snapshots, $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient;
  const query = { month: "2026-11" };
  await expect(readCalendar(db, query, "account")).rejects.toMatchObject({ code: "CALENDAR_SYNC_REQUIRED" });
  read.mockImplementation(async resource => {
    expect(resource).toMatch(/^accounts\/account\/transactions\?/);
    if (resource.endsWith("RECEIVE_AND_DELIVER")) return [];
    if (resource.includes("startDate=2026-11-09")) return [closing];
    return [opening];
  });
  await syncCalendar(db, "account", new Date("2026-11-16T23:00:00Z"));
  const before = await readCalendar(db, query, "account");
  expect(before.totalRealizedPnl).toBe("0.0000");
  await syncCalendar(db, "account", new Date("2026-11-17T23:00:00Z"));
  read.mockRejectedValue(new Error("Broker unavailable"));
  await expect(syncCalendar(db, "account", new Date("2026-11-18T23:00:00Z"))).rejects.toThrow("Broker unavailable");
  const after = await readCalendar(db, query, "account");
  expect(after.days).toEqual([{ date: "2026-11-17", realizedPnl: "15.0000", closingTrades: 1 }]);
  expect(after.updatedAt).toBe("2026-11-17T23:00:00.000Z");
  expect(snapshots.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { accountKey: calendarKey("account") } }));
  expect(JSON.stringify(after)).not.toContain('"account"');
  expect(read).toHaveBeenCalledTimes(6);
});
