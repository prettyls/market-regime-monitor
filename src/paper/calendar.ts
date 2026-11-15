import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { paperConfig } from "./config.js";

const querySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
const executionSchema = z.object({ realizedPnl: z.string(), fills: z.array(z.object({ side: z.string() })) });

// A persisted closing report is the publication boundary; never expose an intraday run.
export async function realizedCalendar(db: PrismaClient, query: unknown) {
  const { month } = querySchema.parse(query);
  const accountId = paperConfig().accountId;
  const where = { accountId, session: { lte: `${month}-31` } };
  const reports = await db.paperReport.findMany({ where, select: { session: true }, orderBy: { session: "asc" } });
  const runs = await db.paperRun.findMany({ where: { ...where, status: "EXECUTED", session: { in: reports.map(r => r.session) } }, select: { session: true, execution: true } });
  let total = new Prisma.Decimal(0);
  let cumulative = new Prisma.Decimal(0);
  const cumulativeSeries: Array<{ date: string; realizedPnl: string }> = [];
  const days = reports.map(report => {
    const run = runs.find(r => r.session === report.session);
    const execution = run ? executionSchema.parse(run.execution) : null;
    const pnl = new Prisma.Decimal(execution?.realizedPnl ?? "0");
    if (!pnl.isFinite()) throw new Error("Invalid realized P/L record");
    cumulative = cumulative.plus(pnl);
    cumulativeSeries.push({ date: report.session, realizedPnl: cumulative.toFixed(4) });
    if (report.session.startsWith(month)) total = total.plus(pnl);
    return { date: report.session, realizedPnl: pnl.toFixed(4), closingTrades: execution?.fills.filter(f => f.side === "SELL").length ?? 0 };
  });
  return { month, currency: "USD", simulated: true, timezone: "America/New_York", totalRealizedPnl: total.toFixed(4), cumulativeSeries, days: days.filter(day => day.date.startsWith(month)) };
}
