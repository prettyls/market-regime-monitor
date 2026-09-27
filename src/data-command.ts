import { Command, InvalidArgumentError } from "commander";
import type { MarketService } from "./services.js";

function parseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new InvalidArgumentError("Expected a valid date in YYYY-MM-DD format.");
  }
  return date;
}

export function createDataCommand(service: Pick<MarketService, "getHistory">, output: Pick<Console, "log" | "table"> = console): Command {
  const command = new Command("data")
    .description("Display imported daily bars in chronological order")
    .requiredOption("--symbol <symbol>", "instrument symbol, e.g. VIX")
    .option("--from <date>", "inclusive start date (YYYY-MM-DD, UTC)", parseDate)
    .option("--to <date>", "inclusive end date (YYYY-MM-DD, UTC)", parseDate)
    .action(async (options: { symbol: string; from?: Date; to?: Date }) => {
      if (options.from && options.to && options.from > options.to) {
        command.error("--from must be on or before --to");
      }
      const symbol = options.symbol.trim().toUpperCase();
      if (!symbol) command.error("--symbol must not be empty");
      const to = options.to ? new Date(options.to.getTime() + 86_400_000 - 1) : undefined;
      try {
        const rows = await service.getHistory(symbol, options.from, to);
        if (rows.length === 0) {
          output.log(`No imported data found for ${symbol} in the requested date range.`);
          return;
        }
        output.table(rows.map((row) => ({ date: row.timestamp.toISOString().slice(0, 10), open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume })));
      } catch (error) {
        command.error(error instanceof Error ? error.message : String(error));
      }
    });
  return command;
}
