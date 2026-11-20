import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { calculateCalendarDays, calendarKey, calendarSession, transactionSchema } from "./calendar.js";
import { readSchwabResource, SchwabPortfolioError } from "./schwab.js";

const dayMs = 86_400_000;
const accountList = z.array(z.object({ hashValue: z.string().min(1) }));

async function selectAccount(configured?: string) {
  if (configured) return configured;
  const accounts = accountList.safeParse(await readSchwabResource("accounts/accountNumbers"));
  if (!accounts.success) throw new SchwabPortfolioError("SCHWAB_INVALID_RESPONSE", "Schwab returned an invalid account list");
  if (accounts.data.length !== 1) {
    throw new SchwabPortfolioError("SCHWAB_ACCOUNT_SELECTION_REQUIRED", "Configure SCHWAB_TRADE_ACCOUNT_HASH for the intended linked trading account", 503);
  }
  return accounts.data[0]!.hashValue;
}

export async function syncCalendar(db: PrismaClient, configured?: string, now = new Date()) {
  const key = calendarKey(configured);
  const accountHash = await selectAccount(configured);
  const accountKey = calendarKey(accountHash);
  const transactionKey = calendarKey(`${key}:${accountHash}`);
  const snapshot = await db.schwabCalendarSnapshot.findUnique({
    where: { key }, select: { accountKey: true, historyStart: true, syncedAt: true },
  });
  const earliest = new Date(now.getTime() - 364 * dayMs);
  const backfill = !snapshot || snapshot.accountKey !== accountKey || snapshot.syncedAt < earliest;
  const start = backfill ? earliest : new Date(Math.max(earliest.getTime(), snapshot.syncedAt.getTime() - 7 * dayMs));
  const results = await Promise.all(["TRADE", "RECEIVE_AND_DELIVER"].map(async type => {
    const params = new URLSearchParams({ startDate: start.toISOString(), endDate: now.toISOString(), types: type });
    let response: unknown;
    try {
      response = await readSchwabResource(`accounts/${encodeURIComponent(accountHash)}/transactions?${params}`);
    } catch (error) {
      if (!(error instanceof SchwabPortfolioError)) throw error;
      throw new SchwabPortfolioError(error.code, `${type} transactions: ${error.message}`, error.statusCode, error.upstreamStatus);
    }
    const result = transactionSchema.safeParse(response);
    if (!result.success) {
      const fields = new Set(result.error.issues.map(issue => issue.path
        .map(segment => typeof segment === "number" ? "[]" : String(segment))
        .join(".")));
      throw new SchwabPortfolioError(
        "SCHWAB_INVALID_RESPONSE",
        `${type} transactions: Schwab returned unsupported transaction data at ${[...fields].slice(0, 10).join(", ") || "response root"}`,
      );
    }
    return result.data;
  }));
  const transactions = new Map(results.flat().map(transaction => [String(transaction.activityId), transaction]));
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(79013204)`;
    const current = await tx.schwabCalendarSnapshot.findUnique({ where: { key }, select: { syncedAt: true } });
    if (current?.syncedAt.getTime() !== snapshot?.syncedAt.getTime() || (current && current.syncedAt >= now)) {
      return { status: "SUPERSEDED" };
    }
    await tx.schwabCalendarTransaction.deleteMany({
      where: {
        accountKey: transactionKey,
        ...(backfill ? {} : { OR: [{ time: { gte: start, lte: now } }, { activityId: { in: [...transactions.keys()] } }] }),
      },
    });
    await tx.schwabCalendarTransaction.createMany({
      data: [...transactions].map(([activityId, payload]) => ({ accountKey: transactionKey, activityId, time: new Date(payload.time), payload })),
    });
    const stored = await tx.schwabCalendarTransaction.findMany({
      where: { accountKey: transactionKey }, select: { payload: true },
    });
    const days = calculateCalendarDays(transactionSchema.parse(stored.map(row => row.payload)));
    const data = { accountKey, historyStart: backfill ? calendarSession(start.toISOString()) : snapshot.historyStart, syncedAt: now, days };
    await tx.schwabCalendarSnapshot.upsert({ where: { key }, create: { key, ...data }, update: data });
    return { status: "SYNCED", days: days.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 60_000 });
}
