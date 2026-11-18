import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { createHash } from "node:crypto";
import { SchwabPortfolioError } from "./schwab.js";

const querySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
export const transactionSchema = z.array(z.object({
  activityId: z.number().int().safe(), time: z.string().datetime({ offset: true }),
  tradeDate: z.string().datetime({ offset: true }).optional(),
  type: z.string(), status: z.string(), netAmount: z.number().finite(),
  activityType: z.string(),
  transferItems: z.array(z.object({
    instrument: z.object({ assetType: z.string(), symbol: z.string().optional(), cusip: z.string().optional() }),
    amount: z.number().finite(), positionEffect: z.string().optional(),
  })),
}));
type Transaction = z.infer<typeof transactionSchema>[number];
const D = Prisma.Decimal;
export const calendarSession = (time: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(time));

// Estimates use only observed long-equity lots. No invented opening cost basis.
export function calculateCalendarDays(transactions: Transaction[]) {
  const lots = new Map<string, Array<{ quantity: Prisma.Decimal; basis: Prisma.Decimal }>>();
  const blocked = new Set<string>();
  const days = new Map<string, { pnl: Prisma.Decimal; closingTrades: number; incomplete: boolean }>();
  const seen = new Set<number>();
  for (const tx of [...transactions].sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || a.activityId - b.activityId)) {
    if (seen.has(tx.activityId)) continue;
    seen.add(tx.activityId);
    if (tx.status !== "VALID") continue;
    const date = calendarSession(tx.tradeDate ?? tx.time);
    const day = days.get(date) ?? { pnl: new D(0), closingTrades: 0, incomplete: false };
    days.set(date, day);
    const securities = tx.transferItems.filter(i => i.instrument.assetType !== "CURRENCY");
    const item = securities[0];
    const key = item?.instrument.cusip || item?.instrument.symbol;
    if (tx.type !== "TRADE" || tx.activityType !== "EXECUTION" || securities.length !== 1 || !item || item.instrument.assetType !== "EQUITY" || !key || item.amount === 0) {
      day.incomplete = true;
      for (const i of securities) { const k = i.instrument.cusip || i.instrument.symbol; if (k) blocked.add(k); }
      continue;
    }
    if (blocked.has(key)) { day.incomplete = true; continue; }
    const inventory = lots.get(key) ?? [];
    lots.set(key, inventory);
    if (item.amount > 0 && item.positionEffect === "OPENING" && tx.netAmount < 0) {
      inventory.push({ quantity: new D(item.amount), basis: new D(tx.netAmount).negated() });
    } else if (item.amount < 0 && item.positionEffect === "CLOSING" && tx.netAmount >= 0) {
      day.closingTrades++;
      let quantity = new D(item.amount).negated();
      if (inventory.reduce((n, lot) => n.plus(lot.quantity), new D(0)).lt(quantity)) {
        day.incomplete = true; blocked.add(key); continue;
      }
      let basis = new D(0);
      while (quantity.gt(0)) {
        const lot = inventory[0]!;
        const used = D.min(quantity, lot.quantity);
        const cost = lot.basis.mul(used).div(lot.quantity);
        basis = basis.plus(cost); lot.basis = lot.basis.minus(cost);
        lot.quantity = lot.quantity.minus(used); quantity = quantity.minus(used);
        if (lot.quantity.isZero()) inventory.shift();
      }
      day.pnl = day.pnl.plus(new D(tx.netAmount).minus(basis));
    } else { day.incomplete = true; blocked.add(key); }
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, day]) => ({
    date, pnl: day.pnl.toString(), closingTrades: day.closingTrades, incomplete: day.incomplete,
  }));
}

const daysSchema = z.array(z.object({
  date: z.string(), pnl: z.string(), closingTrades: z.number().int(), incomplete: z.boolean(),
}));
type Days = z.infer<typeof daysSchema>;

function calendarResponse(days: Days, month: string, historyStart: string, updatedAt: string) {
  let cumulative = new D(0), total = new D(0), complete = true;
  let monthComplete = month !== historyStart.slice(0, 7) || historyStart.endsWith("-01");
  const rows = days.filter(day => day.date <= `${month}-31`).map(({ date, ...day }) => {
    complete &&= !day.incomplete;
    cumulative = cumulative.plus(day.pnl);
    if (date.startsWith(month)) { total = total.plus(day.pnl); monthComplete &&= !day.incomplete; }
    return { date, realizedPnl: day.incomplete ? null : new D(day.pnl).toFixed(4), closingTrades: day.closingTrades, cumulative: complete ? cumulative.toFixed(4) : null };
  });
  return {
    month, currency: "USD", simulated: false, estimated: true, method: "OBSERVED_FIFO", timezone: "America/New_York",
    historyStart, updatedAt, totalRealizedPnl: monthComplete ? total.toFixed(4) : null,
    warning: "FIFO estimate from observed long-equity trades, using net transaction amounts including reported fees. Opening lots before the history window, transfers, corporate actions, tax-lot elections and wash-sale adjustments may change broker-reported P/L. Not a tax report.",
    cumulativeSeries: rows.map(r => ({ date: r.date, realizedPnl: r.cumulative })),
    days: rows.filter(r => r.date.startsWith(month)).map(({ cumulative: _, ...row }) => row),
  };
}

export function estimateCalendar(raw: unknown, month: string, historyStart: string, updatedAt: string) {
  return calendarResponse(calculateCalendarDays(transactionSchema.parse(raw)), month, historyStart, updatedAt);
}

export const calendarKey = (accountHash?: string) => accountHash
  ? createHash("sha256").update(accountHash).digest("hex")
  : "sole-linked-account";

export async function readCalendar(db: PrismaClient, query: unknown, accountHash?: string) {
  const { month } = querySchema.parse(query);
  const snapshot = await db.schwabCalendarSnapshot.findFirst({
    where: accountHash ? { accountKey: calendarKey(accountHash) } : { key: calendarKey() },
    orderBy: { syncedAt: "desc" }, select: { historyStart: true, syncedAt: true, days: true },
  });
  if (!snapshot) throw new SchwabPortfolioError("CALENDAR_SYNC_REQUIRED", "Calendar data is awaiting its first sync", 503);
  if (month < snapshot.historyStart.slice(0, 7) || month > calendarSession(snapshot.syncedAt.toISOString()).slice(0, 7)) {
    throw Object.assign(new Error("Requested month is outside available history"), { statusCode: 400 });
  }
  return calendarResponse(daysSchema.parse(snapshot.days), month, snapshot.historyStart, snapshot.syncedAt.toISOString());
}
