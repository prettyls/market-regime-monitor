import { Script } from "node:vm";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { realizedCalendar } from "../src/paper/calendar.js";
import { calendarHtml } from "../src/web/calendar.js";
import { uiHtml } from "../src/web/ui.js";
import { registerAccess } from "../src/access.js";

it("publishes only reported sessions and totals daily realized P/L precisely", async () => {
  const db = {
    paperReport: { findMany: vi.fn(async () => [{ session: "2026-11-10" }, { session: "2026-11-11" }, { session: "2026-11-12" }]) },
    paperRun: { findMany: vi.fn(async () => [
      { session: "2026-11-10", execution: { realizedPnl: "10.1234", fills: [{ side: "SELL" }, { side: "BUY" }] } },
      { session: "2026-11-11", execution: { realizedPnl: "-3.1234", fills: [{ side: "SELL" }] } },
    ]) },
  };
  const result = await realizedCalendar(db as any, { month: "2026-11" });
  expect(result.totalRealizedPnl).toBe("7.0000");
  expect(result.days.map(d => [d.realizedPnl, d.closingTrades])).toEqual([["10.1234", 1], ["-3.1234", 1], ["0.0000", 0]]);
  expect(db.paperRun.findMany.mock.calls[0]).toEqual([{ where: expect.objectContaining({ status: "EXECUTED", session: { in: result.days.map(d => d.date) } }), select: { session: true, execution: true } }]);
  await expect(realizedCalendar(db as any, { month: "2026-13" })).rejects.toThrow();
});
it("opens the calendar and data without administrator credentials", async () => {
  const app = Fastify();
  registerAccess(app);
  app.get('/calendar', async () => calendarHtml);
  app.get('/api/v1/paper/calendar', async () => ({ days: [] }));
  for (const url of ['/calendar', '/api/v1/paper/calendar?month=2026-11']) expect((await app.inject(url)).statusCode).toBe(200);
  expect(uiHtml).toContain('href="/calendar"');
  expect(() => new Script(calendarHtml.match(/<script>([\s\S]*?)<\/script>/)![1]!)).not.toThrow();
  await app.close();
});

it("carries prior months into the chart while keeping calendar totals monthly", async () => {
  const db = {
    paperReport: { findMany: vi.fn(async () => [{ session: "2026-10-30" }, { session: "2026-11-02" }]) },
    paperRun: { findMany: vi.fn(async () => [
      { session: "2026-10-30", execution: { realizedPnl: "100.0000", fills: [{ side: "SELL" }] } },
      { session: "2026-11-02", execution: { realizedPnl: "-25.0000", fills: [{ side: "SELL" }] } },
    ]) },
  };
  const result = await realizedCalendar(db as any, { month: "2026-11" });
  expect(result.totalRealizedPnl).toBe("-25.0000");
  expect(result.days.map(d => d.date)).toEqual(["2026-11-02"]);
  expect(result.cumulativeSeries).toEqual([
    { date: "2026-10-30", realizedPnl: "100.0000" },
    { date: "2026-11-02", realizedPnl: "75.0000" },
  ]);
  expect(db.paperReport.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ session: { lte: "2026-11-31" } }) }));
});
