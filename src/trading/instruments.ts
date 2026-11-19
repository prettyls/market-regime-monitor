import type { Prisma, PrismaClient } from "@prisma/client";

export const eligibleTradingInstrument = {
  active: true,
  kind: { in: ["EQUITY", "ETF"] },
} satisfies Prisma.InstrumentWhereInput;

export async function listEligibleTradingSymbols(db: PrismaClient, blockedSymbols: readonly string[] = []) {
  const instruments = await db.instrument.findMany({
    where: eligibleTradingInstrument,
    orderBy: { symbol: "asc" },
    select: { symbol: true },
  });
  return instruments.map(({ symbol }) => symbol).filter(symbol => !blockedSymbols.includes(symbol));
}
